import type { Schedule } from "../../types/schedule";
import { compareDateAsc } from "../compare";
import {
  averageGapDays,
  dedupeConnections,
  spreadOf,
  tsCount,
  type Spread,
} from "./departures";

/**
 * Lane analytics: the two views that sit above the grid.
 *
 * The grid is a chooser — which sailing do I book. These answer the layer above: what does this
 * lane look like, and which carrier is actually good at it. Both are projections of ONE deduped
 * array, so they cannot disagree about how much service exists.
 *
 * Every function here is pure — `Schedule[]` in, plain objects out, no React — so the numbers can
 * be checked against SQL rather than by reading a rendered table.
 */

/**
 * THE LANE IS POL -> LAST CY. Not POL -> POD.
 *
 * Last CY is where the customer's box actually ends up; the discharge port is a routing choice
 * made to get it there. Comparing on POD would split one commercial lane into several and make
 * carriers serving it different ways look like they serve different markets.
 */
export interface Lane {
  pol: string;
  lastCy: string;
}

// ── View A: corridors ────────────────────────────────────────────────────────────────

export interface CorridorRow {
  /** Identity within the lane: ordered transshipment path, then the discharge port. */
  key: string;
  via: string[];
  pod: string;
  ts: number;
  /** True when the box moves inland from POD by rail: `port_of_discharge !== last_cy`. */
  hasRailLeg: boolean;
  departures: number;
  carriers: string[];
  transit: Spread;
  nextEtd: string | null;
}

/**
 * Segment a lane into its distinct routing shapes.
 *
 * ORDER MATTERS in the transshipment path: Port Klang -> Shekou is not Shekou -> Port Klang.
 *
 * POD IS PART OF THE CORRIDOR, even though it is not part of the lane — and for an inland Last CY
 * it is the single biggest thing separating one routing from another. Measured on
 * `Salt Lake City, UT`, which is reached through four different discharge ports:
 *
 *     Long Beach, CA    11 connections   median 31.0 days
 *     Los Angeles, CA   36 connections   median 33.5
 *     Oakland, CA       77 connections   median 40.0
 *     Houston, TX       12 connections   median 77.5
 *
 * The same box, the same final destination, and 46 days between the best and worst way of getting
 * there — a Gulf discharge with a long rail leg against a West Coast one. Dropping POD from the
 * key averages those four into a single meaningless number; keeping it is what lets someone ask
 * whether routing through Oakland or through New York is the better way into Utah.
 */
export function corridorStats(rows: Schedule[], lane?: Lane): CorridorRow[] {
  const conns = dedupeConnections(inLane(rows, lane));
  const groups = new Map<string, Schedule[]>();

  for (const c of conns) {
    const key = [...(c.ts_ports ?? []), c.port_of_discharge].join(" > ");
    const bucket = groups.get(key);
    if (bucket) bucket.push(c);
    else groups.set(key, [c]);
  }

  const out: CorridorRow[] = [];
  for (const [key, group] of groups) {
    const first = group[0];
    out.push({
      key,
      via: first.ts_ports ?? [],
      pod: first.port_of_discharge,
      ts: tsCount(first),
      hasRailLeg: first.port_of_discharge !== first.last_cy,
      departures: group.length,
      carriers: [...new Set(group.map((g) => g.carrier_code))].sort(),
      transit: spreadOf(group.map((g) => g.transit_time_days)),
      nextEtd: earliestEtd(group),
    });
  }

  // Busiest first — the shape most of the market sails is the baseline the rest are read against.
  // Ties broken by median, so the faster of two equally-served corridors leads.
  return out.sort(
    (a, b) =>
      b.departures - a.departures ||
      (a.transit.median ?? Infinity) - (b.transit.median ?? Infinity),
  );
}

// ── View B: carriers ─────────────────────────────────────────────────────────────────

export interface CarrierRow {
  carrier: string;
  departures: number;
  corridors: number;
  direct: number;
  ts1: number;
  ts2plus: number;
  transit: Spread;
  /** Discharge ports this carrier uses to reach the lane's Last CY. */
  pods: string[];
  nextEtd: string | null;
  avgGapDays: number | null;
  /**
   * True when this carrier shows no direct sailing in the snapshot. NOT the same as "runs none".
   *
   * `schedules_latest` keeps only the newest snapshot per (carrier, POL, last_cy). WHL's published
   * routing for Semarang -> Los Angeles alternates between snapshots — Jul 29, Aug 7 and Aug 17
   * entirely direct; Aug 12 and Aug 31 entirely transshipped — so the latest snapshot reports zero
   * direct for a carrier with 35 direct departures in history. Render as "none in this snapshot",
   * never as a bare 0.
   */
  directUnknown: boolean;
}

/**
 * A statistical summary per carrier — the "who should I be talking to" view.
 *
 * Two carriers with the same average are not equivalent, and the table has to show why: weekly,
 * direct, tight spread is a base allocation; fortnightly, 2 TS, wide spread is opportunistic
 * volume. Cadence and spread carry that distinction, so both are columns rather than a tooltip.
 */
export function carrierStats(rows: Schedule[], lane?: Lane): CarrierRow[] {
  const conns = dedupeConnections(inLane(rows, lane));
  const groups = new Map<string, Schedule[]>();

  for (const c of conns) {
    const bucket = groups.get(c.carrier_code);
    if (bucket) bucket.push(c);
    else groups.set(c.carrier_code, [c]);
  }

  const out: CarrierRow[] = [];
  for (const [carrier, group] of groups) {
    const direct = group.filter((g) => tsCount(g) === 0).length;
    out.push({
      carrier,
      departures: group.length,
      corridors: new Set(
        group.map((g) => [...(g.ts_ports ?? []), g.port_of_discharge].join(" > ")),
      ).size,
      direct,
      ts1: group.filter((g) => tsCount(g) === 1).length,
      ts2plus: group.filter((g) => tsCount(g) >= 2).length,
      transit: spreadOf(group.map((g) => g.transit_time_days)),
      pods: [...new Set(group.map((g) => g.port_of_discharge))].sort(),
      nextEtd: earliestEtd(group),
      avgGapDays: averageGapDays(group.map((g) => g.etd)),
      directUnknown: direct === 0,
    });
  }

  return out.sort(
    (a, b) => b.departures - a.departures || a.carrier.localeCompare(b.carrier),
  );
}

// ── shared ───────────────────────────────────────────────────────────────────────────

/** Lanes present in a snapshot, busiest first — what the lane picker offers. */
export function lanesIn(rows: Schedule[]): Array<Lane & { departures: number }> {
  const groups = new Map<string, Schedule[]>();
  for (const c of dedupeConnections(rows)) {
    const key = `${c.port_of_loading}\u0000${c.last_cy}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(c);
    else groups.set(key, [c]);
  }
  return [...groups.values()]
    .map((group) => ({
      pol: group[0].port_of_loading,
      lastCy: group[0].last_cy,
      departures: group.length,
    }))
    .sort(
      (a, b) =>
        b.departures - a.departures ||
        a.pol.localeCompare(b.pol) ||
        a.lastCy.localeCompare(b.lastCy),
    );
}

const inLane = (rows: Schedule[], lane?: Lane) =>
  lane
    ? rows.filter((r) => r.port_of_loading === lane.pol && r.last_cy === lane.lastCy)
    : rows;

// Nulls last, via the shared comparator — sorting ETDs directly is what shipped a crash once.
const earliestEtd = (group: Schedule[]): string | null =>
  group.map((g) => g.etd).sort(compareDateAsc)[0] ?? null;
