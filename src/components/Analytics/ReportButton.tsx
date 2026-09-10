import { useState } from "react";
import { fetchMarketSnapshot } from "../../state/useMarketSnapshot";
import { buildWeeklyReport } from "../../lib/report/weeklyReport";
import { renderEmailHtml, renderEmailText } from "../../lib/report/renderEmailHtml";

/**
 * The point-to-point report, out of the app and into a file or an inbox.
 *
 * IT ANSWERS A DIFFERENT QUESTION FROM THE SCREEN ABOVE IT, deliberately. Analytics now answers for
 * a destination — every way of reaching a warehouse, whichever port the box lands at, with the
 * ground leg priced in. This answers for a PORT PAIR: POL to Last CY, every carrier ending in the
 * same place, no drayage in the comparison because there is none to tell apart. That is the stricter
 * comparison and the one to put in front of a carrier, which is why both exist.
 *
 * SO IT FETCHES ITS OWN DATA, and only when pressed. The screen has one destination's worth of
 * schedules; a point-to-point report wants every lane. Paging the whole market cost every visit to
 * the tab until this moved behind the button.
 *
 * GENERATE IS A DOWNLOAD, COPY IS A PASTE. The file is complete — every lane, every carrier row.
 * The clipboard flavour keeps the size budget, because Gmail clips a message near 102 KB and a
 * truncated paste is a silent failure in someone else's inbox.
 */

type State = "idle" | "working" | "copied" | "downloaded" | "failed";

export function ReportButton() {
  const [state, setState] = useState<State>("idle");
  const [detail, setDetail] = useState<string | null>(null);

  const flash = (s: State, d: string | null = null) => {
    setState(s);
    setDetail(d);
    setTimeout(() => {
      setState("idle");
      setDetail(null);
    }, 3200);
  };

  const build = async (full: boolean) => {
    const { rows, snapshotAt } = await fetchMarketSnapshot();
    if (!rows.length) throw new Error("no sailings in the current window");
    const report = buildWeeklyReport(rows, { snapshotAt });
    return { report, html: renderEmailHtml(report, full), text: renderEmailText(report) };
  };

  const download = (html: string, subject: string) => {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    // The subject doubles as the filename, so an archived report is identifiable on disk.
    a.download = `${subject.replace(/[^\w.\- ]+/g, "")}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onGenerate = async () => {
    setState("working");
    try {
      const { report, html } = await build(true);
      download(html, report.subject);
      flash("downloaded", `${report.laneTables.length} lanes`);
    } catch (e) {
      flash("failed", (e as Error).message);
    }
  };

  const onCopy = async () => {
    setState("working");
    try {
      const { report, html, text } = await build(false);
      try {
        if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
          throw new Error("rich clipboard unavailable");
        }
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
        flash("copied");
      } catch {
        // Not a dead end — give them the file instead, and say which happened.
        download(html, report.subject);
        flash("downloaded");
      }
    } catch (e) {
      flash("failed", (e as Error).message);
    }
  };

  const label =
    state === "working"
      ? "building…"
      : state === "downloaded"
        ? `downloaded${detail ? ` — ${detail}` : ""}`
        : state === "failed"
          ? `could not build — ${detail ?? "unknown error"}`
          : "Generate report";

  const busy = state === "working";

  return (
    <span className="an-report">
      <button
        type="button"
        className="an-copy"
        onClick={onGenerate}
        disabled={busy}
        title="Downloads the whole-market point-to-point report as .html — every lane, every carrier, best to worst. Reads the market fresh, so it is independent of the search above."
      >
        {label}
      </button>
      <button
        type="button"
        className="an-copy an-copy--quiet"
        onClick={onCopy}
        disabled={busy}
        title="Copies a trimmed version as formatted HTML for pasting into an Outlook message body. Trimmed because Gmail clips a message near 102 KB."
      >
        {state === "copied" ? "copied — paste into Outlook" : "copy for email"}
      </button>
    </span>
  );
}
