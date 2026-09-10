/**
 * The ground leg, and what it costs in days.
 *
 * WHY THIS EXISTS. Scoped to a POL -> Last CY lane, every carrier ends in the same place and ocean
 * transit is a fair comparison. Scoped to a DESTINATION it is not: a Gainesville warehouse is
 * reached through Jacksonville (84 road miles) or Savannah (210), and a 26-day sailing into Savannah
 * is not obviously better than a 28-day one into Jacksonville. Something has to make the two
 * comparable again, and it is the leg the carrier does not sail.
 */

export interface Dray {
  /** Road miles, HERE truck routing. */
  miles: number;
  /** Drive hours, same source. */
  hours: number;
  /** Banded — see `drayDays`. */
  days: number;
}

/**
 * The band edges, in road miles. EXPORTED AND TUNABLE, because they are a judgement about how the
 * operation runs and not a measurement of anything.
 */
export const LOCAL_DRAY_MILES = 150;
export const REGIONAL_DRAY_MILES = 400;

/**
 * Road miles -> days added at the far end.
 *
 * ⚠ THIS IS BANDED ON PURPOSE, and the alternative was tried on paper first. Adding raw drive time
 * — `ocean + hours / 24` — reorders nothing at all: the default search radius is 187 straight-line
 * miles, so a ground leg is at most about 225 road miles, roughly 4 hours, roughly 0.17 days
 * against a 30-day sailing. Half a percent. A "door" column built that way is the ocean column with
 * noise on the end, and ranking on it would be ranking on ocean transit while claiming otherwise.
 *
 * Banding matches how the move actually runs. Under ~150 miles a dray is a same-day turn: one
 * driver, out and back, no overnight. Past that it stops being local — the driver cannot round-trip
 * inside a shift, so it costs a day. Past ~400 it is a linehaul.
 *
 * Measured on the two cases this was built for: Jacksonville (84 mi) and Tampa (137) both band to 1
 * against a Gainesville warehouse while Savannah (210) bands to 2 — which is the distinction that
 * decides the call. Cincinnati (90) and Louisville (67) into Seymour, IN both band to 1, so there
 * the door ranking equals the ocean ranking and the MILES column carries the difference. That is
 * the honest answer for that lane, not a failure to discriminate.
 *
 * NEVER ZERO. Even a yard in the destination city is a gate transaction, a chassis and an
 * appointment; nothing arrives at a door the moment it is discharged.
 */
export function drayDays(miles: number): number {
  if (!Number.isFinite(miles) || miles < 0) return 1;
  if (miles <= LOCAL_DRAY_MILES) return 1;
  if (miles <= REGIONAL_DRAY_MILES) return 2;
  return 3;
}

/** Build a `Dray` from what `route-batch` returns. */
export function toDray(distanceMeters: number, durationSeconds: number): Dray {
  const miles = distanceMeters / 1609.34;
  return {
    miles: Math.round(miles),
    hours: Math.round((durationSeconds / 3600) * 10) / 10,
    days: drayDays(miles),
  };
}

/**
 * Ocean days plus the ground leg.
 *
 * NULL STAYS NULL. A sailing with no published transit has no door transit either — returning the
 * dray alone would report a 1-day door move as if the ocean leg were free, which is the kind of
 * confident wrong number this codebase keeps refusing to print.
 *
 * An unknown ground leg (the geo lookup failed) also yields null rather than the ocean figure
 * silently standing in for a door figure.
 */
export function doorTransit(oceanDays: number | null, dray: Dray | undefined): number | null {
  if (oceanDays == null || dray == null) return null;
  return Math.round((oceanDays + dray.days) * 10) / 10;
}
