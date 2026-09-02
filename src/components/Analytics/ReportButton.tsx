import { useState } from "react";
import type { Schedule } from "../../types/schedule";
import { buildWeeklyReport } from "../../lib/report/weeklyReport";
import { renderEmailHtml, renderEmailText } from "../../lib/report/renderEmailHtml";

/**
 * Get the weekly report out of the app and into Outlook.
 *
 * COPY IS THE PRIMARY ACTION, NOT DOWNLOAD. The report exists to drive adoption, and an attachment
 * makes every reader download and open a file before they see anything — the exact friction this
 * is meant to remove. Copied as `text/html`, it pastes into a new Outlook message as the BODY, so
 * colleagues skim it in the preview pane having clicked nothing.
 *
 * A plain-text flavour goes on the clipboard alongside the HTML, so a client that refuses rich
 * paste still receives something legible rather than markup.
 *
 * Download stays as the fallback: `ClipboardItem` with `text/html` is unavailable in some browsers
 * and in any non-secure context, and a button that silently does nothing is worse than one that
 * does something slightly different.
 */

interface Props {
  rows: Schedule[];
  snapshotAt: string | null;
}

type State = "idle" | "copied" | "downloaded" | "failed";

export function ReportButton({ rows, snapshotAt }: Props) {
  const [state, setState] = useState<State>("idle");

  const flash = (s: State) => {
    setState(s);
    setTimeout(() => setState("idle"), 2400);
  };

  const build = () => {
    const report = buildWeeklyReport(rows, { snapshotAt });
    return { report, html: renderEmailHtml(report), text: renderEmailText(report) };
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

  const onCopy = async () => {
    const { report, html, text } = build();
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
  };

  const onDownload = () => {
    const { report, html } = build();
    download(html, report.subject);
    flash("downloaded");
  };

  const label =
    state === "copied"
      ? "copied — paste into Outlook"
      : state === "downloaded"
        ? "downloaded"
        : state === "failed"
          ? "could not copy"
          : "Copy weekly report";

  return (
    <span className="an-report">
      <button
        type="button"
        className="an-copy"
        onClick={onCopy}
        disabled={!rows.length}
        title="Copies the whole-market report as formatted HTML. Paste into a new Outlook message — it lands in the body, not as an attachment."
      >
        {label}
      </button>
      <button
        type="button"
        className="an-copy an-copy--quiet"
        onClick={onDownload}
        disabled={!rows.length}
        title="Save the report as an .html file, for archiving or attaching"
      >
        .html
      </button>
    </span>
  );
}
