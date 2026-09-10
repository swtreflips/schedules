// Regression tests for the carrier ordering in the Analytics view.
//
//   npm run test:analytics
//
// WHY THIS EXISTS. There is no score and no label here — the SORT is the recommendation. A reader
// glances at the top row and calls that carrier. So the ordering is the product, and a broken
// ordering fails silently: it keeps returning plausible carrier codes in a wrong sequence, and
// nothing on screen says so. None of the rules below is visible by looking at the rendered table.
//
// Fixtures are synthetic but shaped from the real lanes, so no database is needed. Ordering
// verified against SQL on 2026-09-01 for Qingdao -> Los Angeles and Semarang -> Los Angeles.
//
// Node does not resolve extensionless relative imports; Vite and tsc "bundler" resolution do. The
// hook tries `<specifier>.ts`, so these run against the REAL source rather than a copy.

import { register } from "node:module";
register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(spec, ctx, next) {
        try { return await next(spec, ctx) }
        catch (e) {
          if (spec.startsWith('.') && !/\\.[a-z]+$/i.test(spec)) return next(spec + '.ts', ctx)
          throw e
        }
      }
    `),
  import.meta.url,
);

const { carrierStats, corridorStats, lanesIn } = await import("../src/lib/analytics/lane.ts");
const { laneVerdict } = await import("../src/lib/analytics/rfq.ts");
const { drayDays, doorTransit, toDray } = await import("../src/lib/analytics/drayage.ts");

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failed += 1;
    console.error(`FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok    ${name}`);
  }
};

const LANE = { pol: "POL", lastCy: "CY" };
const order = (rows) => carrierStats(rows, LANE).map((c) => c.carrier);

const day = (n) => `2026-09-${String(n).padStart(2, "0")}`;
const conn = (carrier, etd, days, via = [], pod = "POD", vessel = "V1") => ({
  carrier_code: carrier,
  mother_vessel: vessel,
  etd,
  eta: null,
  port_of_loading: "POL",
  port_of_discharge: pod,
  last_cy: "CY",
  transit_time_days: days,
  transport_type: via.length ? "1 TS" : "Direct",
  ts_ports: via,
  ts_vessels: [],
  vessel_sequence: [vessel, ...via.map((_, i) => `ON${i}`)],
  route_ports: [],
});
/** `count` sailings on distinct dates, all the same transit and routing. */
const svc = (carrier, count, days, via = [], pod = "POD", start = 1) =>
  Array.from({ length: count }, (_, i) => conn(carrier, day(start + i * 2), days, via, pod, `${carrier}${i}`));

/** Same, but landing at a named Last CY — for the destination-mode fixtures. */
const svcTo = (carrier, count, days, lastCy, via = [], pod = "POD", start = 1) =>
  svc(carrier, count, days, via, pod, start).map((r) => ({ ...r, last_cy: lastCy }));

// ── DIRECT COMES FIRST ───────────────────────────────────────────────────────────────
// A direct booking has no hand-off where space can be lost, so direct sailing DATES lead the sort
// regardless of how fast someone else's transshipped service looks.
{
  const rows = [
    ...svc("FEW_DIRECT", 3, 30, []),
    ...svc("FAST_TS", 12, 18, ["HUB"]), // faster and far more frequent, but transshipped
  ];
  check("direct outranks a faster transshipped service", order(rows)[0], "FEW_DIRECT");
}

// ── THEN THE SHALLOWEST ROUTING ──────────────────────────────────────────────────────
// Average transshipments separates a carrier that always runs one hand-off from one that runs
// two. On the real lane it alone splits WHL (1.00 TS, 25.5-day median) from HPL (2.00, 42.0).
{
  const rows = [
    ...svc("ONE_HOP", 6, 34, ["HUB"]),
    ...svc("TWO_HOP", 6, 33, ["HUB", "HUB2"]), // marginally faster, but doubles the hand-offs
  ];
  const cs = carrierStats(rows, LANE);
  check("shallower routing wins on equal directness", cs[0].carrier, "ONE_HOP");
  check("avg TS is reported per OPTION", [cs[0].avgTs, cs[1].avgTs], [1, 2]);
}

// ── THE TIEBREAK IS VOLUME-WEIGHTED ──────────────────────────────────────────────────
//
// Sorting on the MAIN SERVICE median let three departures beat twenty. On the real Semarang lane,
// COS came second at 29 days off 3 sailings, ahead of HMM at 31 off 20. The overall median is
// weighted by volume simply by being a median over every sailing, so it is what orders the table;
// the main-service figure stays a column because what a carrier runs most is worth seeing.
{
  const rows = [
    // Thin: one quick service, nothing else.
    ...svc("THIN", 3, 29, ["HUB"]),
    // Deep: a big service at 31, plus enough more at 31 to hold the overall median there.
    ...svc("DEEP", 20, 31, ["HUB"], "POD", 1),
  ];
  const cs = carrierStats(rows, LANE);
  const thin = cs.find((c) => c.carrier === "THIN");
  const deep = cs.find((c) => c.carrier === "DEEP");
  check("the thin carrier really is faster on its main service", thin.mainRoute.median < deep.mainRoute.median, true);
  check("...but has far fewer sailings behind it", thin.mainRoute.options < deep.mainRoute.options, true);
  check("...and does not outrank the deep service", order(rows), ["DEEP", "THIN"]);
}

// ── ...BUT A MATERIALLY FASTER THIN SERVICE IS NOT BURIED ────────────────────────────
//
// The thin rule stops 3 sailings outranking 20 on a two-day edge. It must not bury a real
// advantage: on Semarang -> Savannah, EMC runs 4 dates at a 44.5-day median against a 54.5-day
// lane — ten days, 18% — and sank below carriers it beats outright. Naming a carrier in an RFQ is
// a rate request, not a booking, so a candidate that good has to surface and let the reader judge
// its four dates. The margin is relative (10% of the lane median), which is why the 3% case above
// still sinks and this one does not.
{
  const rows = [
    ...svc("BULK", 20, 55, ["HUB"]),
    ...svc("BULK2", 16, 54, ["HUB"]),
    ...svc("QUICK", 4, 44, ["HUB"]), // few dates, but ~19% under the lane
  ];
  const cs = carrierStats(rows, LANE);
  const quick = cs.find((c) => c.carrier === "QUICK");
  check("a thin service is still thin", quick.sailDates < cs.find((c) => c.carrier === "BULK").sailDates, true);
  check("...but a material gain is not demoted", order(rows)[0], "QUICK");
  check("...and it is genuinely faster than the lane", quick.vsLaneMedian < 0, true);
}

// ── SAILING WINDOW: SMALL IS NOT THE SAME AS ENDING ──────────────────────────────────
// EMC's four dates ran Aug 30 to Sep 12 while HMM ran to Oct 23. Both look thin in a count; only
// the window says one of them is closing.
{
  const rows = [...svc("ENDING", 4, 40, ["HUB"], "POD", 1), ...svc("ONGOING", 4, 40, ["HUB"], "POD", 15)];
  const cs = carrierStats(rows, LANE);
  const ending = cs.find((c) => c.carrier === "ENDING");
  check("first and last sailing are both reported", [ending.nextEtd, ending.lastEtd], ["2026-09-01", "2026-09-07"]);
  check("...and differ from a later service", cs.find((c) => c.carrier === "ONGOING").nextEtd, "2026-09-15");
}

// ── MAIN SERVICE IS THE ONE ACTUALLY RUN MOST ────────────────────────────────────────
{
  const rows = [
    ...svc("X", 2, 20, ["RARE"], "POD", 1), // fast but rare
    ...svc("X", 9, 30, ["USUAL"], "POD", 5), // what the carrier actually offers
  ];
  const c = carrierStats(rows, LANE)[0];
  check("main service is the most-run routing", c.mainRoute.label, "USUAL > POD");
  check("...with its own count, in options not connections", [c.mainRoute.options, c.mainRoute.dates], [9, 9]);
  check("...and its own median, not the best case", [c.mainRoute.median, c.transit.min], [30, 20]);
}

// ── A CARRIER IS NOT ONE SERVICE ─────────────────────────────────────────────────────
//
// The table used to describe a carrier by its busiest routing alone, which reads correctly only
// when everything else it runs is much worse. Measured on Laem Chabang -> Los Angeles/Long Beach,
// ZIM runs three routings at 23, 25 and 27.5 days against a 26-day lane and WHL runs two at 22 and
// 26 — extra chances at space that the row did not mention.
//
// USABLE MEANS WITHIN 10% OF THE LANE MEDIAN, the same margin the sort already uses to decide a
// difference is worth acting on.
{
  // Carrier medians land at 28 / 30 / 55, so the LANE median is 30 and the ceiling is 33. The
  // second service sits at 32 — STRICTLY between the two, so it is usable only because of the
  // margin. Put it on the median instead and the fixture passes with any margin at all, testing
  // nothing.
  const rows = [
    ...svc("DEEP", 12, 28, ["A"], "POD", 1), // main service, comfortably inside
    ...svc("DEEP", 4, 32, ["B"], "POD", 3), // slightly worse — still usable, and the point
    ...svc("DEEP", 4, 60, ["C"], "POD", 5), // far worse — a decoy
    ...svc("FLAT", 8, 30, ["A"], "POD", 2),
    ...svc("SLOW", 8, 55, ["A"], "POD", 4),
  ];
  const cs = carrierStats(rows, LANE);
  const deep = cs.find((c) => c.carrier === "DEEP");
  const slow = cs.find((c) => c.carrier === "SLOW");

  check("services[0] IS mainRoute, the same object", deep.services[0] === deep.mainRoute, true);
  check("every routing is kept, not just the busiest", deep.services.length, 3);
  check("...ordered by how often each runs", deep.services.map((s) => s.options), [12, 4, 4]);
  check("...their options sum to the carrier's", deep.services.reduce((n, s) => n + s.options, 0), deep.options);

  check("a routing slightly worse than the lane is USABLE", deep.services[1].usable, true);
  check("...it is inside the margin, not on the median", [deep.services[1].median, deep.vsLaneMedian], [32, -2]);
  check("...a far worse one is not usable", deep.services[2].usable, false);
  check("two usable routings, three run", [deep.usableServices, deep.services.length], [2, 3]);
  check("usableOptions counts only those two", deep.usableOptions, 16);
  check("a carrier with nothing in reach reads zero", [slow.usableServices, slow.usableOptions], [0, 0]);
}

// ── DRAYAGE IS CONTEXT, NOT COMPARISON ───────────────────────────────────────────────
//
// THE CENTRAL GUARANTEE: passing a dray map changes no number the table is ranked by. Drayage is a
// leg the SHIPPER arranges — a cost and a piece of planning left over once the carrier is done — so
// it says what remains to solve and takes no part in judging the carrier.
//
// It used to. `vs lane`, the usable test and the sort all ran on ocean plus a banded drayage, and
// the coupling was invisible until a destination's legs failed to resolve: with no door figure to
// compare, `vs lane` blanked for the entire table and every routing was marked usable, including
// ones twenty days out of reach. A column that can take the rest of the table down with it is doing
// more than its job.
{
  const rows = [
    ...svcTo("A", 6, 20, "Jacksonville, FL"),
    ...svcTo("B", 6, 30, "Jacksonville, FL", ["H"], "POD", 2),
    ...svcTo("C", 6, 40, "Savannah, GA", ["H"], "POD", 3),
  ];
  const legs = new Map([
    ["Jacksonville, FL", { miles: 84, hours: 1.6, days: 1 }],
    // Long enough to have flipped the old ranking outright.
    ["Savannah, GA", { miles: 900, hours: 13, days: 3 }],
  ]);

  const bare = carrierStats(rows, undefined);
  const withLegs = carrierStats(rows, undefined, legs);
  const empty = carrierStats(rows, undefined, new Map());
  const partial = carrierStats(rows, undefined, new Map([["Jacksonville, FL", { miles: 84, hours: 1.6, days: 1 }]]));

  const shape = (cs) => cs.map((c) => [c.carrier, c.vsLaneMedian, c.usableServices]);
  check("the ranking is the same with a dray map as without", shape(withLegs), shape(bare));
  check("...with an empty one", shape(empty), shape(bare));
  check("...and with a partial one", shape(partial), shape(bare));
  check("...and those are real figures, not blanks", shape(bare), [["A", -10, 1], ["B", 0, 1], ["C", 10, 0]]);

  // What the map DOES do: hang a ground leg on each routing for the column to show.
  check("the map attaches a leg to the routing", withLegs.find((c) => c.carrier === "C").services[0].dray.miles, 900);
  check("...and none when it was not measured", partial.find((c) => c.carrier === "C").services[0].dray, undefined);
  check("...while still naming the routing", partial.find((c) => c.carrier === "C").services[0].lastCy, "Savannah, GA");
}

// A LANE WITH NO PUBLISHED TRANSIT HAS NO BENCHMARK, so nothing is disqualified. Zeroing every
// carrier would read as "no carrier here is any good" when the truth is "no transit was published".
{
  const rows = [...svc("A", 3, null, [], "POD", 1), ...svc("B", 3, null, ["H"], "POD", 2)];
  const cs = carrierStats(rows, LANE);
  check("no lane median means every routing stays usable", cs.map((c) => c.usableServices), [1, 1]);
  check("...and their options are all counted", cs.map((c) => c.usableOptions), [3, 3]);
}

// ── BREADTH IS NOT DEPTH ─────────────────────────────────────────────────────────────
//
// The thin-service guard sizes a carrier so three sailings cannot outrank twenty on a two-day edge.
// It counted raw options, which are inflatable by publishing routings nobody would book: WHL on
// Laem Chabang -> New York publishes 32 options across three routings and only ONE is usable
// against that lane's 41-day median. Counting usable options sizes a carrier by what it can
// actually deliver.
// THE VICTIM IS THE SMALL CARRIER, not the padded one. Shaped from the real case: HPL on
// Ho Chi Minh -> Los Angeles/Long Beach offers 6 options and ALL SIX are usable, and it was
// demoted as thin because the lane's yardstick was another carrier's 36 options, 23 of which
// nobody would book. Measuring the yardstick in usable options rescues it.
{
  const rows = [
    ...svc("SMALL", 6, 31, ["A"], "POD", 1), // small, but every option is worth having
    ...svc("ANCHOR", 12, 32, ["C"], "POD", 2), // the biggest genuinely usable service
    ...svc("PADDED", 6, 30, ["A"], "POD", 3), // 36 raw options, only 6 of them real
    ...svc("PADDED", 30, 90, ["B"], "POD", 1),
  ];
  const cs = carrierStats(rows, LANE);
  const padded = cs.find((c) => c.carrier === "PADDED");
  const small = cs.find((c) => c.carrier === "SMALL");

  check("the padded carrier holds the most raw options", padded.options, 36);
  check("...but only six of them are usable", [padded.usableServices, padded.usableOptions], [1, 6]);
  check("...so it no longer sets the yardstick", small.usableOptions >= padded.usableOptions, true);
  // Under the old raw-options guard this read ANCHOR, PADDED, SMALL — the wholly usable carrier last.
  check("the small, wholly usable carrier is not demoted", cs.map((c) => c.carrier), ["SMALL", "ANCHOR", "PADDED"]);
}

// MORE USABLE ROUTINGS BREAKS A TIE. Two carriers alike on directness, depth and substance are not
// alike if one has a single acceptable routing and the other has two.
{
  const rows = [
    ...svc("ONE_WAY", 10, 29, ["A"], "POD", 1),
    ...svc("TWO_WAYS", 5, 29, ["A"], "POD", 2),
    ...svc("TWO_WAYS", 5, 30, ["B"], "POD", 4),
  ];
  const cs = carrierStats(rows, LANE);
  check("the carrier with two usable routings leads", cs.map((c) => c.carrier), ["TWO_WAYS", "ONE_WAY"]);
  check("...on depth, not on speed", cs.map((c) => c.usableServices), [2, 1]);
}

// ── A DUPLICATED ROUTING IS NOT A FREQUENT ONE ───────────────────────────────────────
//
// A carrier can publish several onward vessels against one departure. Counted as connections, that
// made a routing look popular for being duplicated: OOCL on Ho Chi Minh -> Los Angeles carried a
// Ningbo double-transship with 8 connections across 2 dates against a direct with 3 across 3, and
// picking by connections named the 2 TS chain as the main service of a carrier whose columns read
// "4 direct" — a contradiction on one row.
//
// COUNTING OPTIONS REMOVES THE TRAP RATHER THAN GUARDING AGAINST IT: eight connections on two days
// are two options, so the duplicated routing cannot outrank the frequent one however many vessels
// it is published against.
{
  const rows = [
    // Duplicated: 2 departures, four onward vessels each.
    ...[1, 3].flatMap((d) => [0, 1, 2, 3].map((v) => conn("C", day(d), 40, ["HUB", "HUB2"], "POD", `D${v}`))),
    // Frequent: 3 departures, one connection each.
    ...svc("C", 3, 30, [], "POD", 9),
  ];
  const c = carrierStats(rows, LANE)[0];
  check("main service is the routing with most OPTIONS", c.mainRoute.label, "POD");
  check("...the duplicated routing collapses to 2 options", c.mainRoute.options, 3);
  check("...and the badge counts options", c.mainRoute.options, 3);
  check("...so it does not contradict the option columns", [c.directOptions, c.mainRoute.ts], [3, 0]);
  check("...and the columns still sum to options", c.directOptions + c.ts1Options + c.ts2Options, c.options);
}

// ── PORT COMPLEXES ARE ONE SERVICE ───────────────────────────────────────────────────
//
// Los Angeles and Long Beach are distinct ports and one harbour. Split, COSCO's direct sailings on
// Ho Chi Minh -> Los Angeles were divided between the two berths, so its main service under-counted
// and each half competed with the other to be named. A Long Beach discharge against a Los Angeles
// Last CY was also flagged as having a rail leg, which is a truck move across one bay.
{
  const la = (etd, pod) => ({
    ...conn("C", etd, 30, [], pod),
    last_cy: "Los Angeles, CA",
  });
  const rows = [la(day(1), "Long Beach, CA"), la(day(3), "Long Beach, CA"), la(day(5), "Los Angeles, CA")];
  const lane = { pol: "POL", lastCy: "Los Angeles, CA" };
  const c = carrierStats(rows, lane)[0];
  check("both berths are one service", c.mainRoute.label, "Los Angeles/Long Beach, CA");
  check("...covering every date", c.mainRoute.dates, 3);
  check("...counted as one corridor", c.corridors, 1);
  check("...but the published berths are still listed", c.pods, ["Long Beach, CA", "Los Angeles, CA"]);
  check("...and the corridor view agrees", corridorStats(rows, lane).length, 1);
  check("...with no rail leg invented", corridorStats(rows, lane)[0].hasRailLeg, false);

  // The exception is narrow: a genuinely different coast stays a different service.
  const oak = [...rows, { ...la(day(7), "Oakland, CA") }];
  check("a different port is still a different service", corridorStats(oak, lane).length, 2);
}

// ── ...AND ONE LANE, NOT TWO ─────────────────────────────────────────────────────────
//
// The same fact applies to Last CY. Carriers publish either berth as the delivery point, so keying
// lanes on the raw string split seven load ports in two: Ho Chi Minh -> Long Beach held 69
// departures that never appeared in the Ho Chi Minh -> Los Angeles table the reader was comparing.
{
  const cy = (etd, lastCy) => ({ ...conn("C", etd, 30, [], lastCy), last_cy: lastCy });
  const rows = [cy(day(1), "Long Beach, CA"), cy(day(3), "Los Angeles, CA"), cy(day(5), "Oakland, CA")];
  const ls = lanesIn(rows);
  check("both berths are one lane", ls.map((l) => l.lastCy).sort(), ["Los Angeles/Long Beach, CA", "Oakland, CA"]);
  check("...carrying every option", ls.find((l) => /Long Beach/.test(l.lastCy)).options, 2);
  check(
    "...and the lane collects rows published under either",
    carrierStats(rows, { pol: "POL", lastCy: "Los Angeles/Long Beach, CA" })[0].sailDates,
    2,
  );
  // A lane named for an ordinary port must still match exactly — no widening by accident.
  check("an ordinary lane is unaffected", carrierStats(rows, { pol: "POL", lastCy: "Oakland, CA" })[0].sailDates, 1);
}

// ── PADDING CANNOT BUY RANK ──────────────────────────────────────────────────────────
// Several onward vessels off one feeder are one thing a forwarder can quote, not four. Measured on
// the real lane, ONE published 78 connections against 9 departures inside a 12-day window.
//
// Under connections the padded carrier led 15 to 8. Under options it does not lead at all — this
// assertion is the inverse of the one it replaces, and that inversion is the point of the model.
{
  const rows = [
    ...[1, 2, 3].flatMap((d) => [0, 1, 2, 3, 4].map((v) => conn("PADDED", day(d), 40, ["HUB"], "POD", `P${v}`))),
    ...svc("REAL", 8, 40, ["HUB"], "POD", 1),
  ];
  const cs = carrierStats(rows, LANE);
  const padded = cs.find((c) => c.carrier === "PADDED");
  const real = cs.find((c) => c.carrier === "REAL");
  check("options do NOT favour the padded carrier", padded.options < real.options, true);
  check("...15 connections are 3 options", [padded.options, padded.sailDates], [3, 3]);
  check("...and dates agree with them", [real.options, real.sailDates], [8, 8]);
  check("...and the real service ranks first", order(rows)[0], "REAL");
}

// ── VERDICT ──────────────────────────────────────────────────────────────────────────
// A lane with no direct service must read as a hard market, not an empty screen. It states the
// market only — it does not name carriers; the sort does that.
{
  const allTs = carrierStats([...svc("A", 6, 30, ["HUB"]), ...svc("B", 6, 33, ["HUB"])], LANE);
  check("no-direct lane reads tough", laneVerdict(LANE, allTs).tone, "tough");
  check("...and names no carrier to quote", /quote/i.test(laneVerdict(LANE, allTs).detail), false);

  const direct = carrierStats([...svc("A", 8, 20, []), ...svc("B", 8, 21, [])], LANE);
  check("direct-rich lane reads healthy", laneVerdict(LANE, direct).tone, "healthy");
  check("empty lane does not crash", laneVerdict(LANE, []).tone, "tough");
}

// ── NULLS ────────────────────────────────────────────────────────────────────────────
// transit_time_days is nullable and really is null in production. Unmeasured is not fast, so a
// carrier with no published transit must sort last rather than first.
{
  const rows = [...svc("KNOWN", 6, 25, []), ...[1, 3, 5, 7].map((d) => conn("UNKNOWN", day(d), null, []))];
  const cs = carrierStats(rows, LANE);
  const unk = cs.find((c) => c.carrier === "UNKNOWN");
  check("null transit stays null", [unk.transit.median, unk.vsLaneMedian], [null, null]);
  check("...produces no NaN", Number.isNaN(unk.avgTs), false);
  check("...and sorts behind a measured carrier", order(rows), ["KNOWN", "UNKNOWN"]);
}

// ── WHAT AN OPTION IS ────────────────────────────────────────────────────────────────
//
// One routing, on one day, from one carrier — what a forwarder actually quotes. The two counts it
// replaces distorted it in opposite directions, so both directions are asserted here.
{
  // Several onward vessels on one chain and one day are ONE option. Measured on the real market,
  // ONE published `Singapore > Los Angeles/Long Beach` on 2026-09-10 as twenty-two connections.
  const many = [0, 1, 2, 3, 4, 5].map((v) => conn("C", day(1), 30 + v, ["HUB"], "POD", `V${v}`));
  const one = carrierStats(many, LANE)[0];
  check("six onward vessels on one chain are one option", [one.options, one.sailDates], [1, 1]);
  // 30..35 -> median 32.5. The option carries the median of its arrivals, not the best of them.
  check("...carrying the median of its arrivals, not the best", one.transit.median, 32.5);

  // Two routings on one day are TWO options, which is the case `dates` used to hide. Measured, 334
  // of 1,707 (carrier, lane, date) cells carry more than one chain.
  const both = [conn("C", day(1), 25, [], "POD"), conn("C", day(1), 31, ["TAIPEI"], "POD")];
  const two = carrierStats(both, LANE)[0];
  check("a direct and a transship on one day are two options", [two.options, two.sailDates], [2, 1]);
  check("...split across the depth columns", [two.directOptions, two.ts1Options], [1, 1]);
}

// ── THE INVARIANT THE DELETED RULE USED TO HAND-MAINTAIN ─────────────────────────────
//
// Counting dates meant classifying each date by its shallowest routing so Direct + 1 TS + 2+ TS
// would add up. An option has exactly one depth, so the columns sum BY CONSTRUCTION — and this
// asserts it across a deliberately awkward mix rather than on one tidy carrier.
{
  const rows = [
    // One carrier offering direct, 1 TS and 2 TS on the SAME day, plus duplicates of each.
    ...[0, 1, 2].map((v) => conn("MIX", day(1), 25, [], "POD", `A${v}`)),
    conn("MIX", day(1), 30, ["HUB"], "POD", "B0"),
    ...[0, 1].map((v) => conn("MIX", day(1), 44, ["HUB", "HUB2"], "POD", `C${v}`)),
    // ...and a second day carrying only a transship.
    conn("MIX", day(4), 31, ["HUB"], "POD", "D0"),
    ...svc("OTHER", 5, 28, [], "POD", 2),
  ];
  for (const c of carrierStats(rows, LANE)) {
    check(
      `${c.carrier}: direct + 1 TS + 2+ TS === options`,
      c.directOptions + c.ts1Options + c.ts2Options,
      c.options,
    );
  }
  const mix = carrierStats(rows, LANE).find((c) => c.carrier === "MIX");
  check("...six connections on one day are three options", [mix.options, mix.sailDates], [4, 2]);
  check("...one per depth on the shared day, plus the second day's",
    [mix.directOptions, mix.ts1Options, mix.ts2Options], [1, 2, 1]);
}

// ── CORRIDOR OPTIONS EXCEED CORRIDOR DATES WHEN CARRIERS SHARE A ROUTING ─────────────
//
// The chain is fixed within a corridor row, so it is tempting to think options and dates must
// match there. They do not: a corridor spans carriers, and two of them sailing one routing on one
// day are two things you can be quoted and one day you can leave.
{
  const rows = [
    conn("A", day(1), 30, ["HUB"], "POD"),
    conn("B", day(1), 32, ["HUB"], "POD"),
    conn("A", day(6), 31, ["HUB"], "POD"),
  ];
  const [corr] = corridorStats(rows, LANE);
  check("two carriers on one routing and one day", [corr.options, corr.sailDates], [3, 2]);
  check("...and both are named on the row", corr.carriers, ["A", "B"]);
}

// ── DESTINATION MODE: THE LANE IS THE CUSTOMER'S DOOR ────────────────────────────────
//
// Scoped to a port pair every carrier ends in the same place, so ocean transit is a fair
// comparison. Scoped to a DESTINATION they do not: a Gainesville, FL warehouse is 84 road miles
// from Jacksonville and 210 from Savannah. Comparing ocean legs then measures different journeys —
// the same objection the file already raises against comparing on discharge port.

// The Last CY entering the option key must be INVISIBLE inside a port pair. If it is not, every
// number in the report moved, and the report is the thing that must not move.
{
  const rows = [...svc("A", 4, 30, ["H"]), ...svc("B", 3, 28, [])];
  const cs = carrierStats(rows, LANE);
  check("lane mode: option counts are untouched by the Last CY key", cs.map((c) => c.options), [3, 4]);
  check("...and so are the services", cs.map((c) => c.services.length), [1, 1]);
  check("...with no door figure invented", cs.every((c) => c.door === undefined), true);
  check("...and no dray on any service", cs.every((c) => c.services.every((s) => !s.dray)), true);
}

// Two Last CYs on one chain and one day are TWO options. This is what stops Jacksonville and
// Savannah collapsing into one routing the moment the frame stops naming a single port.
{
  const rows = [
    { ...conn("A", day(1), 26, ["H"], "POD"), last_cy: "Jacksonville, FL" },
    { ...conn("A", day(1), 28, ["H"], "POD"), last_cy: "Savannah, GA" },
  ];
  const c = carrierStats(rows)[0];
  check("two Last CYs on one chain and one day are two options", c.options, 2);
  check("...and two services, not one", c.services.length, 2);
  check("...each naming where it lands", c.services.map((s) => s.lastCy).sort(), ["Jacksonville, FL", "Savannah, GA"]);
  check("...and the carrier lists both", c.lastCys, ["Jacksonville, FL", "Savannah, GA"]);
}

// A CARRIER WITH NOTHING USABLE STILL HAS SERVICES TO NAME.
//
// Reported as a bug from Cartagena -> Seymour, IN: HMM showed 2 options, a 27.5-day median, a
// spread and a sailing window beside an EMPTY services cell, while Rank plainly listed its two
// Cincinnati sailings. The classification was right — 28.5 days door against a 20-day lane is 8.5
// over, so nothing is usable — but a row that says a carrier exists and then declines to say what
// it runs reads as broken data.
//
// `usableServices` stays 0 and the carrier stays last. What must not be zero is `services`: the
// renderer falls back to those, dimmed, so there is always something to name.
{
  const rows = [
    ...svc("FAST", 8, 11, ["H"]),
    ...svc("MID", 8, 19, ["H"], "POD", 2),
    ...svc("SLOW", 2, 27.5, ["H"], "POD", 3),
  ];
  const cs = carrierStats(rows, LANE);
  const slow = cs.find((c) => c.carrier === "SLOW");
  check("nothing this carrier runs is usable", slow.usableServices, 0);
  check("...it is genuinely well over the lane", slow.vsLaneMedian > 5, true);
  check("...and it still sorts last", cs[cs.length - 1].carrier, "SLOW");
  // The guarantee the empty cell violated: there is always a routing to fall back to.
  check("...but its routing is still there to show", slow.services.length, 1);
  check("...with a label, a count and a median", [slow.services[0].label, slow.services[0].options, slow.services[0].median], ["H > POD", 2, 27.5]);
}

// THE DRAY IS MEASURED FROM THE LAST CY, NOT THE DISCHARGE PORT — and they differ often.
//
// Measured on Nhava Sheva -> Gainesville, FL: HPL discharges at Savannah and carries the box on to
// Tampa, and 26 of the 53 rows that search returns are that shape. The customer's drayage starts at
// Tampa (137 mi), not Savannah (210). A service line naming only the chain would read as Savannah
// being 137 miles away.
{
  const rows = svcTo("HPL", 6, 46, "Tampa, FL", [], "Savannah, GA");
  const dray = new Map([
    ["Tampa, FL", { miles: 137, hours: 2.3, days: 1 }],
    ["Savannah, GA", { miles: 210, hours: 3.3, days: 2 }],
  ]);
  const s = carrierStats(rows, undefined, dray)[0].services[0];
  check("the chain ends at the discharge port", s.label, "Savannah, GA");
  check("...the hand-over is somewhere else", s.lastCy, "Tampa, FL");
  check("...and the dray is measured from the hand-over", s.dray.miles, 137);
  check("...so door transit uses Tampa's band, not Savannah's", s.doorMedian, 47);
  // What the cell must render: the two are different, so both have to be named.
  check("...which the row has to say out loud", s.label.endsWith(s.lastCy), false);
}

// The banding, at its edges. These are a judgement about how the move runs, so the edges are the
// part worth pinning: an off-by-one here silently reorders the table.
{
  check("a 150-mile dray is one day", drayDays(150), 1);
  check("...151 is two", drayDays(151), 2);
  check("...400 is still two", drayDays(400), 2);
  check("...401 is three", drayDays(401), 3);
  check("a zero-mile dray is still a day, never nothing", drayDays(0), 1);
  check("door transit adds the band", doorTransit(26, { miles: 210, hours: 3.3, days: 2 }), 28);
  check("no ocean transit means no door transit", doorTransit(null, { miles: 84, hours: 1.6, days: 1 }), null);
  check("...and neither does an unresolved ground leg", doorTransit(26, undefined), null);
}

// ── THE GROUND LEG IS SHOWN, NEVER SCORED ────────────────────────────────────────────
//
// Savannah is a day faster on the water and 126 road miles worse on the ground. Under the previous
// contract those cancelled: banded to days they tied at 28 and the shorter dray broke it, so JAX
// led. Drayage no longer touches the ranking, so SAV leads on its ocean leg and the miles sit
// beside it for the reader to weigh — a day of sailing against a couple of hours of trucking.
//
// Numbers are the ones the live router returned for a Gainesville, FL warehouse, built through
// `toDray` so the banding is wired in rather than asserted by hand.
{
  const rows = [
    ...svcTo("SAV", 6, 26, "Savannah, GA", ["H"]),
    ...svcTo("JAX", 6, 27, "Jacksonville, FL", ["H"], "POD", 2),
  ];
  const dray = new Map([
    ["Savannah, GA", toDray(210 * 1609.34, 3.3 * 3600)],
    ["Jacksonville, FL", toDray(84 * 1609.34, 1.6 * 3600)],
  ]);
  check("the router's metres and seconds band correctly", [dray.get("Savannah, GA").miles, dray.get("Savannah, GA").days], [210, 2]);
  check("...and the short one to a single day", [dray.get("Jacksonville, FL").miles, dray.get("Jacksonville, FL").days], [84, 1]);

  const withLegs = carrierStats(rows, undefined, dray);
  check("the faster sailing leads, ground leg notwithstanding", withLegs.map((c) => c.carrier), ["SAV", "JAX"]);
  check("...identically to having no dray map at all", withLegs.map((c) => c.carrier), carrierStats(rows).map((c) => c.carrier));
  check("...ocean transit is what is reported", withLegs.map((c) => c.transit.median), [26, 27]);
  check("...and each routing carries its own miles", withLegs.map((c) => c.services[0].dray.miles), [210, 84]);
}

// A GROUND LEG LONG ENOUGH TO DOMINATE THE JOURNEY STILL DOES NOT MOVE THE TABLE.
//
// Five carriers on identical 9-day sailings, one of them landing 900 miles from the door. Under the
// previous contract that was disqualifying — the banded three days blew past a 10% margin on a
// short lane — and it dropped to last. Now every carrier is equal on the water, so the table says
// so, and the 900 miles is the reader's to price.
{
  const rows = [
    ...svcTo("A", 4, 9, "Nearby, FL", ["H"]),
    ...svcTo("B", 4, 9, "Nearby, FL", ["H"], "POD", 2),
    ...svcTo("C", 4, 9, "Nearby, FL", ["H"], "POD", 3),
    ...svcTo("D", 4, 9, "Nearby, FL", ["H"], "POD", 4),
    ...svcTo("FAR", 4, 9, "Far, TX", ["H"], "POD", 5),
  ];
  const dray = new Map([
    ["Nearby, FL", { miles: 84, hours: 1.6, days: 1 }],
    ["Far, TX", { miles: 900, hours: 13, days: 3 }],
  ]);
  const cs = carrierStats(rows, undefined, dray);
  const far = cs.find((c) => c.carrier === "FAR");
  check("the distant carrier sails as well as the rest", far.transit.median, 9);
  check("...so its routing stays usable", far.usableServices, 1);
  check("...and vs lane is untouched by 900 ground miles", far.vsLaneMedian, 0);
  check("...with the miles on the row to weigh", far.services[0].dray.miles, 900);
}

// An unresolved ground leg costs the carrier nothing, because it was never being judged on it.
{
  const rows = [
    ...svcTo("KNOWN", 6, 30, "Jacksonville, FL", ["H"]),
    ...svcTo("UNKNOWN", 6, 25, "Nowhere, ZZ", ["H"], "POD", 2),
  ];
  const dray = new Map([["Jacksonville, FL", { miles: 84, hours: 1.6, days: 1 }]]);
  const cs = carrierStats(rows, undefined, dray);
  const unk = cs.find((c) => c.carrier === "UNKNOWN");
  check("the faster sailing leads even with no ground leg measured", cs[0].carrier, "UNKNOWN");
  check("...its routing is usable on the water", unk.usableServices, 1);
  check("...vs lane is a real figure, not a dash", unk.vsLaneMedian, -2.5);
  check("...and only the miles are missing", unk.services[0].dray, undefined);
}

console.log(failed ? `\n${failed} failure(s)` : "\nall checks passed");
process.exit(failed ? 1 : 0);
