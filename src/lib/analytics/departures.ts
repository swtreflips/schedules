import type { Schedule } from "../../types/schedule";

/**
 * The unit of analysis is a CONNECTION: one bookable way to move the box from POL to Last CY.
 *
 * ANALYTICS.md prescribes deduplicating on `(carrier_code, mother_vessel, etd, port_of_discharge)`
 * and warns that rows over-count "departures" by 35-57%. **That rule is wrong for this data, and
 * measurement is what settles it.** On Semarang -> Los Angeles:
 *
 *     200  raw rows
 *     120  under that key          <- discards 40% of real options
 *     198  distinct connections
 *
 * and across the whole current-market view, 2,865 rows hold 2,832 distinct connections. Genuine
 * duplication is ~1%, not 57%.
 *
 * What that key actually collapses is not duplicates. `mother_vessel` on this lane is frequently
 * the FEEDER — the ship from Semarang to the hub — while the ocean vessel sits in `ts_vessels`.
 * So one feeder sailing legitimately appears several times with different onward vessels:
 *
 *     ONE  HIGHWAY  2026-09-09 -> Los Angeles via Singapore
 *          onward MOL COURAGE / YM MOVEMENT / ...  ETAs Oct 8, 9, 13, 14  transit 32, 33, 37, 38
 *
 * Four arrivals, four transits, four things a customer can be sold. Folding them into one and
 * keeping whichever row happened to come first is not deduplication — it discards the options this
 * view exists to compare, and makes the result depend on row order.
 *
 * The spec's underlying concern is real but small: a connection serving several Last CYs appears
 * once per Last CY. Measured, that is 45 rows of 2,865. It matters when counting distinct sailings
 * ACROSS lanes; it does not licence collapsing WITHIN one.
 *
 * Identity is therefore `(carrier_code, etd, eta, port_of_discharge, vessel_sequence, ts_ports)`
 * - what a customer would recognise as one option.
 *
 * `ts_ports` belongs in the key even though `vessel_sequence` is already there, because the two
 * can disagree: EMC publishes EVER BIRTH departing 2026-09-12 for Los Angeles both via Kaohsiung
 * and via Taipei, on the same vessels. Leave the routing out and those two collapse into one, and
 * WHICH survives depends on row order - the Taipei corridor lost a connection to Kaohsiung
 * exactly that way before this was added.
 *
 * `last_cy` is excluded so a market-wide view spanning several inland ramps does not count one
 * connection several times.
 */
export function dedupeConnections(rows: Schedule[]): Schedule[] {
  const seen = new Set<string>();
  const out: Schedule[] = [];
  for (const r of rows) {
    // U+0000 cannot occur in a port or vessel name, so joined parts cannot collide.
    const key = [
      r.carrier_code,
      r.etd ?? "",
      r.eta ?? "",
      r.port_of_discharge,
      (r.vessel_sequence ?? []).join(">"),
      (r.ts_ports ?? []).join(">"),
    ].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Min / median / max over a nullable numeric field, with the denominator carried alongside.
 *
 * `transit_time_days` is nullable in the schema and really is null in production — a carrier
 * publishes a departure before committing to an arrival. A naive sum yields NaN; a naive filter
 * yields a confident number over an unstated subset. Both are worse than saying so, so the count
 * travels with the statistic and the UI can render "median of 27 of 32".
 *
 * Median rather than mean, and never without the range. Measured on Semarang -> Los Angeles, the
 * Taipei corridor's median is 24 days against 35 for the busiest corridor, while its best case is
 * 15 — a spread no average would show.
 */
export interface Spread {
  min: number | null;
  median: number | null;
  max: number | null;
  spread: number | null;
  /** How many values the statistic is actually over. */
  n: number;
  /** How many were considered; `of - n` is how much was unpublished. */
  of: number;
}

export function spreadOf(values: Array<number | null | undefined>): Spread {
  const nums = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  const of = values.length;
  if (nums.length === 0)
    return { min: null, median: null, max: null, spread: null, n: 0, of };

  const sorted = [...nums].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median,
    spread: sorted[sorted.length - 1] - sorted[0],
    n: sorted.length,
    of,
  };
}

/** Mean gap in days between consecutive distinct ETDs — service cadence. Null under two sailings. */
export function averageGapDays(etds: Array<string | null>): number | null {
  const days = [
    ...new Set(etds.filter((e): e is string => !!e).map((e) => e.slice(0, 10))),
  ]
    .sort()
    .map((d) => Date.parse(d + "T00:00:00Z"))
    .filter((t) => Number.isFinite(t));
  if (days.length < 2) return null;
  const span = (days[days.length - 1] - days[0]) / 86_400_000;
  return Math.round((span / (days.length - 1)) * 10) / 10;
}

/** Transshipment count. `ts_ports` is the source of truth — never branch on `transport_type`. */
export const tsCount = (s: Schedule): number => (s.ts_ports ?? []).length;
