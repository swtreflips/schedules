import type { Schedule } from "../types/schedule";

/**
 * Group schedules by carrier_code. Within each group, schedules are sorted
 * by ETA ascending (earliest first), so groups.get(code)[0] is always the
 * default "best" pick for that carrier.
 */
export function groupByCarrier(
  schedules: Schedule[]
): Map<string, Schedule[]> {
  const map = new Map<string, Schedule[]>();
  for (const s of schedules) {
    const existing = map.get(s.carrier_code);
    if (existing) existing.push(s);
    else map.set(s.carrier_code, [s]);
  }
  for (const [, arr] of map) {
    arr.sort((a, b) => a.eta.localeCompare(b.eta));
  }
  return map;
}

/**
 * Discriminated union for what the grid actually renders in Plan mode.
 *  - 'main' is the visible per-carrier row.
 *  - 'alts' is a full-width row injected immediately after when expanded.
 */
export type PlanRow =
  | {
      kind: "main";
      carrier: string;
      schedule: Schedule;
      altCount: number;
      isExpanded: boolean;
    }
  | {
      kind: "alts";
      carrier: string;
      alternatives: Schedule[];
      selectedId: string;
    };

/**
 * Given grouped schedules, a manual-selection override map, and the set of
 * currently expanded carriers, build the flat array of rows to render.
 */
export function buildPlanRows(
  groups: Map<string, Schedule[]>,
  selections: Map<string, string>,
  expansions: Set<string>
): PlanRow[] {
  const out: PlanRow[] = [];
  for (const [carrier, schedules] of groups) {
    const pickId = selections.get(carrier);
    const selected =
      (pickId && schedules.find((s) => s.id === pickId)) || schedules[0];
    const isExpanded = expansions.has(carrier);

    out.push({
      kind: "main",
      carrier,
      schedule: selected,
      altCount: schedules.length,
      isExpanded,
    });

    if (isExpanded && schedules.length > 1) {
      out.push({
        kind: "alts",
        carrier,
        alternatives: schedules,
        selectedId: selected.id,
      });
    }
  }
  return out;
}
