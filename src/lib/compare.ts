/**
 * Ordering helpers for schedule fields that the database allows to be null.
 *
 * `etd`, `eta`, `pod_eta` and `transit_time_days` are ALL nullable in the schema, and `eta` really
 * is null on live rows — a carrier publishes a sailing before it will commit to an arrival. The
 * Schedule type used to declare them as plain `string`, so TypeScript could not warn about any of
 * this, and `a.eta.localeCompare(b.eta)` threw the moment such a row reached a sort.
 *
 * NULLS SORT LAST, and that is a product decision rather than a convenience.
 *
 * In Plan view the first element of each carrier's group is that carrier's default recommendation.
 * Sorting a null ETA to the front would promote "we don't know when this arrives" into the
 * headline pick for that carrier — worse than the crash it replaces, because it looks like an
 * answer. Last is where an unknown belongs: still visible, never recommended.
 */

/** ISO date strings ascending, nulls last. Safe when either side is null. */
export function compareDateAsc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.localeCompare(b);
}

/** Numbers ascending, nulls last. Same reasoning as `compareDateAsc`. */
export function compareNumberAsc(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}
