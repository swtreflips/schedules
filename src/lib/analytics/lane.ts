import type { Schedule } from "../../types/schedule";
import {
  spreadOf,
  toOptions,
  type Option,
  type Spread,
} from "./departures";
import { canonicalPort, routeLabel, samePlace } from "./ports";

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
  /** True when the box moves inland from POD by rail — discharge and Last CY are different places. */
  hasRailLeg: boolean;
  /** Quotable options on this routing. See `Option`. */
  options: number;
  /**
   * Distinct ETD dates.
   *
   * NOT THE SAME AS `options`, EVEN THOUGH THE CHAIN IS FIXED HERE. A corridor spans carriers, so
   * two carriers sailing this routing on one day are two options and one date.
   */
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
  const scoped = inLane(rows, lane);
  const groups = new Map<string, Option[]>();

  for (const o of toOptions(scoped)) {
    const bucket = groups.get(o.chain);
    if (bucket) bucket.push(o);
    else groups.set(o.chain, [o]);
  }

  // The rail flag reads the raw rows, because an Option carries the routing rather than the Last CY
  // it was found under. Keyed on the chain, which is what an option carries.
  const railByChain = new Map<string, boolean>();
  const viaByChain = new Map<string, string[]>();
  for (const r of scoped) {
    const chain = optionChain(r);
    if (!railByChain.has(chain)) {
      // Same complex is not a rail leg: a Long Beach discharge against a Los Angeles Last CY moves
      // by truck across one harbour, not by train across the country.
      railByChain.set(chain, !samePlace(r.port_of_discharge, r.last_cy));
      viaByChain.set(chain, (r.ts_ports ?? []).map(canonicalPort));
    }
  }

  const out: CorridorRow[] = [];
  for (const [key, group] of groups) {
    out.push({
      key,
      via: viaByChain.get(key) ?? [],
      pod: canonicalPort(group[0].pod),
      ts: Math.min(...group.map((o) => o.ts)),
      hasRailLeg: railByChain.get(key) ?? false,
      options: group.length,
      sailDates: new Set(group.map((o) => o.date)).size,
      carriers: [...new Set(group.map((o) => o.carrier))].sort(),
      transit: spreadOf(group.map((o) => o.transit)),
      nextEtd: group.map((o) => o.date).sort()[0] ?? null,
    });
  }

  return out.sort(
    (a, b) =>
      b.options - a.options ||
      (a.transit.median ?? Infinity) - (b.transit.median ?? Infinity),
  );
}

// ── View B: carriers ─────────────────────────────────────────────────────────────────

export interface CarrierRow {
  carrier: string;
  /**
   * Quotable options — one chain, one day. THE HEADLINE. See `Option` in departures.ts.
   */
  options: number;
  /**
   * Distinct ETD dates: the number of days a box can actually leave on.
   *
   * KEPT ALONGSIDE `options` BECAUSE THEY ANSWER DIFFERENT QUESTIONS. Options are what you can ask
   * a forwarder for; dates are when you can go. Twenty options across three days is not the same
   * proposition as twenty across twenty, and only the pair shows that.
   */
  sailDates: number;
  /**
   * Options by routing depth.
   *
   * THESE SUM TO `options`, BY CONSTRUCTION rather than by rule. Counting dates required
   * classifying each date by its shallowest routing so the columns would add up — a carrier
   * offering a 1 TS and a 2 TS on one departure had to be counted once, as the 1 TS. An option
   * has exactly one depth, so there is nothing to collapse and nothing to explain.
   */
  directOptions: number;
  ts1Options: number;
  ts2Options: number;
  /** Days between first and last sailing. A high count inside a short window is not coverage. */
  windowDays: number;
  corridors: number;
  transit: Spread;
  pods: string[];
  nextEtd: string | null;
  /**
   * Mean transshipments per OPTION. The single clearest quality signal on a lane: it separates a
   * carrier that always runs one hand-off from one that routinely runs two, and it tracks transit
   * directly — measured on Semarang -> Los Angeles, 1.00 for WHL at a 25.5-day median against 2.00
   * for HPL at 42.0.
   *
   * PER OPTION, NOT PER CONNECTION, which it used to be. Connection-weighting let a chain published
   * against twenty-two onward vessels count twenty-two times toward a carrier's routing depth — the
   * same distortion that makes connections a bad count anywhere else.
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
  mainRoute: { label: string; options: number; dates: number; ts: number; median: number | null } | null;
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
   * carrier with 35 direct options in history. Render as "none in this snapshot", never as 0.
   */
  directUnknown: boolean;
}

