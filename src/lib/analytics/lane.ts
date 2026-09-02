import type { Schedule } from "../../types/schedule";
import { compareDateAsc } from "../compare";
import {
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
 * NO COMPOSITE SCORE, AND NO TIER LABEL.
 *
 * An earlier version ranked carriers with a weighted "chances" number and tagged each row
 * Preferred / Viable / Avoid. Both are gone deliberately: a score asks the reader to trust an
 * arithmetic they did not choose, and a label states the conclusion instead of letting them reach
 * it. The columns and the sort now carry the argument — the carrier at the top has the most direct
 * sailings, the shallowest transshipments and a transit backed by volume, and that is visible
 * without a badge saying so.
 */

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
  /**
   * Mean transshipments per connection. The single clearest quality signal on a lane: it separates
   * a carrier that always runs one hand-off from one that routinely runs two, and it tracks
   * transit directly — measured on Semarang -> Los Angeles, 1.00 for WHL at a 25.5-day median
   * against 2.00 for HPL at 42.0.
   */
  avgTs: number;
  /**
   * The routing this carrier actually runs MOST, with the transit that routing delivers.
   *
   * This is the honest headline transit, not the best case. A carrier's fastest sailing can be a
   * one-off: WHL shows a 15-day best case on this lane while the service it actually offers —
   * Taipei, 8 sailings — runs a 20.5-day median. Booking against the 15 would be booking against
   * something that happened once.
   */
  mainRoute: { label: string; connections: number; median: number | null } | null;
  /**
   * Last published sailing, beside the next one.
   *
   * A service can be thin because it is small, or thin because it is ENDING, and those call for
   * different decisions. On Semarang -> Savannah, EMC's four dates run Aug 30 to Sep 12 while HMM
   * runs to Oct 23 — fine for a box moving in the next ten days, useless for anything planned
   * beyond that. Without this the two look identical.
   */
  lastEtd: string | null;
  /** Signed days against the lane's median carrier. Negative is faster. */
  vsLaneMedian: number | null;
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
 * Per-carrier summary for a lane.
 *
 * The question is not "who is fastest" but "whose space can a forwarder actually get, at a transit
 * we can live with" — so the table leads with how many DIRECT sailing dates a carrier offers, then
 * how deep its transshipments run, then the transit its main service actually delivers.
 *
 * THE SORT IS THE ARGUMENT. Ordered by direct dates, then fewest transshipments, then the median
 * of the routing each carrier runs most. No score and no label: the carrier worth calling is the
 * one at the top, and every column that put it there is on the row.
 */
export function carrierStats(rows: Schedule[], lane?: Lane): CarrierRow[] {
  const conns = dedupeConnections(inLane(rows, lane));
  const groups = new Map<string, Schedule[]>();

  for (const c of conns) {
    const bucket = groups.get(c.carrier_code);
    if (bucket) bucket.push(c);
    else groups.set(c.carrier_code, [c]);
  }

  type Draft = Omit<CarrierRow, "vsLaneMedian">;
  const drafts: Draft[] = [];

  for (const [carrier, group] of groups) {
    const direct = group.filter((g) => tsCount(g) === 0);
    const ts1 = group.filter((g) => tsCount(g) === 1);
    const ts2 = group.filter((g) => tsCount(g) >= 2);
    const dates = distinctDates(group);

    const directDates = distinctDates(direct).length;
    const ts1Dates = distinctDates(ts1).length;
    const ts2Dates = distinctDates(ts2).length;

    // The routing this carrier runs most, and what THAT delivers — the transit actually on offer
    // rather than its luckiest sailing. Ties broken by the faster median, so a carrier running two
    // services equally often is represented by the better of them.
    const byRoute = new Map<string, Schedule[]>();
    for (const g of group) {
      const label = [...(g.ts_ports ?? []), g.port_of_discharge].join(" > ");
      const b = byRoute.get(label);
      if (b) b.push(g);
      else byRoute.set(label, [g]);
    }
    const mainRoute =
      [...byRoute.entries()]
        .map(([label, rows2]) => ({
          label,
          connections: rows2.length,
          median: spreadOf(rows2.map((r) => r.transit_time_days)).median,
        }))
        .sort(
          (a, b) =>
            b.connections - a.connections ||
            (a.median ?? Infinity) - (b.median ?? Infinity),
        )[0] ?? null;

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
      nextEtd: dates[0] ?? null,
      lastEtd: dates[dates.length - 1] ?? null,
      avgTs: Math.round((group.reduce((n, g) => n + tsCount(g), 0) / group.length) * 100) / 100,
      mainRoute,
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

  // THE SORT IS THE ARGUMENT.
  //
  // Direct sailing dates first: a direct booking has no hand-off to lose space at, and more dates
  // means more chances to get one away. Then the shallowest average transshipment, which on its
  // own separates WHL at 1.00 TS and a 25.5-day median from HPL at 2.00 and 42.0.
  //
  // Then THIN SERVICES DROP BEHIND SUBSTANTIAL ONES, before speed is considered at all.
  //
  // A fast median off three departures is not the same claim as a fast median off twenty, and
  // without this the smaller number simply wins. Ordering on the overall median alone put COS
  // second on the real Semarang lane — 29 days across 3 sailings, ahead of HMM's 31 across 20.
  // That looked fixed when COS's other, slower sailings dragged its overall median to 36, but
  // that was luck: a carrier whose whole service is small and quick still jumped the queue.
  //
  // "Thin" is relative to the lane, because a well-served lane and a quiet one cannot share an
  // absolute threshold. A quarter of the best-served carrier's dates is the line.
  //
  // BUT A THIN SERVICE THAT IS MATERIALLY FASTER IS NOT DEMOTED. The rule exists to stop three
  // sailings outranking twenty on a two-day edge; it was never meant to bury a real advantage.
  // On Semarang -> Savannah, EMC runs 4 dates at a 44.5-day median against a 54.5-day lane —
  // ten days, 18% — and sank to last behind carriers it beats outright. Naming a carrier in an
  // RFQ costs nothing (it is a rate request, not a booking), so a candidate that good has to
  // surface and let the reader weigh its 4 dates for themselves.
  //
  // The margin is relative, not absolute: 10% of the lane median. It clears EMC's 18% while still
  // catching the case the rule was built for — 29 days against a 30-day lane is 3%, and stays
  // demoted.
  const mostDates = Math.max(0, ...drafts.map((d) => d.sailDates));
  const MATERIAL_GAIN = 0.1;
  const materiallyFaster = (d: Draft) => {
    const v = vsLane(d);
    return v != null && laneMedian != null && laneMedian > 0 && -v / laneMedian >= MATERIAL_GAIN;
  };
  const thin = (d: Draft) => d.sailDates < mostDates * 0.25 && !materiallyFaster(d);

  // Only then speed, and by the carrier's OVERALL median rather than its main service — the
  // overall figure covers everything it runs, where a main-service median can rest on a handful.
  // The main-service figure stays a COLUMN: what a carrier runs most is worth seeing, it is just
  // not what should order the table.
  //
  // Nulls sort last throughout: a carrier that has published no transit is not a fast one.
  return drafts
    .map((d): CarrierRow => ({ ...d, vsLaneMedian: vsLane(d) }))
    .sort(
      (a, b) =>
        b.directDates - a.directDates ||
        a.avgTs - b.avgTs ||
        Number(thin(a)) - Number(thin(b)) ||
        (a.transit.median ?? Infinity) - (b.transit.median ?? Infinity) ||
        b.sailDates - a.sailDates ||
        a.carrier.localeCompare(b.carrier),
    );
}

// ── shared ───────────────────────────────────────────────────────────────────────────

/** Lanes present in a snapshot, busiest first — what the lane picker offers. */
export function lanesIn(rows: Schedule[]): Array<Lane & { departures: number }> {
  const groups = new Map<string, Schedule[]>();
  for (const c of dedupeConnections(rows)) {
    const key = `${c.port_of_loading}\u0000${c.last_cy}`;
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
