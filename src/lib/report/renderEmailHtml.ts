import type { CarrierRow } from "../analytics/lane";
import type { BoardRow, LaneTable, WeeklyReport } from "./weeklyReport";

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
  `<td${right ? ' align="right"' : ""} style="padding:5px 8px;border-bottom:1px solid ${RULE}">${content}</td>`;

const th = (content: string, right = false) =>
  `<th align="${right ? "right" : "left"}" style="padding:5px 8px;border-bottom:2px solid ${INK};font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:.06em;white-space:nowrap">${content}</th>`;

/** One board line. `showPol` is off inside a POL group, where the heading already says it. */
function row(r: BoardRow, showPol: boolean): string {
  const edge =
    r.edge == null || r.edge <= 0
      ? `<span style="color:${FAINT}">—</span>`
      : `<strong style="color:${r.edge >= 10 ? ACCENT : INK}">${r.edge}d</strong>`;

  const best = r.best
    ? `${num(r.best.median)} <span style="color:${MUTED}">${esc(r.best.carrier)}</span>`
    : "—";

  return (
    "<tr>" +
    (showPol ? td(esc(r.pol)) : "") +
    td(esc(r.destination)) +
    td(String(r.carriers), true) +
    td(String(r.options), true) +
    // Zero carriers with direct is the interesting case, so it is stated rather than left blank.
    td(
      r.carriersWithDirect === 0
        ? `<span style="color:${FAINT}">none</span>`
        : String(r.carriersWithDirect),
      true,
    ) +
    td(best, true) +
    td(num(r.laneMedian), true) +
    td(edge, true) +
    "</tr>"
  );
}

const headerRow = (showPol: boolean) =>
  "<tr>" +
  (showPol ? th("Load port") : "") +
  th("Destination") +
  th("Carriers", true) +
  th("Options", true) +
  th("With direct", true) +
  th("Best (median)", true) +
  th("Lane median", true) +
  th("Edge", true) +
  "</tr>";

const table = (inner: string) =>
  `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;max-width:900px;font-family:${FONT};font-size:13px;color:${INK}">${inner}</table>`;

// ── The carrier table, for the lanes where the choice is worth making ────────────────────────
//
// SIX COLUMNS, NOT FOURTEEN. The app's table scrolls sideways; an email does not, and Word wraps
// what it cannot fit into an unreadable stack. These are the columns that decide who gets asked:
// how much direct service there is, how much there is in total, which routings are worth quoting,
// what they deliver, and how that compares to the lane.
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

