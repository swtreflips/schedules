import type { Schedule } from "../../types/schedule";
import { compareDateAsc } from "../compare";
import {
  averageGapDays,
  dedupeConnections,
  spreadOf,
  tsCount,
  type Spread,
} from "./departures";

/**
 * Lane analytics: what a lane looks like, and who to ask for rates on it.
 *
 * Every function here is pure — `Schedule[]` in, plain objects out, no React — so the numbers can
 * be checked against SQL rather than by reading a rendered table.
 */

/**
 * THE LANE IS POL -> LAST CY. Not POL -> POD.
 *
 * Last CY is where the customer's box actually ends up; the discharge port is a routing choice
 * made to get it there. Comparing on POD would split one commercial lane into several and make
 * carriers serving it different ways look like they serve different markets.
 */
export interface Lane {
  pol: string;
  lastCy: string;
}

/**
 * How much a sailing date is worth, by how many transshipment hand-offs can go wrong.
 *
 * Direct has none; 1 TS has one; 2 TS or more has at least two, each a place where space is lost
 * or a connection missed. This encodes the operating priority — most direct first, then an
 * efficient 1 TS, then 2 TS — as weights rather than as a sort order, so a carrier with ten 1 TS
 * dates is not beaten by one with a single direct sailing.
 *
 * EXPORTED AND SHOWN IN THE UI on purpose. A composite nobody can audit gets ignored the first
 * time it disagrees with someone's judgement; one whose weights are visible can be argued with.
 */
export const CHANCE_WEIGHTS = { direct: 3, ts1: 1, ts2plus: 0.25 } as const;

export type Tier = "preferred" | "viable" | "avoid";

/** How many carriers to name in an RFQ. Not a floor — a thin lane may honestly support fewer. */
export const SHORTLIST_MAX = 3;

// ── View A: corridors ────────────────────────────────────────────────────────────────

export interface CorridorRow {
  /** Identity within the lane: ordered transshipment path, then the discharge port. */
  key: string;
  via: string[];
  pod: string;
  ts: number;
  /** True when the box moves inland from POD by rail: `port_of_discharge !== last_cy`. */
  hasRailLeg: boolean;
  departures: number;
  /** Distinct ETD dates. Chances to ship, as opposed to onward-vessel permutations. */
  sailDates: number;
  carriers: string[];
  transit: Spread;
  nextEtd: string | null;
}

/**
 * Segment a lane into its distinct routing shapes.
 *
 * ORDER MATTERS in the transshipment path: Port Klang -> Shekou is not Shekou -> Port Klang.
 *
 * POD IS PART OF THE CORRIDOR, even though it is not part of the lane — and for an inland Last CY
 * it is the single biggest thing separating one routing from another. Measured on
 * `Salt Lake City, UT`, reached through four different discharge ports:
 *
 *     Long Beach, CA    11 connections   median 31.0 days
 *     Los Angeles, CA   36 connections   median 33.5
 *     Oakland, CA       77 connections   median 40.0
 *     Houston, TX       12 connections   median 77.5
 *
 * The same box, the same final destination, 46 days between the best and worst way of getting
 * there — a Gulf discharge with a long rail leg against a West Coast one.
 */
export function corridorStats(rows: Schedule[], lane?: Lane): CorridorRow[] {
  const conns = dedupeConnections(inLane(rows, lane));
  const groups = new Map<string, Schedule[]>();

  for (const c of conns) {
    const key = [...(c.ts_ports ?? []), c.port_of_discharge].join(" > ");
    const bucket = groups.get(key);
    if (bucket) bucket.push(c);
    else groups.set(key, [c]);
  }

  const out: CorridorRow[] = [];
  for (const [key, group] of groups) {
    const first = group[0];
    out.push({
      key,
      via: first.ts_ports ?? [],
      pod: first.port_of_discharge,
      ts: tsCount(first),
      hasRailLeg: first.port_of_discharge !== first.last_cy,
      departures: group.length,
      sailDates: distinctDates(group).length,
      carriers: [...new Set(group.map((g) => g.carrier_code))].sort(),
      transit: spreadOf(group.map((g) => g.transit_time_days)),
      nextEtd: earliestEtd(group),
    });
  }

  return out.sort(
    (a, b) =>
      b.departures - a.departures ||
      (a.transit.median ?? Infinity) - (b.transit.median ?? Infinity),
  );
}

