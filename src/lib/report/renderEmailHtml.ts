import type { CarrierRow, Service } from "../analytics/lane";
import type { LaneTable, WeeklyReport } from "./weeklyReport";

/**
 * Render the report as HTML that survives Outlook.
 *
 * OUTLOOK DESKTOP ON WINDOWS RENDERS WITH MICROSOFT WORD'S ENGINE, and that dictates everything
 * here. No flexbox, no grid, no float, no `<style>` block worth relying on, no border-radius, no
 * box-shadow, no web fonts, no background images. Layout is TABLES and styling is INLINE, on every
 * single element.
 *
 * This is why the report is generated rather than screenshotted from the app: none of the CSS the
 * view is built on survives the trip. The failure mode is nasty — it renders perfectly in the
 * browser preview and arrives in the inbox as an unstyled column of text — so `check-report.mjs`
 * asserts mechanically that none of those properties appear in the output.
 *
 * Colours are literal hex, not tokens, for the same reason: `var()` does not resolve in Word.
 * They mirror the app's linen palette so the email and the screen look related.
 *
 * THE DOCUMENT IS A LIST OF TABLES AND NOTHING ELSE. No board ranking lanes, no "who to ask"
 * section, no appendix. Those all drew a conclusion and asked the reader to trust it; the tables
 * carry the argument in their ordering, and a reader skimming them gets there themselves.
 */

const INK = "#112424";
const MUTED = "#756f67";
const FAINT = "#97918a";
const RULE = "#dad7d3";
const PANEL = "#f7f7f5";
const ACCENT = "#107ca6";
const FONT = "'Segoe UI', Arial, Helvetica, sans-serif";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const num = (n: number | null | undefined) => (n == null ? "—" : String(n));

// FONT AND COLOUR LIVE ON THE TABLE, NOT ON EVERY CELL — and that is a size decision, not a
// stylistic one. Repeating the full declaration on each cell produced a 121 KB email: 512 cells
// carrying ~120 bytes of style apiece. Gmail clips at about 102 KB and other clients slow down
// well before that, so the report would have arrived truncated. Cells now carry only what cannot
// be inherited — padding and their own border — which is roughly a third of the size.
//
// Alignment uses the `align` attribute rather than `text-align`, because Word honours the
// attribute more reliably than the property, and it is shorter.
const td = (content: string, right = false) =>
  `<td${right ? ' align="right"' : ""} style="padding:5px 8px;border-bottom:1px solid ${RULE};vertical-align:top">${content}</td>`;

const th = (content: string, right = false) =>
  `<th align="${right ? "right" : "left"}" style="padding:5px 8px;border-bottom:2px solid ${INK};font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:.06em;white-space:nowrap">${content}</th>`;

const table = (inner: string) =>
  `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;font-family:${FONT};font-size:12px;color:${INK}">${inner}</table>`;

// ── the carrier table, exactly as the screen ranks and shows it ───────────────────────
//
// NO DRAYAGE COLUMN, and that is the one difference from the app. Inside a port pair every carrier
// ends in the same place, so there is no ground leg to tell apart — which is precisely what makes
// this the stricter comparison and the one to put in front of a carrier.

const SERVICES_SHOWN = 3;

/**
 * A routing, named against the lane it is on rather than in full.
 *
 * The heading above the table already says where the box is going, so repeating the destination on
 * every line is noise — "via Taipei, Taiwan" beats "Taipei, Taiwan > Los Angeles/Long Beach, CA".
 *
 * THE FULL CHAIN SURVIVES WHEN THE DISCHARGE PORT IS NOT THE DESTINATION, because then it is not
 * repetition: an inland Last CY reached through Oakland is a materially different routing from the
 * same one through Houston, and that difference is the single biggest thing separating routings on
 * a rail lane.
 */
function routingName(label: string, destination: string): string {
  if (label === destination) return "direct";
  const suffix = ` > ${destination}`;
  return label.endsWith(suffix) ? `via ${label.slice(0, -suffix.length)}` : label;
}

/**
 * Which routings a row shows — the same selection the screen makes, so the two agree.
 *
 * A CARRIER ALWAYS NAMES WHAT IT RUNS, even when none of it clears the margin. Printing "nothing
 * within reach" and stopping left a row carrying options, a median and a sailing window beside an
 * empty cell, which reads as broken data rather than as a slow carrier.
 */
function shownServices(c: CarrierRow) {
  const usable = c.services.filter((s) => s.usable);
  const notUsable = c.services.filter((s) => !s.usable);
  return {
    usable,
    notUsable,
    shown: usable.length ? usable.slice(0, SERVICES_SHOWN) : notUsable.slice(0, 1),
    more: usable.length ? usable.length - usable.slice(0, SERVICES_SHOWN).length : 0,
    outOfReach: usable.length === 0,
  };
}

