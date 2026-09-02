import type { BoardRow, WeeklyReport } from "./weeklyReport";

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
    td(String(r.sailDates), true) +
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
  th("Sail dates", true) +
  th("With direct", true) +
  th("Best (median)", true) +
  th("Lane median", true) +
  th("Edge", true) +
  "</tr>";

const table = (inner: string) =>
  `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;max-width:900px;font-family:${FONT};font-size:13px;color:${INK}">${inner}</table>`;

const h2 = (text: string) =>
  `<p style="margin:22px 0 6px;font-family:${FONT};font-size:13px;font-weight:600;color:${INK};text-transform:uppercase;letter-spacing:0.06em;">${esc(text)}</p>`;

export function renderEmailHtml(r: WeeklyReport): string {
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

  for (const group of r.byPol) {
    parts.push(
      h2(group.pol),
      table(headerRow(false) + group.rows.map((x) => row(x, false)).join("")),
    );
  }

  if (r.singleCarrier.length) {
    parts.push(
      h2("Single-carrier lanes — no choice to make"),
      `<p style="margin:0 0 8px;font-size:12px;color:${MUTED};">` +
        `One carrier serves each of these, so there is no carrier decision — listed for coverage only.</p>`,
      table(
        headerRow(true) + r.singleCarrier.map((x) => row(x, true)).join(""),
      ),
    );
  }

  parts.push(
    `<div style="margin-top:22px;padding:10px 12px;background:${PANEL};font-size:12px;color:${MUTED};line-height:1.5;">`,
    `<strong style="color:${INK};">Reading this</strong><br>` +
      `<strong>Sail dates</strong> counts distinct departures, not schedule rows — several onward ` +
      `vessels off one feeder are one chance to ship.<br>` +
      `<strong>Best (median)</strong> is the fastest carrier by median transit, not by its quickest ` +
      `single sailing.<br>` +
      `<strong>Edge</strong> is the lane median minus that best carrier: what picking the right ` +
      `carrier is worth, in days. A dash means every carrier performs alike and the choice is ` +
      `not worth arguing over.`,
    `<br><br>This is one snapshot of published schedules, not a booking guarantee. Carriers ` +
      `republish routings between scrapes, so treat a lane with no direct service as "none this ` +
      `week" rather than "none".`,
    `</div>`,
    `</div>`,
  );

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
  for (const g of r.byPol) {
    lines.push(g.pol.toUpperCase());
    for (const b of g.rows) {
      lines.push(
        `  ${b.destination}: ${b.carriers} carriers, ${b.sailDates} dates, ` +
          `best ${num(b.best?.median)} (${b.best?.carrier ?? "—"}), lane ${num(b.laneMedian)}` +
          (b.edge && b.edge > 0 ? `, edge ${b.edge}d` : ""),
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
