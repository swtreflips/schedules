import type { Schedule } from "../../types/schedule";
import { carrierStats, lanesIn } from "../analytics/lane";

/**
 * The weekly report model — everything the email says, with no HTML in sight.
 *
 * BUILT FROM `carrierStats`, NOT FROM ITS OWN QUERY. The report and the screen have to agree; a
 * Monday email that quietly contradicts the tool it is advertising is worse than no email. Deriving
 * both from the same function makes that agreement structural rather than a thing to remember —
 * change the ranking rules and the report moves with them.
 *
 * Pure: `Schedule[]` in, plain objects out. The renderer takes it from here.
 */

export interface BoardRow {
  pol: string;
  destination: string;
  carriers: number;
  sailDates: number;
  /** How many carriers offer at least one direct sailing. Zero is a meaningful answer. */
  carriersWithDirect: number;
  best: { carrier: string; median: number } | null;
  laneMedian: number | null;
  /**
   * Lane median minus the best carrier's median: what picking the right carrier is worth, in days.
   *
   * This is the number the email exists to deliver. Measured, Mundra -> New York runs 26.0 against
   * a 45.5-day lane — nineteen and a half days between the best option and a typical one — while
   * Hai Phong -> Phoenix has a single carrier and no decision to make at all. One of those lanes
   * deserves an RFQ conversation and the other does not, and nothing else on the row says which.
   */
  edge: number | null;
}

export interface WeeklyReport {
  subject: string;
  generatedOn: string;
  snapshotAt: string | null;
  coverage: { carriers: number; lanes: number; sailings: number; pols: number };
  /** Lanes where carrier choice is worth the most days. The section that earns the open. */
  attention: BoardRow[];
  /** Every lane with a real choice, grouped by port of loading. */
  byPol: Array<{ pol: string; rows: BoardRow[] }>;
  /** One carrier, no decision — kept for completeness, out of the way of the board. */
  singleCarrier: BoardRow[];
}

/** dd.mm.yyyy — the format already in use for these subject lines. */
export function reportDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

const ATTENTION_MAX = 8;

export function buildWeeklyReport(
  rows: Schedule[],
  opts: { snapshotAt?: string | null; today?: Date } = {},
): WeeklyReport {
  const today = opts.today ?? new Date();
  const lanes = lanesIn(rows);

  const board: BoardRow[] = [];
  for (const lane of lanes) {
    const cs = carrierStats(rows, lane);
    if (!cs.length) continue;

    const medians = cs
      .map((c) => c.transit.median)
      .filter((m): m is number => m != null)
      .sort((a, b) => a - b);

    const laneMedian = medians.length
      ? medians.length % 2 === 0
        ? (medians[medians.length / 2 - 1] + medians[medians.length / 2]) / 2
        : medians[(medians.length - 1) / 2]
      : null;

    // Fastest by median, not by best case — a single lucky sailing is not an option to quote on.
    const fastest = cs
      .filter((c) => c.transit.median != null)
      .sort((a, b) => (a.transit.median ?? 0) - (b.transit.median ?? 0))[0];

    const best = fastest ? { carrier: fastest.carrier, median: fastest.transit.median as number } : null;

    board.push({
      pol: lane.pol,
      destination: lane.lastCy,
      carriers: cs.length,
      sailDates: cs.reduce((n, c) => n + c.sailDates, 0),
      carriersWithDirect: cs.filter((c) => c.directDates > 0).length,
      best,
      laneMedian,
      edge:
        best && laneMedian != null ? Math.round((laneMedian - best.median) * 10) / 10 : null,
    });
  }

  // A lane with one carrier has no edge to speak of — the "best" and the "median" are the same
  // row. Keeping those out of the board and the attention list is not tidying: an edge of 0 there
  // means "no choice exists", while an edge of 0 on a ten-carrier lane means "every carrier is
  // equivalent", and letting the two share a column would make both unreadable.
  const singleCarrier = board.filter((b) => b.carriers < 2);
  const withChoice = board.filter((b) => b.carriers >= 2);

  const byPolMap = new Map<string, BoardRow[]>();
  for (const b of withChoice) {
    const bucket = byPolMap.get(b.pol);
    if (bucket) bucket.push(b);
    else byPolMap.set(b.pol, [b]);
  }

  const byPol = [...byPolMap.entries()]
    .map(([pol, rs]) => ({
      pol,
      rows: rs.sort((a, b) => b.sailDates - a.sailDates || a.destination.localeCompare(b.destination)),
    }))
    .sort((a, b) => a.pol.localeCompare(b.pol));

  const attention = [...withChoice]
    .filter((b) => b.edge != null && b.edge > 0)
    .sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0))
    .slice(0, ATTENTION_MAX);

  return {
    subject: `Weekly Ocean Schedule Report — ${reportDate(today)}`,
    generatedOn: reportDate(today),
    snapshotAt: opts.snapshotAt ?? null,
    coverage: {
      carriers: new Set(rows.map((r) => r.carrier_code)).size,
      lanes: board.length,
      sailings: lanes.reduce((n, l) => n + l.departures, 0),
      pols: new Set(board.map((b) => b.pol)).size,
    },
    attention,
    byPol,
    singleCarrier: singleCarrier.sort(
      (a, b) => a.pol.localeCompare(b.pol) || a.destination.localeCompare(b.destination),
    ),
  };
}
