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
  check("avg TS is reported per connection", [cs[0].avgTs, cs[1].avgTs], [1, 2]);
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
  check("...but has far fewer sailings behind it", thin.mainRoute.connections < deep.mainRoute.connections, true);
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
  check("...with its own count", c.mainRoute.connections, 9);
  check("...and its own median, not the best case", [c.mainRoute.median, c.transit.min], [30, 20]);
}

// ── MAIN SERVICE IS CHOSEN BY DATES, NOT CONNECTIONS ─────────────────────────────────
//
// A carrier can publish several onward vessels against one departure, so connection counts favour
// routings that are DUPLICATED over routings that are FREQUENT. OOCL on Ho Chi Minh -> Los Angeles
// showed it plainly: a Ningbo double-transship carried 8 connections across 2 dates while its
// direct Long Beach service carried 3 across 3. Picking by connections named the 2 TS chain as the
// main service of a carrier whose date columns read "4 direct" — a contradiction on a single row.
{
  const rows = [
    // Duplicated: 2 departures, four onward vessels each.
    ...[1, 3].flatMap((d) => [0, 1, 2, 3].map((v) => conn("C", day(d), 40, ["HUB", "HUB2"], "POD", `D${v}`))),
    // Frequent: 3 departures, one connection each.
    ...svc("C", 3, 30, [], "POD", 9),
  ];
  const c = carrierStats(rows, LANE)[0];
  check("main service is the routing with most DATES", c.mainRoute.label, "POD");
  check("...even though another has more connections", c.mainRoute.connections < 8, true);
  check("...and the badge counts dates", c.mainRoute.dates, 3);
  check("...so it does not contradict the date columns", [c.directDates, c.mainRoute.ts], [3, 0]);
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
  check("...carrying every departure", ls.find((l) => /Long Beach/.test(l.lastCy)).departures, 2);
  check(
    "...and the lane collects rows published under either",
    carrierStats(rows, { pol: "POL", lastCy: "Los Angeles/Long Beach, CA" })[0].sailDates,
    2,
  );
  // A lane named for an ordinary port must still match exactly — no widening by accident.
  check("an ordinary lane is unaffected", carrierStats(rows, { pol: "POL", lastCy: "Oakland, CA" })[0].sailDates, 1);
}

// ── DATES, NOT CONNECTIONS ───────────────────────────────────────────────────────────
// Several onward vessels off one feeder are one chance to ship, not four. Measured on the real
// lane, ONE published 78 connections against 9 departures inside a 12-day window.
{
  const rows = [
    ...[1, 2, 3].flatMap((d) => [0, 1, 2, 3, 4].map((v) => conn("PADDED", day(d), 40, ["HUB"], "POD", `P${v}`))),
    ...svc("REAL", 8, 40, ["HUB"], "POD", 1),
  ];
  const cs = carrierStats(rows, LANE);
  const padded = cs.find((c) => c.carrier === "PADDED");
  const real = cs.find((c) => c.carrier === "REAL");
  check("connections favour the padded carrier", padded.departures > real.departures, true);
  check("...but dates favour the real service", [real.sailDates, padded.sailDates], [8, 3]);
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

console.log(failed ? `\n${failed} failure(s)` : "\nall checks passed");
process.exit(failed ? 1 : 0);