/** A carrier's usable routings, stacked inside one cell. `<br>` is the only line break Word obeys. */
function servicesCell(c: CarrierRow, destination: string): string {
  const usable = c.services.filter((s) => s.usable);
  const notUsable = c.services.filter((s) => !s.usable);

  // A CARRIER ALWAYS NAMES WHAT IT RUNS, even when none of it clears the margin — the same fix the
  // on-screen cell needed. Printing "no routing within +10%" and stopping left a row with options,
  // a median and a sailing window beside an empty cell, which reads as broken data rather than as
  // a slow carrier. Shown dimmed and labelled instead; the ranking is unchanged.
  const shown = usable.length ? usable.slice(0, SERVICES_SHOWN) : notUsable.slice(0, 1);
  const more = usable.length ? usable.length - shown.length : 0;
  const outOfReach = usable.length === 0;

  const lines = shown.map((s) => {
    const body =
      `${esc(routingName(s.label, destination))} <span style="color:${MUTED}">×${s.options}</span> ` +
      `<strong>${num(s.median)}d</strong>`;
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

function carrierRow(c: CarrierRow, destination: string): string {
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

  return (
    "<tr>" +
    td(`<strong>${esc(c.carrier)}</strong>`) +
    // Same honesty as the app: only the newest scrape per carrier and lane is kept, so no direct
    // sailing in the snapshot is not the same claim as the carrier running none.
    td(
      c.directUnknown ? `<span style="color:${FAINT}">none</span>` : String(c.directOptions),
      true,
    ) +
    td(String(c.options), true) +
    td(servicesCell(c, destination)) +
    td(`${num(c.transit.median)}${range}`, true) +
    td(vs, true) +
    "</tr>"
  );
}

const carrierHeader =
  "<tr>" +
  th("Carrier") +
  th("Direct", true) +
  th("Options", true) +
  th("Usable services") +
  th("Median / range", true) +
  th("vs lane", true) +
  "</tr>";

const carrierTable = (t: LaneTable) =>
  table(carrierHeader + t.carriers.map((c) => carrierRow(c, t.destination)).join(""));

const h2 = (text: string) =>
  `<p style="margin:22px 0 6px;font-family:${FONT};font-size:13px;font-weight:600;color:${INK};text-transform:uppercase;letter-spacing:0.06em;">${esc(text)}</p>`;

/**
 * GMAIL CLIPS A MESSAGE NEAR 102 KB, and a clipped report is worse than a short one — the reader
 * gets a "[Message clipped]" link where the legend should be, and no idea what is missing.
 *
 * The carrier tables are the section that can grow without bound, so they are the section that
 * yields: everything else renders first, and they fill whatever room is left. A fixed cap on the
 * number of lanes would not survive the market growing — measured today, the report is 67.5 KB
 * before them and eight lanes take it to 108.9.
 *
 * The loop below never exceeds this number, so it is a hard ceiling rather than a target to drift
 * past; 98 leaves four clear kilobytes under the clip.
 */
const SIZE_BUDGET = 98 * 1024;

// UTF-8 bytes, not string length: the report is full of ×, →, · and en dashes, and the clip
// threshold is measured in bytes.
const bytes = (s: string) => new TextEncoder().encode(s).length;

/**
 * @param full  Bypass the size budget and render EVERY lane's carrier table.
 *
 * TWO OUTPUTS, ONE RENDERER. "Generate report" writes a file, where a reader scrolls and being
 * complete is the point. "Copy" puts the report in an Outlook message body, where Gmail clips near
 * 102 KB and an incomplete paste is a silent failure. Those are different constraints on the same
 * document, not different documents — so the budget is a parameter rather than a fork.
 */
export function renderEmailHtml(r: WeeklyReport, full = false): string {
  const parts: string[] = [];

  parts.push(
    `<div style="font-family:${FONT};color:${INK};max-width:900px;">`,
    `<p style="margin:0 0 2px;font-size:19px;font-weight:600;">${esc(r.subject)}</p>`,
    // The snapshot date is stated up front. A report that hides how old its data is gets trusted
    // once and distrusted permanently.
    `<p style="margin:0 0 16px;font-size:12px;color:${MUTED};">` +
      `${r.coverage.carriers} carriers · ${r.coverage.lanes} lanes · ${r.coverage.pols} load ports · ` +
      `${r.coverage.sailings} sailings` +
      (r.snapshotAt ? ` · schedules as scraped ${esc(r.snapshotAt.slice(0, 10))}` : "") +
      `</p>`,
  );

  if (r.attention.length) {
    parts.push(
      h2("Where carrier choice matters most"),
      `<p style="margin:0 0 8px;font-size:12px;color:${MUTED};">` +
        `Days saved by booking the fastest carrier instead of a typical one.</p>`,
      table(headerRow(true) + r.attention.map((x) => row(x, true)).join("")),
    );
  }

  // Everything BELOW the carrier tables is rendered first, so what is left of the budget is known
  // before deciding how many of them fit. The document order is restored at the end.
  const tail: string[] = [];

  for (const group of r.byPol) {
    tail.push(
      h2(group.pol),
      table(headerRow(false) + group.rows.map((x) => row(x, false)).join("")),
    );
  }

  // A LIST, NOT A TABLE. Every column on these rows says the same thing twice — the "best" carrier
  // IS the only carrier, and the edge is zero by construction — so a full board spent 14 KB, as
  // much as three carrier tables, restating "there is no decision here" seventeen times. The lanes
  // are still all accounted for; they just do not get a grid to themselves.
  if (r.singleCarrier.length) {
    tail.push(
      h2("Single-carrier lanes — no choice to make"),
      `<p style="margin:0 0 8px;font-size:12px;color:${MUTED};line-height:1.6;">` +
        `One carrier serves each of these, so there is no carrier decision — listed for coverage ` +
        `only.<br>` +
        r.singleCarrier
          .map(
            (b) =>
              `${esc(b.pol)} → ${esc(b.destination)}` +
              (b.best ? ` <span style="color:${FAINT}">${esc(b.best.carrier)} ${b.best.median}d</span>` : ""),
          )
          .join(" · ") +
        `</p>`,
    );
  }

  tail.push(
    `<div style="margin-top:22px;padding:10px 12px;background:${PANEL};font-size:12px;color:${MUTED};line-height:1.5;">`,
    `<strong style="color:${INK};">Reading this</strong><br>` +
      `<strong>Options</strong> counts what a forwarder can be asked to quote: one routing, on one ` +
      `day. Several onward vessels off the same feeder are one option, not four; a direct and a ` +
      `transship leaving the same day are two.<br>` +
      `<strong>Best (median)</strong> is the fastest carrier by median transit, not by its quickest ` +
      `single sailing.<br>` +
      `<strong>Usable services</strong> lists every routing a carrier runs whose median lands within ` +
      `10% of the lane median. A carrier is rarely one service, and a second acceptable routing is ` +
      `not a faster transit — it is <em>another chance at space</em> at a transit that still works. ` +
      `The lines are ordered by how often each routing runs, not how fast it is, so the top line is ` +
      `what the carrier actually offers most and a lower line is sometimes the quicker one. ` +
      `“+N slower” is what did not clear the margin.<br>` +
      `<strong>Edge</strong> is the lane median minus that best carrier: what picking the right ` +
      `carrier is worth, in days. A dash means every carrier performs alike and the choice is ` +
      `not worth arguing over.`,
    `<br><br>This is one snapshot of published schedules, not a booking guarantee. Carriers ` +
      `republish routings between scrapes, so treat a lane with no direct service as "none this ` +
      `week" rather than "none".`,
    `</div>`,
    `</div>`,
  );

  // THE SHORTLIST, LANE BY LANE — the section the report exists for. The board above says which
  // lanes are worth a conversation; this says who to have it with, and it is the app's first table
  // rather than a summary of it.
  //
  // Greedy, in attention order, so the lanes that survive a squeeze are the ones where the carrier
  // choice is worth the most days.
  const laneParts: string[] = [];
  let shown = 0;
  // The section's own heading and intro are charged up front (rounded up generously), or the last
  // table admitted could be the one that pushes the message over.
  const SECTION_CHROME = 400;
  let spent = bytes(parts.join("")) + bytes(tail.join("")) + SECTION_CHROME;
  for (const t of r.laneTables) {
    const block =
      `<p style="margin:18px 0 6px;font-size:13px;font-weight:600;color:${INK};">` +
      `${esc(t.pol)} → ${esc(t.destination)}` +
      (t.laneMedian != null
        ? ` <span style="font-weight:400;color:${MUTED};">lane median ${t.laneMedian}d</span>`
        : "") +
      `</p>` +
      carrierTable(t);
    const cost = bytes(block);
    if (!full && spent + cost > SIZE_BUDGET) break;
    laneParts.push(block);
    spent += cost;
    shown += 1;
  }

  if (laneParts.length) {
    const dropped = r.laneTables.length - shown;
    parts.push(
      h2("Who to ask, lane by lane"),
      `<p style="margin:0 0 8px;font-size:12px;color:${MUTED};">` +
        `The carrier ranking for each lane above — most direct sailings first, then the shallowest ` +
        `transshipments.` +
        // Said out loud. A section that silently stops short is the same failure as a clipped
        // message, just quieter.
        (dropped > 0
          ? ` Showing the top ${shown} of ${r.laneTables.length}; the rest are in the app.`
          : "") +
        `</p>`,
      ...laneParts,
    );
  }

  parts.push(...tail);
  return parts.join("");
}

/** Plain-text fallback, so a client that refuses HTML still shows something legible. */
export function renderEmailText(r: WeeklyReport): string {
  const lines: string[] = [r.subject, ""];
  lines.push(
    `${r.coverage.carriers} carriers, ${r.coverage.lanes} lanes, ${r.coverage.sailings} sailings` +
      (r.snapshotAt ? `, scraped ${r.snapshotAt.slice(0, 10)}` : ""),
    "",
  );
  if (r.attention.length) {
    lines.push("WHERE CARRIER CHOICE MATTERS MOST");
    for (const a of r.attention) {
      lines.push(
        `  ${a.pol} -> ${a.destination}: best ${num(a.best?.median)} (${a.best?.carrier ?? "—"}) ` +
          `vs lane ${num(a.laneMedian)} = ${a.edge}d`,
      );
    }
    lines.push("");
  }
  for (const t of r.laneTables) {
    lines.push(
      `${t.pol.toUpperCase()} -> ${t.destination.toUpperCase()}` +
        (t.laneMedian != null ? `  (lane median ${t.laneMedian}d)` : ""),
    );
    for (const c of t.carriers) {
      const usable = c.services.filter((s) => s.usable);
      const svc = usable.length
        ? usable
            .slice(0, SERVICES_SHOWN)
            .map((s) => `${s.label} x${s.options} ${num(s.median)}d`)
            .join(" | ")
        : "no routing within +10%";
      lines.push(
        `  ${c.carrier}: ${c.directUnknown ? "no direct" : `${c.directOptions} direct`}, ` +
          `${c.options} options, median ${num(c.transit.median)} — ${svc}`,
      );
    }
    lines.push("");
  }
  for (const g of r.byPol) {
    lines.push(g.pol.toUpperCase());
    for (const b of g.rows) {
      lines.push(
        `  ${b.destination}: ${b.carriers} carriers, ${b.options} options, ` +
          `best ${num(b.best?.median)} (${b.best?.carrier ?? "—"}), lane ${num(b.laneMedian)}` +
          (b.edge && b.edge > 0 ? `, edge ${b.edge}d` : ""),
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
