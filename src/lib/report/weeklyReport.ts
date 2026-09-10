import type { Schedule } from "../../types/schedule";
import { carrierStats, lanesIn, type CarrierRow } from "../analytics/lane";

/**
 * The report model — everything the document says, with no HTML in sight.
 *
 * IT IS THE APP'S FIRST TABLE, ONE PORT PAIR AT A TIME. Nothing else. The reader skims the tables
 * and reaches their own conclusions; the report does not reach any for them.
 *
 * THAT IS A DELIBERATE RETREAT FROM WHAT THIS USED TO BE. It carried a "where carrier choice matters
 * most" board ranking lanes by what picking the right carrier was worth, a per-load-port summary
 * board, and a single-carrier appendix. Every one of them was the report drawing a conclusion and
 * asking to be trusted on it — and a summary that disagrees with the table two inches below it is
 * worse than no summary. The tables already carry the argument in their ordering, which is the same
 * reason `lane.ts` refuses to print a score or a tier label.
 *
 * WHAT MAKES IT DIFFERENT FROM THE SCREEN is the frame, not the depth: POL -> Last CY, strictly, so
 * every carrier in a table ends in the same place and no drayage needs telling apart. The screen
 * asks how a DESTINATION is served and folds several Last CYs into one answer; this asks who is good
 * on one port pair. Both are useful and neither substitutes for the other.
 *
 * BUILT FROM `carrierStats`, NOT FROM ITS OWN QUERY, so the report and the screen cannot disagree
 * about a ranking. Pure: `Schedule[]` in, plain objects out.
 */

export interface LaneTable {
  pol: string;
  destination: string;
  /** Median of the carrier medians on this lane — what `vs lane` on each row is measured against. */
  laneMedian: number | null;
  /** Quotable options across every carrier here. */
  options: number;
  /** Ranked exactly as the screen ranks them. */
  carriers: CarrierRow[];
}

export interface WeeklyReport {
  subject: string;
  generatedOn: string;
  snapshotAt: string | null;
  coverage: { carriers: number; lanes: number; sailings: number; pols: number };
  /**
   * Every port pair in the snapshot, grouped by load port.
   *
   * INCLUDING THE ONES WITH A SINGLE CARRIER. They used to be filtered into an appendix on the
   * grounds that there is no decision to make on them — but the reader is the one who decides that,
   * and a lane silently missing from a report reads as no service rather than as one carrier.
   */
  lanes: LaneTable[];
  /** Per carrier, when it was last scraped — the Scraped column. */
  scrapedByCarrier: Map<string, string>;
}

/** dd.mm.yyyy — the format already in use for these subject lines. */
export function reportDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function buildWeeklyReport(
  rows: Schedule[],
  opts: { snapshotAt?: string | null; today?: Date } = {},
): WeeklyReport {
  const today = opts.today ?? new Date();

  const lanes: LaneTable[] = [];
  for (const lane of lanesIn(rows)) {
    // NO DRAYAGE ARGUMENT. That is the whole distinction between this and the screen: inside one
    // port pair every carrier ends in the same place, so there is no ground leg to tell apart and
    // ocean transit is a fair comparison on its own.
    const carriers = carrierStats(rows, lane);
    if (!carriers.length) continue;

    const medians = carriers
      .map((c) => c.transit.median)
      .filter((m): m is number => m != null)
      .sort((a, b) => a - b);

    lanes.push({
      pol: lane.pol,
      destination: lane.lastCy,
      laneMedian: medians.length
        ? medians.length % 2 === 0
          ? (medians[medians.length / 2 - 1] + medians[medians.length / 2]) / 2
          : medians[(medians.length - 1) / 2]
        : null,
      options: carriers.reduce((n, c) => n + c.options, 0),
      carriers,
    });
  }

  // Grouped by load port, busiest lane first inside each. A reader looking for one origin finds its
  // lanes together, and the lane they are most likely to care about is the first one there.
  lanes.sort((a, b) => a.pol.localeCompare(b.pol) || b.options - a.options || a.destination.localeCompare(b.destination));

  // Derived here rather than plumbed in: `schedules_latest_secure` carries `query_date` and the
  // snapshot query already selects it, so the freshness of a carrier travels with its rows.
  const scrapedByCarrier = new Map<string, string>();
  for (const r of rows) {
    const q = r.query_date;
    if (!q) continue;
    const prev = scrapedByCarrier.get(r.carrier_code);
    if (!prev || q > prev) scrapedByCarrier.set(r.carrier_code, q);
  }

  return {
    subject: `Ocean Schedule Report — ${reportDate(today)}`,
    generatedOn: reportDate(today),
    snapshotAt: opts.snapshotAt ?? null,
    coverage: {
      carriers: new Set(rows.map((r) => r.carrier_code)).size,
      lanes: lanes.length,
      sailings: lanes.reduce((n, l) => n + l.options, 0),
      pols: new Set(lanes.map((l) => l.pol)).size,
    },
    lanes,
    scrapedByCarrier,
  };
}