/**
 * Per-carrier summary for a lane.
 *
 * The question is not "who is fastest" but "whose space can a forwarder actually get, at a transit
 * we can live with" — so the table leads with how many DIRECT options a carrier offers, then how
 * deep its transshipments run, then the transit its main service actually delivers.
 *
 * THE SORT IS THE ARGUMENT. Ordered by direct options, then fewest transshipments, then the median
 * of the routing each carrier runs most. No score and no label: the carrier worth calling is the
 * one at the top, and every column that put it there is on the row.
 */
export function carrierStats(rows: Schedule[], lane?: Lane): CarrierRow[] {
  const groups = new Map<string, Option[]>();

  for (const o of toOptions(inLane(rows, lane))) {
    const bucket = groups.get(o.carrier);
    if (bucket) bucket.push(o);
    else groups.set(o.carrier, [o]);
  }

  type Draft = Omit<CarrierRow, "vsLaneMedian">;
  const drafts: Draft[] = [];

  for (const [carrier, group] of groups) {
    // NOTHING TO COLLAPSE. An option has exactly one routing depth, so these three sum to
    // `group.length` by construction. The previous version counted DATES and had to classify each
    // date by its shallowest routing to stop the columns overlapping — a carrier offering a 1 TS
    // and a 2 TS on one departure was counted once, as the 1 TS, or the breakdown did not add up.
    const directOptions = group.filter((o) => o.ts === 0).length;
    const ts1Options = group.filter((o) => o.ts === 1).length;
    const ts2Options = group.filter((o) => o.ts >= 2).length;
    const dates = [...new Set(group.map((o) => o.date))].sort();

    // The routing this carrier runs most, and what THAT delivers — the transit actually on offer
    // rather than its luckiest sailing.
    //
    // BY OPTIONS, WHICH NEEDS NO ARGUMENT NOW. Picking by connection count used to select routings
    // that were merely duplicated rather than frequent: OOCL on Ho Chi Minh -> Los Angeles had a
    // Ningbo double-transship with 8 connections across just 2 dates against a direct with 3 across
    // 3, so connections named the 2 TS chain as its main service on a row whose columns read 4
    // direct. Options cannot do that — a chain published against twenty onward vessels on one day
    // is one option, the same as a chain published against one.
    //
    // Ties break toward the shallower routing, then the faster median: offered equally often, a
    // direct is the truer description of a carrier than a transship.
    const byRoute = new Map<string, Option[]>();
    for (const o of group) {
      const b = byRoute.get(o.chain);
      if (b) b.push(o);
      else byRoute.set(o.chain, [o]);
    }
    const mainRoute =
      [...byRoute.entries()]
        .map(([label, os]) => ({
          label,
          options: os.length,
          dates: new Set(os.map((o) => o.date)).size,
          ts: Math.min(...os.map((o) => o.ts)),
          median: spreadOf(os.map((o) => o.transit)).median,
        }))
        .sort(
          (a, b) =>
            b.options - a.options ||
            a.ts - b.ts ||
            (a.median ?? Infinity) - (b.median ?? Infinity),
        )[0] ?? null;

    drafts.push({
      carrier,
      options: group.length,
      sailDates: dates.length,
      directOptions,
      ts1Options,
      ts2Options,
      windowDays: dates.length > 1 ? daysBetween(dates[0], dates[dates.length - 1]) : 0,
      corridors: byRoute.size,
      transit: spreadOf(group.map((o) => o.transit)),
      pods: [...new Set(group.map((o) => o.pod))].sort(),
      nextEtd: dates[0] ?? null,
      lastEtd: dates[dates.length - 1] ?? null,
      avgTs: Math.round((group.reduce((n, o) => n + o.ts, 0) / group.length) * 100) / 100,
      mainRoute,
      directUnknown: directOptions === 0,
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
  // SAMPLE SIZE IS MEASURED IN OPTIONS, because options are what the median is now computed over
  // — the guard and the statistic it guards have to count the same thing.
  const mostOptions = Math.max(0, ...drafts.map((d) => d.options));
  const MATERIAL_GAIN = 0.1;
  const materiallyFaster = (d: Draft) => {
    const v = vsLane(d);
    return v != null && laneMedian != null && laneMedian > 0 && -v / laneMedian >= MATERIAL_GAIN;
  };
  const thin = (d: Draft) => d.options < mostOptions * 0.25 && !materiallyFaster(d);

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
        b.directOptions - a.directOptions ||
        a.avgTs - b.avgTs ||
        Number(thin(a)) - Number(thin(b)) ||
        (a.transit.median ?? Infinity) - (b.transit.median ?? Infinity) ||
        b.options - a.options ||
        a.carrier.localeCompare(b.carrier),
    );
}

// ── shared ───────────────────────────────────────────────────────────────────────────

/**
 * Lanes present in a snapshot, busiest first — what the lane picker offers.
 *
 * PORT COMPLEXES ARE ONE DESTINATION HERE TOO. Carriers publish Last CY as either `Los Angeles, CA`
 * or `Long Beach, CA` for what is commercially the same delivery, and keying on the raw value split
 * seven load ports into two lanes apiece — Ho Chi Minh -> Long Beach carried 69 options that
 * never appeared in the Ho Chi Minh -> Los Angeles table. Half a market missing from a comparison
 * is worse than an extra entry in a lane picker, so the complex folds at lane level as well.
 */
export function lanesIn(rows: Schedule[]): Array<Lane & { options: number }> {
  const groups = new Map<string, Schedule[]>();
  for (const c of rows) {
    const key = `${canonicalPort(c.port_of_loading)}\u0000${canonicalPort(c.last_cy)}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(c);
    else groups.set(key, [c]);
  }
  // COUNTED PER LANE, not once globally. An option is scoped to the move it serves: one chain
  // sailed toward two different inland ramps is two things a forwarder can be asked about.
  return [...groups.values()]
    .map((group) => ({
      pol: canonicalPort(group[0].port_of_loading),
      lastCy: canonicalPort(group[0].last_cy),
      options: toOptions(group).length,
    }))
    .sort(
      (a, b) =>
        b.options - a.options ||
        a.pol.localeCompare(b.pol) ||
        a.lastCy.localeCompare(b.lastCy),
    );
}

/** The chain a raw row belongs to — the same string `toOptions` puts on an `Option`. */
const optionChain = (r: Schedule): string => routeLabel(r);

// Matched on the port complex, not the string, so a lane named for a complex collects the rows each
// carrier published under either berth. `canonicalPort` is idempotent — the complex name maps to
// itself — so a lane named for an ordinary single port still matches exactly as before.
const inLane = (rows: Schedule[], lane?: Lane) =>
  lane
    ? rows.filter(
        (r) => samePlace(r.port_of_loading, lane.pol) && samePlace(r.last_cy, lane.lastCy),
      )
    : rows;

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);

// `distinctDates` and `earliestEtd` are gone with the connection model. An Option already carries a
// non-null `date` — toOptions drops rows without one, since an unscheduled sailing is not something
// anyone can be quoted — so both collapse to a Set and a sort at the call site, and the null-safe
// ETD comparator they needed has nothing left to guard.
