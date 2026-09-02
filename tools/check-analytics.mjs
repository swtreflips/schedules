// Regression tests for the carrier ranking that drives the RFQ shortlist.
//
//   npm run test:analytics
//
// WHY THIS EXISTS. The shortlist is a recommendation the team acts on — it decides which carriers
// we ask forwarders to quote. It is also a composite, and a composite fails quietly: it keeps
// returning three plausible carrier codes long after the reasoning behind them has broken. None of
// these rules is visible by looking at the rendered table.
//
// The fixtures are synthetic but shaped from the real lanes, so the file needs no database.
// Numbers verified against SQL on 2026-09-01, Qingdao -> Los Angeles and Semarang -> Los Angeles.
//
// Node does not resolve extensionless relative imports; Vite and tsc "bundler" resolution do. The
// hook below tries `<specifier>.ts`, so the tests exercise the REAL source rather than a copy.

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
const { shortlist, laneVerdict } = await import("../src/lib/analytics/rfq.ts");

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

/** One connection. `days` sets transit; `via` sets the transshipment path. */
const conn = (carrier, etd, days, via = [], vessel = "V1") => ({
  carrier_code: carrier,
  mother_vessel: vessel,
  etd,
  eta: `2026-10-${String((Number(etd.slice(-2)) + 20) % 28 + 1).padStart(2, "0")}`,
  port_of_loading: "POL",
  port_of_discharge: "POD",
  last_cy: "CY",
  transit_time_days: days,
  transport_type: via.length ? "1 TS" : "Direct",
  ts_ports: via,
  ts_vessels: [],
  vessel_sequence: [vessel, ...via.map((_, i) => `ON${i}`)],
  route_ports: [],
});

const day = (n) => `2026-09-${String(n).padStart(2, "0")}`;
const spread = (carrier, count, days, via, startDay = 1, step = 2) =>
  Array.from({ length: count }, (_, i) => conn(carrier, day(startDay + i * step), days + (i % 3), via, `V${i}`));

// ── THE CONNS TRAP — the bug this ranking exists to fix ──────────────────────────────
//
// A carrier can publish many connections against few departures: several onward vessels off one
// feeder. Measured on the real lane, ONE showed 78 connections against HMM's 42 — but ONE's were
// 9 dates inside 12 days while HMM's were 18 dates across 40. Ranked on connections ONE leads by
// 2x; on the chance of getting a box away it is third.
const manyConnsFewDates = [
  // 3 dates, but 5 onward vessels each = 15 connections
  ...[1, 2, 3].flatMap((d) =>
    [0, 1, 2, 3, 4].map((v) => conn("FAKE", day(d), 40 + v, ["HUB"], `F${v}`)),
  ),
  // 8 dates spread over a month, 1 connection each = 8 connections
  ...spread("REAL", 8, 30, ["HUB"], 1, 4),
];
{
  const cs = carrierStats(manyConnsFewDates, LANE);
  const fake = cs.find((c) => c.carrier === "FAKE");
  const real = cs.find((c) => c.carrier === "REAL");
  check("connection count favours the wrong carrier", fake.departures > real.departures, true);
  check("sail dates favour the right one", real.sailDates > fake.sailDates, true);
  check("chances follow dates, not connections", real.chances > fake.chances, true);
  check("the real service is preferred", real.tier, "preferred");
  check("the padded one is not", fake.tier !== "preferred", true);
}

// ── THE SPEED GATE ───────────────────────────────────────────────────────────────────
//
// A slow carrier must not set the bar that excludes a fast one. On Qingdao, HPL tied CMA at 24.0
// chances while running 8.5 days slower, and knocked COS — faster and more direct — off the list.
{
  const rows = [
    ...spread("BEST", 10, 20, [], 1, 3), // many direct, fast
    ...spread("SLOW", 10, 34, ["HUB"], 1, 3), // equal volume, much slower
    ...spread("GOOD", 5, 20, [], 2, 4), // fewer dates, fast
  ];
  const cs = carrierStats(rows, LANE);
  const get = (n) => cs.find((c) => c.carrier === n);
  check("slow carrier is not preferred", get("SLOW").tier !== "preferred", true);
  check("slow carrier reads as slower", get("SLOW").vsLaneMedian > 0, true);
  check("the fast, thinner carrier keeps its slot", get("GOOD").tier, "preferred");
}

