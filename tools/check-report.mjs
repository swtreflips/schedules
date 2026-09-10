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

// ── TWO OUTPUTS, ONE RENDERER ────────────────────────────────────────────────────────
//
// "Generate report" writes a FILE: every lane with a carrier choice gets its table, because a
// reader scrolls and completeness is the point. "Copy" puts the report in an Outlook message body,
// where Gmail clips near 102 KB — so that one is budgeted, and says so when it trims.
//
// Measured on the live market: 51 lane tables at 375 KB full, against 6 tables at 98 KB copied.
{
  // Only a lane HEADING carries a figure after the phrase; the legend uses it twice as prose.
  const tables = (h) => (h.match(/lane median [0-9]/g) ?? []).length;

  // A MARKET BIG ENOUGH FOR THE BUDGET TO BITE. The small fixture above renders well under 102 KB
  // either way, so `full` and `!full` produce the same document and a test on it proves nothing —
  // verified by flipping the flag off and watching every assertion still pass. Sixty lanes of eight
  // carriers is the shape of the live market (73 lanes, 51 with a choice).
  const BIG = [];
  for (let lane = 0; lane < 60; lane += 1)
    for (const [i, carrier] of ["A", "B", "C", "D", "E", "F", "G", "H"].entries())
      BIG.push(...svc(carrier, "POL_BIG", `DEST_${lane}`, 6, 30 + i * 3, i % 2 ? ["HUB_LONG_NAME"] : []));

  const bigReport = buildWeeklyReport(BIG, { today: new Date(2026, 8, 1) });
  const full = renderEmailHtml(bigReport, true);
  const budgeted = renderEmailHtml(bigReport, false);

  check("the big fixture really does overflow the budget", budgeted.length < full.length, true);
  check("every lane with a choice gets a carrier table", tables(full), bigReport.laneTables.length);
  check("...and the full render never stops short", full.includes("Showing the top"), false);
  check("...while the budgeted one trims, and says so", budgeted.includes("Showing the top"), true);
  check("...staying under Gmail's clip", budgeted.length < 102 * 1024, true);

  // The Word rules are not relaxed just because this path is bigger — it is still HTML someone may
  // open in Outlook after saving it.
  for (const [name, re] of [
    ["no flex in the full render", /display:\s*flex/],
    ["no grid in the full render", /display:\s*grid/],
    ["no border-radius in the full render", /border-radius/],
    ["no position: in the full render", /position:/],
    ["no var(-- in the full render", /var\(--/],
  ]) check(name, re.test(full), false);
}

// ── DEGENERATE INPUT ─────────────────────────────────────────────────────────────────
{
  const empty = buildWeeklyReport([], { today: new Date(2026, 8, 1) });
  check("no market does not crash", [empty.byPol.length, empty.attention.length], [0, 0]);
  check("...and still renders", renderEmailHtml(empty).includes("Weekly Ocean Schedule Report"), true);
}

console.log(failed ? `\n${failed} failure(s)` : "\nall checks passed");
process.exit(failed ? 1 : 0);