/** The routings, stacked. `<br>` is the only line break Word obeys. */
function servicesCell(c: CarrierRow, destination: string): string {
  const { shown, more, notUsable, outOfReach } = shownServices(c);

  const lines = shown.map((s) => {
    const body = `${esc(routingName(s.label, destination))} <span style="color:${MUTED}">×${s.options}</span>`;
    return outOfReach ? `<span style="color:${MUTED}">${body}</span>` : body;
  });
  if (!lines.length) lines.push(`<span style="color:${FAINT}">no published routing</span>`);

  const tail: string[] = [];
  if (outOfReach && shown.length) {
    tail.push(
      `out of reach${c.vsLaneMedian == null ? "" : ` — ${c.vsLaneMedian > 0 ? "+" : ""}${c.vsLaneMedian}d vs the lane`}`,
    );
    if (notUsable.length > 1) tail.push(`${notUsable.length - 1} other routing${notUsable.length === 2 ? "" : "s"}`);
  } else {
    if (more > 0) tail.push(`+${more} more usable`);
    if (notUsable.length > 0) tail.push(`+${notUsable.length} slower`);
  }
  if (tail.length) lines.push(`<span style="color:${FAINT};font-size:11px">${tail.join(" · ")}</span>`);

  return lines.join("<br>");
}

/** Each routing's own median, lined up with the routing beside it. */
function serviceMedianCell(c: CarrierRow): string {
  const { shown, outOfReach } = shownServices(c);
  if (!shown.length) return `<span style="color:${FAINT}">—</span>`;
  return shown
    .map((s: Service) => {
      const body = `${num(s.median)}${s.median == null ? "" : "d"}`;
      return outOfReach ? `<span style="color:${MUTED}">${body}</span>` : body;
    })
    .join("<br>");
}

const carrierHeader =
  "<tr>" +
  th("Carrier") +
  th("Direct", true) +
  th("1 TS", true) +
  th("2+ TS", true) +
  th("Options", true) +
  th("Dates", true) +
  th("Avg TS", true) +
  th("Main services") +
  th("Service median", true) +
  th("Ocean — median / range", true) +
  th("Spread", true) +
  th("vs lane", true) +
  th("Sailing window") +
  th("Scraped") +
  "</tr>";

function carrierRow(c: CarrierRow, destination: string, scraped: string | undefined): string {
  const vs =
    c.vsLaneMedian == null
      ? `<span style="color:${FAINT}">—</span>`
      : c.vsLaneMedian < 0
        ? `<strong style="color:${ACCENT}">${c.vsLaneMedian}d</strong>`
        : c.vsLaneMedian > 0
          ? `<span style="color:${MUTED}">+${c.vsLaneMedian}d</span>`
          : `<span style="color:${FAINT}">0d</span>`;

  const range =
    c.transit.min == null || c.transit.max == null
      ? ""
      : ` <span style="color:${MUTED};font-size:11px">${c.transit.min}–${c.transit.max}</span>`;

  const window =
    c.nextEtd == null
      ? "—"
      : c.nextEtd.slice(5, 10) +
        (c.lastEtd && c.lastEtd !== c.nextEtd
          ? ` <span style="color:${MUTED}">→ ${c.lastEtd.slice(5, 10)}</span>`
          : "");

  return (
    "<tr>" +
    td(`<strong>${esc(c.carrier)}</strong>`) +
    // Same honesty as the app: only the newest scrape per carrier and lane is kept, so no direct
    // sailing in the snapshot is not the same claim as the carrier running none.
    td(c.directUnknown ? `<span style="color:${FAINT}">none</span>` : String(c.directOptions), true) +
    td(c.ts1Options ? String(c.ts1Options) : `<span style="color:${FAINT}">—</span>`, true) +
    td(c.ts2Options ? String(c.ts2Options) : `<span style="color:${FAINT}">—</span>`, true) +
    td(`<strong>${c.options}</strong>`, true) +
    td(`<span style="color:${MUTED}">${c.sailDates}</span>`, true) +
    td(c.avgTs.toFixed(2), true) +
    td(servicesCell(c, destination)) +
    td(serviceMedianCell(c), true) +
    td(`${num(c.transit.median)}${range}`, true) +
    td(
      c.transit.spread == null
        ? `<span style="color:${FAINT}">—</span>`
        : c.transit.spread >= 20
          ? `<span style="color:${ACCENT}">${c.transit.spread}d</span>`
          : `${c.transit.spread}d`,
      true,
    ) +
    td(vs, true) +
    td(`<span style="font-size:11px">${window}</span>`) +
    td(`<span style="color:${FAINT};font-size:11px">${scraped ? esc(scraped.slice(0, 10)) : "—"}</span>`) +
    "</tr>"
  );
}

const laneSection = (t: LaneTable, scraped: Map<string, string>) =>
  `<p style="margin:26px 0 2px;font-family:${FONT};font-size:15px;font-weight:600;color:${INK};">` +
  `${esc(t.pol)} — ${esc(t.destination)}</p>` +
  `<p style="margin:0 0 6px;font-family:${FONT};font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:.06em;">` +
  `Carriers — most direct first, then fewest transshipments` +
  (t.laneMedian == null ? "" : ` · lane median ${t.laneMedian}d`) +
  `</p>` +
  table(carrierHeader + t.carriers.map((c) => carrierRow(c, t.destination, scraped.get(c.carrier))).join(""));

