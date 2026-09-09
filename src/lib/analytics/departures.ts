import type { Schedule } from "../../types/schedule";
import { routeLabel } from "./ports";

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

/**
 * THE UNIT OF ANALYSIS: ONE OPTION — one chain, on one day, from one carrier.
 *
 * This is what a forwarder actually quotes. "Direct to Norfolk on the 10th" and "via Taipei on the
 * 10th" are two things you can ask for: one may come back and the other not, and if both do you
 * take the direct. Neither existing count says that, and both distort it in opposite directions.
 *
 * CONNECTIONS OVER-COUNT, by up to 22x. ONE publishes `Singapore > Los Angeles/Long Beach` on
 * 2026-09-10 as twenty-two connections — twenty-two onward vessels on one chain on one day. One
 * quotable thing, counted twenty-two times. Measured: 583 of 1,773 options are inflated this way.
 *
 * DATES UNDER-COUNT, on a fifth of the data. 334 of 1,707 (carrier, lane, date) cells carry more
 * than one chain. ONE out of Pipavav to Chicago on 2026-09-10 reads as ONE date and is EIGHT
 * options — direct to LA, direct to Oakland, and six Singapore transships to LA, New York, Oakland,
 * Tacoma, Norfolk and Halifax. Those are six different answers to "can you do it", collapsed to one.
 *
 * Market-wide: 2,909 connections, 1,773 options.
 *
 * BOTH COUNTS STILL EXIST ON A ROW, because they answer different questions — options are what you
 * can ask for, dates are when you can actually leave. A carrier with twenty options across three
 * days is not the same proposition as twenty across twenty.
 */
export interface Option {
  carrier: string;
  /** ETD day, `YYYY-MM-DD`. Options are per DAY: a time of day is not a separate opportunity. */
  date: string;
  /** `routeLabel` — the transshipment path then the discharge port, port complexes folded. */
  chain: string;
  pod: string;
  ts: number;
  /**
   * Median of this option's published arrivals, or null when none carry a transit.
   *
   * THE MEDIAN, NOT THE BEST. An option published against several onward vessels has several
   * arrival dates — 32, 33, 37 and 38 days on one real ONE sailing — and taking the fastest would
   * headline something that happened once. This is the same reasoning `mainRoute` already applies
   * to routings, applied to the number itself.
   *
   * It also removes a weighting fault: aggregating transit over connections let a chain published
   * twenty-two times pull a carrier's median twenty-two times, which is exactly what makes
   * connections a bad count in the first place.
   */
  transit: number | null;
  /** How many connections were published for it. A tooltip, never a headline. */
  connections: number;
}

/**
 * Connections folded into options.
 *
 * One level coarser than `dedupeConnections`: same rows, grouped without `eta` and
 * `vessel_sequence`, with `etd` truncated to a day.
 */
export function toOptions(rows: Schedule[]): Option[] {
  const groups = new Map<string, Schedule[]>();
  for (const c of dedupeConnections(rows)) {
    const date = (c.etd ?? "").slice(0, 10);
    if (!date) continue; // an unscheduled sailing is not something anyone can be quoted
    // U+0000 cannot occur in a carrier code, a date or a port name, so parts cannot collide.
    const key = [c.carrier_code, date, routeLabel(c)].join("\u0000");
    const bucket = groups.get(key);
    if (bucket) bucket.push(c);
    else groups.set(key, [c]);
  }

  const out: Option[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    out.push({
      carrier: first.carrier_code,
      date: (first.etd ?? "").slice(0, 10),
      chain: routeLabel(first),
      pod: first.port_of_discharge,
      // SHALLOWEST, NOT THE FIRST ROW'S. Folding a port complex can put a direct and a feeder to
      // the other berth under one label, and what the routing is worth is the shallower of them.
      // Same rule `mainRoute` applies for the same reason.
      ts: Math.min(...group.map(tsCount)),
      transit: spreadOf(group.map((g) => g.transit_time_days)).median,
      connections: group.length,
    });
  }
  return out;
}
