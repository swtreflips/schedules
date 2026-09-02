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

const { carrierStats } = await import("../src/lib/analytics/lane.ts");
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