/**
 * GMAIL CLIPS A MESSAGE NEAR 102 KB, and a clipped report is worse than a short one — the reader
 * gets a "[Message clipped]" link where the rest of the document should be.
 *
 * Only the clipboard flavour is budgeted. The file is meant to be complete.
 */
const SIZE_BUDGET = 98 * 1024;

// UTF-8 bytes, not string length: the report is full of ×, →, · and en dashes, and the clip
// threshold is measured in bytes.
const bytes = (s: string) => new TextEncoder().encode(s).length;

/**
 * @param full  Render every port pair. Off, the document is trimmed to fit an email body.
 */
export function renderEmailHtml(r: WeeklyReport, full = false): string {
  const head =
    `<div style="font-family:${FONT};color:${INK};">` +
    `<p style="margin:0 0 2px;font-size:19px;font-weight:600;">${esc(r.subject)}</p>` +
    // The snapshot date is stated up front. A report that hides how old its data is gets trusted
    // once and distrusted permanently.
    `<p style="margin:0 0 4px;font-size:12px;color:${MUTED};">` +
    `${r.coverage.carriers} carriers · ${r.coverage.lanes} port pairs · ${r.coverage.pols} load ports · ` +
    `${r.coverage.sailings} options` +
    (r.snapshotAt ? ` · schedules as scraped ${esc(r.snapshotAt.slice(0, 10))}` : "") +
    `</p>`;

  const legend =
    `<div style="margin-top:26px;padding:10px 12px;background:${PANEL};font-size:11px;color:${MUTED};line-height:1.5;">` +
    `<strong style="color:${INK};">The columns</strong> — ` +
    `<strong>Options</strong>: one routing on one day, what a forwarder can be asked to quote; ` +
    `several onward vessels off the same feeder are one option, not four. ` +
    `<strong>Dates</strong>: days a box can actually leave on. ` +
    `<strong>Avg TS</strong>: mean transshipments per option. ` +
    `<strong>Main services</strong>: the routings within 10% of the lane median, busiest first, with ` +
    `<strong>Service median</strong> beside them line for line. ` +
    `<strong>Ocean</strong> is the carrier's median across everything it runs, so it matches a ` +
    `service median only when a carrier runs one service. ` +
    `<strong>Spread</strong>: slowest minus fastest. ` +
    `<strong>vs lane</strong>: against this lane's median carrier.` +
    `<br><br>One snapshot of published schedules, not a booking guarantee. Carriers republish ` +
    `routings between scrapes, so read a lane with no direct service as "none this week" rather ` +
    `than "none". Each table is one port pair — POL to Last CY — so every carrier in it ends in ` +
    `the same place.` +
    `</div></div>`;

  const parts: string[] = [];
  let spent = bytes(head) + bytes(legend);
  let shown = 0;

  for (const lane of r.lanes) {
    const block = laneSection(lane, r.scrapedByCarrier);
    const cost = bytes(block);
    if (!full && spent + cost > SIZE_BUDGET) break;
    parts.push(block);
    spent += cost;
    shown += 1;
  }

  const trimmed =
    shown < r.lanes.length
      ? `<p style="margin:18px 0 0;font-family:${FONT};font-size:12px;color:${MUTED};">` +
        `Showing ${shown} of ${r.lanes.length} port pairs — download the .html for all of them.</p>`
      : "";

  return head + parts.join("") + trimmed + legend;
}

/** Plain-text fallback, so a client that refuses HTML still shows something legible. */
export function renderEmailText(r: WeeklyReport): string {
  const lines: string[] = [r.subject, ""];
  lines.push(
    `${r.coverage.carriers} carriers, ${r.coverage.lanes} port pairs, ${r.coverage.sailings} options` +
      (r.snapshotAt ? `, scraped ${r.snapshotAt.slice(0, 10)}` : ""),
    "",
  );
  for (const lane of r.lanes) {
    lines.push(
      `${lane.pol.toUpperCase()} — ${lane.destination.toUpperCase()}` +
        (lane.laneMedian == null ? "" : `  (lane median ${lane.laneMedian}d)`),
    );
    for (const c of lane.carriers) {
      const { shown } = shownServices(c);
      const svc = shown.length
        ? shown.map((s) => `${routingName(s.label, lane.destination)} x${s.options} ${num(s.median)}d`).join(" | ")
        : "no published routing";
      lines.push(
        `  ${c.carrier}: ${c.directUnknown ? "no direct" : `${c.directOptions} direct`}, ` +
          `${c.options} options / ${c.sailDates} dates, ${c.avgTs.toFixed(2)} avg TS, ` +
          `median ${num(c.transit.median)} — ${svc}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