// ── NO PADDING ───────────────────────────────────────────────────────────────────────
// A thin lane may honestly support one or two names. Padding to three recommends a carrier the
// data does not support, which is the mistake the view exists to prevent.
{
  const rows = [
    ...spread("A", 10, 25, [], 1, 3),
    ...spread("B", 8, 25, [], 1, 3), // same speed, fewer dates
    ...spread("TINY", 1, 24, [], 5, 1), // fastest, but a single date
  ];
  const cs = carrierStats(rows, LANE);
  const sl = shortlist(LANE, cs);
  check("shortlist stops short of 3", sl.carriers.length, 2);
  check("a single sailing date is never an option", cs.find((c) => c.carrier === "TINY").tier, "avoid");
  check("the sentence names only the qualifiers", sl.sentence.includes("TINY"), false);
}

// ── THE GATE IS STRICT ON PURPOSE ────────────────────────────────────────────────────
//
// Being even slightly slower than the lane's median carrier disqualifies. That looks harsh — a
// day on a 30-day transit is noise — but loosening it undoes the ranking. Re-measured on the real
// Semarang lane, a +2-day tolerance readmits ONE, whose 78 connections are 9 dates inside a
// 12-day window: precisely the carrier this model exists to demote. The gate is what keeps volume
// from buying its way past speed, so it stays at the median.
{
  const rows = [
    ...spread("FAST", 6, 25, [], 1, 4),
    ...spread("BULK", 12, 27, [], 1, 2), // twice the dates, marginally slower
  ];
  const cs = carrierStats(rows, LANE);
  const bulk = cs.find((c) => c.carrier === "BULK");
  check("higher volume does not outrank being slower", bulk.tier !== "preferred", true);
  check("...even with twice the sailing dates", bulk.sailDates > cs.find((c) => c.carrier === "FAST").sailDates, true);
}

// ── VERDICTS ─────────────────────────────────────────────────────────────────────────
// A lane with no direct service must read as a hard market, not an empty screen.
{
  const allTs = carrierStats([...spread("A", 6, 30, ["HUB"]), ...spread("B", 6, 33, ["HUB"])], LANE);
  check("no-direct lane reads tough", laneVerdict(LANE, allTs).tone, "tough");
  check("...and still yields a shortlist", shortlist(LANE, allTs).carriers.length > 0, true);

  const mostlyDirect = carrierStats([...spread("A", 8, 20, []), ...spread("B", 8, 21, [])], LANE);
  check("direct-rich lane reads healthy", laneVerdict(LANE, mostlyDirect).tone, "healthy");

  check("empty lane does not crash", laneVerdict(LANE, []).tone, "tough");
  check("empty lane gives an open-quote sentence", shortlist(LANE, []).carriers.length, 0);
}

// ── NULLS ────────────────────────────────────────────────────────────────────────────
// transit_time_days is nullable and really is null in production. Unmeasured is not fast.
{
  const cs = carrierStats(
    [...spread("KNOWN", 6, 25, []), ...[1, 3, 5, 7].map((d) => conn("UNKNOWN", day(d), null, []))],
    LANE,
  );
  const unk = cs.find((c) => c.carrier === "UNKNOWN");
  check("null transit stays null", unk.vsLaneMedian, null);
  check("...and never reaches preferred", unk.tier !== "preferred", true);
  check("...and produces no NaN", Number.isNaN(unk.chances), false);
}

console.log(failed ? `\n${failed} failure(s)` : "\nall checks passed");
process.exit(failed ? 1 : 0);
