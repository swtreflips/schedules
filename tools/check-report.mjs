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
check("subject carries a dd.mm.yyyy date", report.subject, "Ocean Schedule Report — 01.09.2026");
check("date helper pads single digits", reportDate(new Date(2026, 0, 5)), "05.01.2026");

// ── EVERY PORT PAIR GETS A TABLE, AND THE DOCUMENT IS NOTHING ELSE ───────────────────
//
// The report used to lead with a board ranking lanes by what picking the right carrier was worth,
// then a per-load-port board, then a single-carrier appendix. All three were the report drawing a
// conclusion and asking to be trusted on it. They are gone: the tables carry the argument in their
// ordering, which is the same reason lane.ts refuses to print a score or a tier label.
{
  check("one entry per port pair", report.lanes.map((l) => l.destination).sort(), ["BIG_CHOICE", "NO_SPREAD", "ONLY_ONE"]);

  // A LANE WITH ONE CARRIER IS STILL A LANE. It used to be filtered into an appendix on the grounds
  // that there is no decision to make on it — but a lane missing from a report reads as no service
  // rather than as one carrier, and the reader is the one who decides whether it matters.
  const solo = report.lanes.find((l) => l.destination === "ONLY_ONE");
  check("a single-carrier lane still gets its table", solo.carriers.length, 1);
  check("...and appears in the rendered document", html.includes("ONLY_ONE"), true);

  check("no lane board", html.includes("Where carrier choice matters most"), false);
  check("...and no 'who to ask' section", html.includes("Who to ask"), false);
  check("...and no single-carrier appendix", html.includes("no choice to make"), false);
}

// ── THE REPORT AGREES WITH THE SCREEN ────────────────────────────────────────────────
// Both are derived from carrierStats, so the ranking cannot drift between them. A report that
// quietly contradicts the tool it came from is worse than no report.
{
  const onScreen = carrierStats(MARKET, { pol: "POL_A", lastCy: "BIG_CHOICE" });
  const inReport = report.lanes.find((l) => l.destination === "BIG_CHOICE");
  check("carrier count matches the view", inReport.carriers.length, onScreen.length);
  check("...and so does the ORDER", inReport.carriers.map((c) => c.carrier), onScreen.map((c) => c.carrier));
  check("lane median is the median of the carrier medians", inReport.laneMedian, 35);
}

// ── THE FULL CARRIER TABLE, NOT A SUMMARY OF IT ──────────────────────────────────────
// The whole point of the change: the report shows what the screen shows, one port pair at a time.
{
  for (const col of ["Direct", "1 TS", "2+ TS", "Options", "Dates", "Avg TS", "Main services",
                     "TS ports", "POD", "Service median", "Ocean", "Spread", "vs lane",
                     "Sailing window", "Scraped"])
    check(`the table carries "${col}"`, html.includes(col), true);

  // TWO COLUMNS THE SCREEN HAS AND THIS MUST NOT. Drayage: inside a port pair every carrier ends in
  // the same place, so there is no ground leg to tell apart. Last CY: it IS the frame here, named in
  // the heading, so a column would repeat one value down the whole table.
  check("...but not Drayage distance", html.includes("Drayage"), false);
  check("...nor Door", html.includes(">Door<"), false);
  check("...nor a Last CY column", html.includes(">Last CY<"), false);

  // EVERY HEADER ROW AND EVERY BODY ROW MUST BE THE SAME WIDTH. A colSpan that disagrees with the
  // cell count throws nothing — it silently shifts every row after it one column left.
  const widths = new Set();
  for (const tr of html.match(/<tr>.*?<\/tr>/g) ?? []) {
    let n = 0;
    for (const cell of tr.match(/<t[dh][^>]*>/g) ?? []) {
      const cs = cell.match(/colspan="(\d+)"/i);
      n += cs ? Number(cs[1]) : 1;
    }
    if (n) widths.add(n);
  }
  check("every row in the document is the same width", [...widths], [16]);
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
  check("plain-text fallback exists", renderEmailText(report).includes("POL_A — BIG_CHOICE"), true);
}

// ── TWO OUTPUTS, ONE RENDERER ────────────────────────────────────────────────────────
//
// "Generate report" writes a FILE: every lane with a carrier choice gets its table, because a
// reader scrolls and completeness is the point. "Copy" puts the report in an Outlook message body,
// where Gmail clips near 102 KB — so that one is budgeted, and says so when it trims.
//
// Measured on the live market: 73 port pairs full, against a handful in the clipboard flavour.
{
  // Only a lane HEADING carries a figure after the phrase; the legend uses it once as prose.
  const tables = (h) => (h.match(/lane median [0-9]/g) ?? []).length;

  // A MARKET BIG ENOUGH FOR THE BUDGET TO BITE. The small fixture above renders well under 102 KB
  // either way, so `full` and `!full` produce the same document and a test on it proves nothing —
  // verified by flipping the flag off and watching every assertion still pass. Sixty lanes of eight
  // carriers is roughly the shape of the live market.
  const BIG = [];
  for (let lane = 0; lane < 60; lane += 1)
    for (const [i, carrier] of ["A", "B", "C", "D", "E", "F", "G", "H"].entries())
      BIG.push(...svc(carrier, "POL_BIG", `DEST_${lane}`, 6, 30 + i * 3, i % 2 ? ["HUB_LONG_NAME"] : []));

  const bigReport = buildWeeklyReport(BIG, { today: new Date(2026, 8, 1) });
  const full = renderEmailHtml(bigReport, true);
  const budgeted = renderEmailHtml(bigReport, false);

  check("the big fixture really does overflow the budget", budgeted.length < full.length, true);
  check("every port pair gets a carrier table", tables(full), bigReport.lanes.length);
  check("...and the full render never stops short", full.includes("Showing "), false);
  check("...while the budgeted one trims, and says so", budgeted.includes("Showing "), true);
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
  check("no market does not crash", [empty.lanes.length, empty.coverage.lanes], [0, 0]);
  check("...and still renders", renderEmailHtml(empty).includes("Ocean Schedule Report"), true);
  // No lanes means no tables at all. The legend still renders and still names the columns, which is
  // why this checks for the markup rather than for the words.
  check("...with no carrier table in it", renderEmailHtml(empty).includes("<table"), false);
}

console.log(failed ? `\n${failed} failure(s)` : "\nall checks passed");
process.exit(failed ? 1 : 0);