// ── View B: carriers ─────────────────────────────────────────────────────────────────

export interface CarrierRow {
  carrier: string;
  /** Connections — onward-vessel permutations. Kept, but NOT the headline. See `sailDates`. */
  departures: number;
  /**
   * Distinct ETD dates: the number of times a box can actually be shipped.
   *
   * THIS IS THE UNIT OF OPPORTUNITY, not `departures`. On Semarang -> Los Angeles, ONE shows 78
   * connections against HMM's 42 — but ONE's are 9 departures inside a 12-day window, while HMM's
   * are 18 dates across 40 days. Ranked on connections ONE leads by 2x; on the chance of getting a
   * box away it is clearly third.
   */
  sailDates: number;
  directDates: number;
  ts1Dates: number;
  ts2Dates: number;
  /** Days between first and last sailing. A high count inside a short window is not coverage. */
  windowDays: number;
  direct: number;
  ts1: number;
  ts2plus: number;
  corridors: number;
  transit: Spread;
  pods: string[];
  nextEtd: string | null;
  avgGapDays: number | null;
  /** Weighted sailing dates — see CHANCE_WEIGHTS. */
  chances: number;
  /** Signed days against the lane's median carrier. Negative is faster. */
  vsLaneMedian: number | null;
  tier: Tier;
  /**
   * True when this carrier shows no direct sailing in the snapshot. NOT the same as "runs none".
   *
   * `schedules_latest` keeps only the newest snapshot per (carrier, POL, last_cy), and WHL's
   * published routing alternates between snapshots — Jul 29, Aug 7 and Aug 17 entirely direct;
   * Aug 12 and Aug 31 entirely transshipped. So the latest snapshot reports zero direct for a
   * carrier with 35 direct departures in history. Render as "none in this snapshot", never as 0.
   */
  directUnknown: boolean;
}

/**
 * Per-carrier summary for a lane, tiered for the procurement decision.
 *
 * The question this answers is not "who is fastest" but "who should we ask forwarders to quote" —
 * which is about the chance of securing space at a competitive transit.
 *
 * SPEED IS A GATE, NOT A COMPONENT. Folding transit into `chances` produces a wrong shortlist.
 * Measured on Qingdao -> Los Angeles, HPL ties CMA at 24.0 chances while running 8.5 days slower,
 * and would displace COS — which is faster and more direct — from the top three. Kept as separate
 * axes, the tier stays legible and the table can be argued with.
 */
