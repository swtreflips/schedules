// Regression tests for the weekly email report.
//
//   npm run test:report
//
// WHY THIS EXISTS. This output is never seen before it is sent. Two failure modes are invisible in
// development and obvious in an inbox:
//
//   1. Unsupported CSS. Outlook desktop renders with Microsoft Word's engine — no flexbox, no
//      grid, no `<style>` block, no border-radius. Any of those renders perfectly in a browser
//      preview and arrives as an unstyled column of text.
//   2. Size. The first working version came out at 121 KB because every one of 512 cells carried
//      its own font and colour. Gmail clips around 102 KB, so the report would have arrived
//      truncated — with no error anywhere.
//
// Both are asserted mechanically below, because neither is catchable by looking.
//
// Node does not resolve extensionless relative imports; Vite and tsc "bundler" resolution do.

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

const { buildWeeklyReport, reportDate } = await import("../src/lib/report/weeklyReport.ts");
const { renderEmailHtml, renderEmailText } = await import("../src/lib/report/renderEmailHtml.ts");
const { carrierStats } = await import("../src/lib/analytics/lane.ts");

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

const day = (n) => `2026-09-${String(n).padStart(2, "0")}`;
const conn = (carrier, pol, cy, etd, days, via = []) => ({
  carrier_code: carrier,
  mother_vessel: "V",
  etd,
  eta: null,
  port_of_loading: pol,
  port_of_discharge: cy,
  last_cy: cy,
  transit_time_days: days,
  transport_type: via.length ? "1 TS" : "Direct",
  ts_ports: via,
  ts_vessels: [],
  vessel_sequence: [carrier + etd],
  route_ports: [],
});
const svc = (carrier, pol, cy, count, days, via = [], start = 1) =>
  Array.from({ length: count }, (_, i) => conn(carrier, pol, cy, day(start + i * 2), days, via));

// A market with: a lane where choice is worth a lot, a lane where it is worth nothing, and a
// single-carrier lane where there is no choice at all.
const MARKET = [
  ...svc("FAST", "POL_A", "BIG_CHOICE", 6, 20),
  ...svc("MID", "POL_A", "BIG_CHOICE", 6, 35),
  ...svc("SLOW", "POL_A", "BIG_CHOICE", 6, 50),
  ...svc("X", "POL_A", "NO_SPREAD", 5, 30),
  ...svc("Y", "POL_A", "NO_SPREAD", 5, 30),
  ...svc("SOLO", "POL_B", "ONLY_ONE", 4, 40),
];

const report = buildWeeklyReport(MARKET, { snapshotAt: "2026-08-31T06:35:09Z", today: new Date(2026, 8, 1) });
const html = renderEmailHtml(report);

// ── THE SUBJECT, IN THE FORMAT ALREADY IN USE ────────────────────────────────────────
check("subject carries a dd.mm.yyyy date", report.subject, "Weekly Ocean Schedule Report — 01.09.2026");
check("date helper pads single digits", reportDate(new Date(2026, 0, 5)), "05.01.2026");

// ── EDGE: WHAT PICKING THE RIGHT CARRIER IS WORTH ────────────────────────────────────
// Three carriers at 20 / 35 / 50 put the lane median at 35 and the best at 20, so choosing well
// is worth 15 days. Two carriers both at 30 means the choice is worth nothing, and the report has
// to say so rather than imply an advantage that is not there.
{
  const big = report.byPol.flatMap((g) => g.rows).find((r) => r.destination === "BIG_CHOICE");
  const flat = report.byPol.flatMap((g) => g.rows).find((r) => r.destination === "NO_SPREAD");
  check("best carrier is the fastest by median", [big.best.carrier, big.best.median], ["FAST", 20]);
  check("edge is lane median minus best", big.edge, 15);
  check("a lane where every carrier is alike has no edge", flat.edge, 0);
  check("...and is not in the attention list", report.attention.some((r) => r.destination === "NO_SPREAD"), false);
  check("the lane with a real edge is", report.attention[0].destination, "BIG_CHOICE");
}

// ── SINGLE-CARRIER LANES ARE SEPARATED ───────────────────────────────────────────────
// An edge of 0 on a ten-carrier lane means "every carrier is equivalent"; on a one-carrier lane it
// means "there is no choice". Sharing a column would make both unreadable.
{
  check("single-carrier lane is set aside", report.singleCarrier.map((r) => r.destination), ["ONLY_ONE"]);
  check("...and kept out of the board", report.byPol.flatMap((g) => g.rows).some((r) => r.destination === "ONLY_ONE"), false);
  check("...and out of the attention list", report.attention.some((r) => r.destination === "ONLY_ONE"), false);
}

// ── THE REPORT AGREES WITH THE SCREEN ────────────────────────────────────────────────
// Both are derived from carrierStats. A Monday email that quietly contradicts the tool it is
// advertising is worse than no email.
{
  const lane = { pol: "POL_A", lastCy: "BIG_CHOICE" };
  const onScreen = carrierStats(MARKET, lane);
  const inReport = report.byPol.flatMap((g) => g.rows).find((r) => r.destination === "BIG_CHOICE");
  check("carrier count matches the view", inReport.carriers, onScreen.length);
  const fastestOnScreen = [...onScreen].sort((a, b) => a.transit.median - b.transit.median)[0];
  check("best carrier matches the view", inReport.best.carrier, fastestOnScreen.carrier);
}

// ── OUTLOOK SAFETY, ASSERTED RATHER THAN EYEBALLED ───────────────────────────────────
{
  for (const prop of ["flex", "grid", "border-radius", "box-shadow", "position:", "<style", "var(--"]) {
    check(`no ${prop}`, html.includes(prop), false);
  }
  const tds = html.match(/<td[^>]*>/g) || [];
  check("every cell carries an inline style", tds.filter((t) => !t.includes("style=")).length, 0);
  check("tables use the legacy attributes Word honours", html.includes('cellpadding="0"'), true);
  check("fonts are declared, not assumed", html.includes("font-family"), true);
}

// ── SIZE ─────────────────────────────────────────────────────────────────────────────
// Gmail clips at roughly 102 KB. The real market renders around 72 KB; a failure here means
// something is being embedded that should not be.
{
  check("fixture report is small", html.length < 100 * 1024, true);
  check("plain-text fallback exists", renderEmailText(report).includes("WHERE CARRIER CHOICE MATTERS MOST"), true);
}

// ── DEGENERATE INPUT ─────────────────────────────────────────────────────────────────
{
  const empty = buildWeeklyReport([], { today: new Date(2026, 8, 1) });
  check("no market does not crash", [empty.byPol.length, empty.attention.length], [0, 0]);
  check("...and still renders", renderEmailHtml(empty).includes("Weekly Ocean Schedule Report"), true);
}

console.log(failed ? `\n${failed} failure(s)` : "\nall checks passed");
process.exit(failed ? 1 : 0);
