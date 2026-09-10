import type { Schedule } from "../../types/schedule";
import {
  spreadOf,
  toOptions,
  type Option,
  type Spread,
} from "./departures";
import { doorTransit, type Dray } from "./drayage";
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
  /**
   * The customer's city, when the caller is asking about a DOOR rather than a port pair.
   *
   * Set only in destination mode, where `lastCy` is the destination too and no single Last CY
   * frames the question. Purely for labelling — the scoping and the statistics never read it.
   */
  destination?: string;
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

/**
 * One routing a carrier runs on a lane, and what that routing delivers.
 *
 * A carrier is not one service. Measured on Laem Chabang -> Los Angeles/Long Beach, ZIM runs three
 * — Yantian, Ningbo and Shanghai — at 23, 25 and 27.5 days against a 26-day lane. Reporting only
 * the busiest of them describes a third of what ZIM can actually do.
 */
export interface Service {
  /** The whole routing as one string — `via` and `discharge` joined. Still the identity. */
  label: string;
  /** The hand-offs, in order. Empty for a direct sailing. */
  via: string[];
  /** Where the box comes off the ship, canonical. */
  discharge: string;
  options: number;
  dates: number;
  ts: number;
  /** Ocean transit — the median of this routing's options. */
  median: number | null;
  /**
   * Where this routing lands. Constant across a POL -> Last CY lane; the whole distinction in
   * destination mode, where one carrier may run one to Jacksonville and another to Savannah.
   */
  lastCy: string;
  /**
   * The carrier moves the box inland after discharging — `discharge` and `lastCy` are different
   * places. False when the box comes off the ship where the carrier hands it over.
   *
   * NOT A QUALITY JUDGEMENT, A PRIORITY ONE. See the service sort.
   */
  railLeg: boolean;
  /** The ground leg from `lastCy` to the customer's door. Only in destination mode. */
  dray?: Dray;
  /**
   * Ocean plus ground — what the customer actually waits.
   *
   * PRESENT ONLY IN DESTINATION MODE, and null there when either leg is unknown. Scoped to a lane
   * every routing ends in the same place, so a door figure would be the ocean figure plus a
   * constant: no information, and one more column to explain.
   */
  doorMedian?: number | null;
  /**
   * Not materially slower than the lane's median carrier — i.e. worth quoting.
   *
   * Set in a second pass, because the benchmark is the lane median and that is not known until
   * every carrier on the lane has been summarised. MEASURED ON DOOR TRANSIT when a ground leg is
   * known, because "can the customer live with this" stops being an ocean question the moment the
   * routings end in different places.
   */
  usable: boolean;
}

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
  /**
   * Ocean transit across every option this carrier offers — and THE figure the table is judged on.
   *
   * There was briefly a `door` spread beside this, ocean plus a banded drayage, and the ranking ran
   * on that. It is gone: drayage is not the carrier's leg, so it does not measure the carrier.
   */
  transit: Spread;
  /** Every Last CY this carrier reaches, in destination mode. One entry in lane mode. */
  lastCys: string[];
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
  mainRoute: Service | null;
  /**
   * EVERY routing this carrier runs, busiest first — `services[0]` IS `mainRoute`.
   *
   * The per-route breakdown was always computed here; it used to be thrown away except for the top
   * entry. Keeping it is what lets the table show a carrier's whole offer.
   */
  services: Service[];
  /**
   * How many of those routings are worth quoting, and how many options they carry between them.
   *
   * THIS IS THE ANSWER TO "HOW MANY REAL CHANCES DOES THIS CARRIER GIVE ME". A carrier's main
   * service being fast is one claim; having two or three routings that are all acceptable is a
   * different and often better one, because each is another shot at getting space at a transit the
   * customer can live with. WHL on Laem Chabang -> Los Angeles/Long Beach runs Taipei at 22 days
   * AND Shekou at 26 against a 26-day lane: 24 options across two usable routings, where the table
   * previously showed the Taipei line alone.
   *
   * It also catches the opposite case, which raw `options` cannot. WHL on Laem Chabang -> New York
   * publishes 32 options across three routings and only ONE of them is usable — the count says it
   * is the deepest carrier on the lane, and it has one real way plus two decoys.
   */
  usableServices: number;
  usableOptions: number;
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
export function carrierStats(
  rows: Schedule[],
  lane?: Lane,
  /**
   * Canonical Last CY -> its ground leg, for DISPLAY ONLY.
   *
   * ⚠ PASSING THIS CHANGES NO NUMBER THE TABLE IS RANKED BY. It attaches `dray` and `doorMedian` to
   * each service so the view can show what is left to solve once the carrier is done, and that is
   * all. The ordering, `vs lane` and the usable test are identical with it and without it — there
   * is a check pinning exactly that, because the previous version did let it into the ranking and
   * the coupling was invisible until a destination failed to resolve and blanked the table.
   *
   * Keyed on the CANONICAL name because that is what `Option.lastCy` carries. Keyed on the raw
   * value, every port complex missed: `Los Angeles, CA` rows produce `Los Angeles/Long Beach, CA`
   * options.
   */
  dray?: Map<string, Dray>,
): CarrierRow[] {
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
    // KEYED ON THE CHAIN *AND* THE LAST CY. A chain ends at the discharge port, so one carrier
    // discharging at Savannah for a Savannah Last CY and for an Atlanta ramp publishes the same
    // chain twice — one service on paper, two entirely different moves at the far end. Constant
    // within a POL -> Last CY lane, so this changes nothing there.
    const byRoute = new Map<string, Option[]>();
    for (const o of group) {
      const k = `${o.chain} ${o.lastCy}`;
      const b = byRoute.get(k);
      if (b) b.push(o);
      else byRoute.set(k, [o]);
    }
    //
    // THE WHOLE RANKING IS KEPT NOW, not just its head. `mainRoute` is `services[0]`, so nothing
    // about the headline changes — but a carrier that runs three acceptable routings stops being
    // described by one of them. `usable` is filled in below, once the lane median exists.
    const services: Service[] = [...byRoute.values()]
      .map((os) => {
        const leg = dray?.get(os[0].lastCy);
        const median = spreadOf(os.map((o) => o.transit)).median;
        return {
          label: os[0].chain,
          via: os[0].via,
          discharge: os[0].discharge,
          lastCy: os[0].lastCy,
          railLeg: os[0].discharge !== os[0].lastCy,
          dray: leg,
          options: os.length,
          dates: new Set(os.map((o) => o.date)).size,
          ts: Math.min(...os.map((o) => o.ts)),
          median,
          // Undefined rather than null in lane mode: there is no ground leg to know, which is a
          // different statement from "the ground leg is unknown".
          doorMedian: dray ? doorTransit(median, leg) : undefined,
          usable: false,
        };
      })
      // WATER TO THE HAND-OVER POINT FIRST, ahead of how often a routing runs.
      //
      // Carriers publish inland variants of the same move, and counted as options they can bury the
      // routing an operator would actually book. Measured, ONE on Nhava Sheva -> Los Angeles
      // publishes four: discharge at New York, Norfolk or Savannah and rail across the country, at
      // two options each, plus one that discharges at Los Angeles itself. All four are "direct" —
      // no transshipment — and the East Coast three run 41.5, 44 and 46.5 days against the LA
      // discharge's 35.5. Ordered by option count the single LA sailing came FOURTH and fell off the
      // stack into "+1 more", so the row named three cross-country rail moves and hid the one that
      // matters.
      //
      // THIS IS A PRIORITY, NOT A FILTER. The rail variants keep their options, stay usable, and
      // still count toward every figure on the row — they are real things a forwarder can quote, and
      // on a week when the water routing is full they are the answer. They just stop leading.
      //
      // A TRANSSHIPPED ROUTING THAT ENDS AT THE HAND-OVER POINT OUTRANKS A DIRECT ONE THAT RAILS.
      // Hand-offs at sea are a risk the carrier carries; a rail leg after discharge is a different
      // move on a different network, and that is the distinction being drawn here.
      .sort(
        (a, b) =>
          Number(a.railLeg) - Number(b.railLeg) ||
          b.options - a.options ||
          a.ts - b.ts ||
          (a.median ?? Infinity) - (b.median ?? Infinity),
      );

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
      lastCys: [...new Set(group.map((o) => o.lastCy))].sort(),
      pods: [...new Set(group.map((o) => o.pod))].sort(),
      nextEtd: dates[0] ?? null,
      lastEtd: dates[dates.length - 1] ?? null,
      avgTs: Math.round((group.reduce((n, o) => n + o.ts, 0) / group.length) * 100) / 100,
      mainRoute: services[0] ?? null,
      services,
      // Both filled in by the second pass; there is no lane median to judge against yet.
      usableServices: 0,
      usableOptions: 0,
      directUnknown: directOptions === 0,
    });
  }

  // THE RANKING IS OCEAN TRANSIT, ALWAYS. Drayage never enters it.
  //
  // It used to: with a ground leg known, `vs lane`, the usable test and the sort all ran on ocean
  // plus a banded drayage. That was defensible — the routings end in different places, so ocean
  // legs alone measure different journeys — and it was still wrong for this table.
  //
  // DRAYAGE IS CONTEXT, NOT COMPARISON. It says what is left to solve once the carrier has finished:
  // a cost and a piece of planning, on a leg the shipper arranges. Folding it into the transit
  // comparison mixed something a carrier is answerable for with something it is not, and it dragged
  // a working column down with it — a destination whose legs failed to resolve blanked `vs lane`
  // for the entire table, because there was no door figure left to compare.
  //
  // So the two live side by side and neither contaminates the other: ocean transit is the carrier's
  // performance, drayage distance is the ground you are left with, and the reader weighs them.
  const speed = (d: Draft) => d.transit.median;
  const serviceSpeed = (s: Service) => s.median;

  // The lane's own median carrier is the benchmark, not an absolute day count: 30 days is good on
  // one lane and poor on another, and the team is choosing between these carriers, not all lanes.
  const medians = drafts
    .map(speed)
    .filter((m): m is number => m != null)
    .sort((a, b) => a - b);
  const laneMedian = medians.length
    ? medians.length % 2 === 0
      ? (medians[medians.length / 2 - 1] + medians[medians.length / 2]) / 2
      : medians[(medians.length - 1) / 2]
    : null;

  const vsLane = (d: Draft) => {
    const v = speed(d);
    return v != null && laneMedian != null ? Math.round((v - laneMedian) * 10) / 10 : null;
  };

  // ONE MARGIN, ONE MEANING: 10% of the lane median is the smallest difference worth acting on.
  //
  // It is already the threshold that decides whether a thin carrier is *materially* faster (see the
  // sort below). Turning it around gives the definition of a usable service for free — a routing
  // within the margin is not materially SLOWER than typical, so it is one a customer can live with.
  // Inventing a second, differently-calibrated tolerance for the same judgment would be two numbers
  // that have to be kept in agreement by hand.
  const MATERIAL_GAIN = 0.1;

  // SECOND PASS: which of each carrier's routings are worth quoting.
  //
  // Deferred to here because the benchmark is the lane, and the lane is not known until every
  // carrier on it has been summarised. Mutating the `Service` objects in place keeps `mainRoute`
  // and `services[0]` the same object rather than two copies that could drift.
  const usableCeiling = laneMedian != null ? laneMedian * (1 + MATERIAL_GAIN) : null;
  for (const d of drafts) {
    for (const s of d.services) {
      // No lane median means no carrier published a transit at all. There is nothing to fail
      // against, so nothing is disqualified — the alternative would blank the whole lane and read
      // as "no carrier here is any good" when the truth is "no transit was published".
      //
      // A service with no median of its own IS disqualified, on the standing rule that a carrier
      // which has published no transit is not a fast one. It cannot be verified, so it is not
      // offered as a chance. In destination mode an unresolved ground leg disqualifies it for the
      // same reason — an unknown drayage is not a short one.
      const v = serviceSpeed(s);
      s.usable = usableCeiling == null ? true : v != null && v <= usableCeiling;
    }
    d.usableServices = d.services.filter((s) => s.usable).length;
    d.usableOptions = d.services.reduce((n, s) => n + (s.usable ? s.options : 0), 0);
  }

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
  // The margin is relative, not absolute: 10% of the lane median (`MATERIAL_GAIN`, above). It
  // clears EMC's 18% while still catching the case the rule was built for — 29 days against a
  // 30-day lane is 3%, and stays demoted.
  //
  // SAMPLE SIZE IS MEASURED IN USABLE OPTIONS. It counted options, which was already better than
  // dates — the guard and the statistic it guards have to count the same population — but raw
  // options are inflatable by publishing breadth, and the guard was the thing being fooled. WHL on
  // Laem Chabang -> New York publishes 32 options across three routings, and against that lane's
  // 41-day median only ONE of them is usable — a raw count sizes it as the deepest carrier there
  // when it is one real service plus two decoys. Counting only what is worth quoting sizes a
  // carrier by what it can actually deliver.
  const mostUsableOptions = Math.max(0, ...drafts.map((d) => d.usableOptions));
  const materiallyFaster = (d: Draft) => {
    const v = vsLane(d);
    return v != null && laneMedian != null && laneMedian > 0 && -v / laneMedian >= MATERIAL_GAIN;
  };
  const thin = (d: Draft) => d.usableOptions < mostUsableOptions * 0.25 && !materiallyFaster(d);

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
        // MORE USABLE ROUTINGS BREAKS THE TIE, ahead of raw speed. Two carriers alike on
        // directness and depth are not alike if one has a single acceptable routing and the other
        // has three: each extra routing is another chance at space at a transit that still works.
        // It sits below the thin guard on purpose — depth is a reason to prefer a carrier, not a
        // reason to promote one whose service is too small to rely on.
        // SPEED, THEN DEPTH — and it used to be the other way round.
        //
        // Usable ROUTINGS led, on the argument that each extra one is another chance at space. The
        // argument is sound and the measure was not: a routing is not a chance, an OPTION is, and
        // counting routings treats a two-option routing as worth the same as an eighteen-option
        // one. Measured on Semarang -> Los Angeles, EMC runs three usable routings carrying seven
        // options between them and HMM runs two carrying twenty-five. EMC led — on roughly a third
        // of the chances at space — because its third routing was worth two options and decisive.
        //
        // Counting usable OPTIONS instead was the obvious repair and is worse: on that same lane it
        // puts ONE (8 usable, one routing, the slowest of the group at 37.25 days) above EMC (7
        // usable, three routings, 34) on a one-option difference. Option counts are noise at that
        // margin.
        //
        // So speed orders them and depth breaks ties. Depth still decides between carriers that are
        // genuinely alike on transit, which is the case the key was written for; it no longer
        // outranks three days of sailing.
        //
        // LAST rather than Infinity for the null case: two carriers that both published no transit
        // would make `Infinity - Infinity` NaN, and a comparator returning NaN leaves the order
        // undefined rather than tied. Reachable — a carrier can publish departures with no arrival.
        //
        // Drayage is in neither key: it is not the carrier's leg, so it does not order carriers.
        (speed(a) ?? LAST) - (speed(b) ?? LAST) ||
        b.usableServices - a.usableServices ||
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

/**
 * Sorts-last sentinel for comparators. FINITE ON PURPOSE — `Infinity - Infinity` is NaN, and a
 * comparator that returns NaN produces an undefined order rather than a tie.
 */
const LAST = Number.MAX_SAFE_INTEGER;

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);

// `distinctDates` and `earliestEtd` are gone with the connection model. An Option already carries a
// non-null `date` — toOptions drops rows without one, since an unscheduled sailing is not something
// anyone can be quoted — so both collapse to a Set and a sort at the call site, and the null-safe
// ETD comparator they needed has nothing left to guard.