export function carrierStats(rows: Schedule[], lane?: Lane): CarrierRow[] {
  const conns = dedupeConnections(inLane(rows, lane));
  const groups = new Map<string, Schedule[]>();

  for (const c of conns) {
    const bucket = groups.get(c.carrier_code);
    if (bucket) bucket.push(c);
    else groups.set(c.carrier_code, [c]);
  }

  type Draft = Omit<CarrierRow, "vsLaneMedian" | "tier">;
  const drafts: Draft[] = [];

  for (const [carrier, group] of groups) {
    const direct = group.filter((g) => tsCount(g) === 0);
    const ts1 = group.filter((g) => tsCount(g) === 1);
    const ts2 = group.filter((g) => tsCount(g) >= 2);
    const dates = distinctDates(group);

    const directDates = distinctDates(direct).length;
    const ts1Dates = distinctDates(ts1).length;
    const ts2Dates = distinctDates(ts2).length;

    drafts.push({
      carrier,
      departures: group.length,
      sailDates: dates.length,
      directDates,
      ts1Dates,
      ts2Dates,
      windowDays: dates.length > 1 ? daysBetween(dates[0], dates[dates.length - 1]) : 0,
      direct: direct.length,
      ts1: ts1.length,
      ts2plus: ts2.length,
      corridors: new Set(
        group.map((g) => [...(g.ts_ports ?? []), g.port_of_discharge].join(" > ")),
      ).size,
      transit: spreadOf(group.map((g) => g.transit_time_days)),
      pods: [...new Set(group.map((g) => g.port_of_discharge))].sort(),
      nextEtd: earliestEtd(group),
      avgGapDays: averageGapDays(group.map((g) => g.etd)),
      chances:
        Math.round(
          (CHANCE_WEIGHTS.direct * directDates +
            CHANCE_WEIGHTS.ts1 * ts1Dates +
            CHANCE_WEIGHTS.ts2plus * ts2Dates) * 100,
        ) / 100,
      directUnknown: direct.length === 0,
    });
  }

  // The lane's own median carrier is the benchmark, not an absolute day count: 30 days is good on
  // one lane and poor on another, and the team is choosing between these carriers, not all lanes.
  const medians = drafts
    .map((d) => d.transit.median)
    .filter((m): m is number => m != null)
    .sort((a, b) => a - b);
  const laneMedian = medians.length
    ? medians.length % 2 === 0
      ? (medians[medians.length / 2 - 1] + medians[medians.length / 2]) / 2
      : medians[(medians.length - 1) / 2]
    : null;

  const vsLane = (d: Draft) =>
    d.transit.median != null && laneMedian != null
      ? Math.round((d.transit.median - laneMedian) * 10) / 10
      : null;

  // THE SPEED GATE IS APPLIED BEFORE RANKING, not after.
  //
  // Ranking everyone together and then taking a top third lets a slow carrier set the bar that
  // excludes a fast one. Measured on Qingdao -> Los Angeles: HPL scores 24.0 on nine slow 1 TS
  // dates, which pushed the third-place cutoff to 24 and dropped COS (7 direct dates, 1 day
  // FASTER than the lane) out of the shortlist. Ranking only among carriers that clear the gate
  // removes that interference entirely.
  //
  // A carrier with no published transit never clears it: unmeasured is not the same as fast.
  const eligible = drafts
    .filter((d) => {
      const vs = vsLane(d);
      return vs != null && vs <= 0;
    })
    .sort((a, b) => b.chances - a.chances);

  // Floor at a quarter of the leader, so a thin carrier is never padded into the list just to
  // reach three names. Semarang stops at two (HMM, WHL) rather than adding EMC's four dates.
  const floor = (eligible[0]?.chances ?? 0) * 0.25;
  const preferred = new Set(
    eligible.filter((d) => d.chances >= floor).slice(0, SHORTLIST_MAX).map((d) => d.carrier),
  );

  const ranked = [...drafts].sort((a, b) => b.chances - a.chances);
  const bottom = ranked[Math.min(ranked.length - 1, Math.floor((ranked.length * 2) / 3))]?.chances ?? 0;

  return drafts
    .map((d): CarrierRow => {
      const vs = vsLane(d);
      const slower = vs != null && vs > 0;

      let tier: Tier = "viable";
      if (preferred.has(d.carrier)) tier = "preferred";
      // One sailing date is not an option a forwarder can work with, however fast it is.
      else if (d.sailDates <= 1 || (d.chances <= bottom && slower)) tier = "avoid";

      return { ...d, vsLaneMedian: vs, tier };
    })
    .sort(
      (a, b) =>
        TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
        b.chances - a.chances ||
        a.carrier.localeCompare(b.carrier),
    );
}

const TIER_ORDER: Record<Tier, number> = { preferred: 0, viable: 1, avoid: 2 };

// ── shared ───────────────────────────────────────────────────────────────────────────

/** Lanes present in a snapshot, busiest first — what the lane picker offers. */
export function lanesIn(rows: Schedule[]): Array<Lane & { departures: number }> {
  const groups = new Map<string, Schedule[]>();
  for (const c of dedupeConnections(rows)) {
    const key = `${c.port_of_loading} ${c.last_cy}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(c);
    else groups.set(key, [c]);
  }
  return [...groups.values()]
    .map((group) => ({
      pol: group[0].port_of_loading,
      lastCy: group[0].last_cy,
      departures: group.length,
    }))
    .sort(
      (a, b) =>
        b.departures - a.departures ||
        a.pol.localeCompare(b.pol) ||
        a.lastCy.localeCompare(b.lastCy),
    );
}

const inLane = (rows: Schedule[], lane?: Lane) =>
  lane
    ? rows.filter((r) => r.port_of_loading === lane.pol && r.last_cy === lane.lastCy)
    : rows;

/** Sorted distinct ETD days. Null ETDs are dropped — an unscheduled sailing is not a chance. */
const distinctDates = (group: Schedule[]): string[] =>
  [...new Set(group.map((g) => g.etd).filter((e): e is string => !!e).map((e) => e.slice(0, 10)))].sort();

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);

// Nulls last, via the shared comparator — sorting ETDs directly is what shipped a crash once.
const earliestEtd = (group: Schedule[]): string | null =>
  group.map((g) => g.etd).sort(compareDateAsc)[0] ?? null;
