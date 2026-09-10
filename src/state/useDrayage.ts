import { useEffect, useRef, useState } from "react";
import { routeBatch } from "../lib/geoapi";
import { toDray, type Dray } from "../lib/analytics/drayage";

/**
 * Road distance from every Last CY in the current result set to the customer's door.
 *
 * MEMOISED ACROSS THE SESSION, not just across renders. The carrier filter and the CRD picker
 * re-derive the analytics tables on every change, and each of those would otherwise re-ask for legs
 * that cannot have moved — the Last CYs a search returned are fixed until the next search. A
 * module-level cache keyed on `lastCy` + destination survives tab switches too, so flipping between
 * Plan and Analytics costs nothing.
 *
 * A FAILED LEG IS CACHED AS A FAILURE. Without that, a place the router cannot resolve is retried
 * on every render forever — silent hammering that shows up only as a bill. A NETWORK failure is not
 * cached, because that one really is transient.
 */

// A pipe cannot occur in a place name, so two parts can never collide. (departures.ts uses
// U+0000 for the same job; this key never leaves this module, and a printable separator keeps
// it legible in a debugger.)
const SEP = "|";
const cache = new Map<string, Dray | null>();
const cacheKey = (lastCy: string, destination: string) => lastCy + SEP + destination;

export interface DrayageState {
  /** Last CY -> its ground leg. Absent means unknown, and the UI must render that as "—". */
  dray: Map<string, Dray>;
  loading: boolean;
  error: string | null;
}

export function useDrayage(lastCys: string[], destination: string): DrayageState {
  const [, bump] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A change detector only — never parsed back apart. Place names contain spaces and commas, so
  // any delimiter-joined string is safe to compare and unsafe to split.
  const signature = [...new Set(lastCys)].sort().join(SEP);
  const wanted = useRef<string[]>([]);
  wanted.current = [...new Set(lastCys)];

  const inFlight = useRef<string | null>(null);

  useEffect(() => {
    if (!destination || !wanted.current.length) return;

    const missing = wanted.current.filter((cy) => !cache.has(cacheKey(cy, destination)));
    if (!missing.length) return;

    // Guards React 18's double-invoke and a second render firing the same batch.
    const token = destination + SEP + signature;
    if (inFlight.current === token) return;
    inFlight.current = token;

    let cancelled = false;
    setLoading(true);
    setError(null);

    routeBatch(missing.map((cy) => ({ a: cy, b: destination })))
      .then((legs) => {
        // Index-aligned by contract, so position is the join.
        legs.forEach((leg, i) => {
          cache.set(
            cacheKey(missing[i], destination),
            leg.ok ? toDray(leg.distance_m, leg.duration_s) : null,
          );
        });
        if (!cancelled) {
          setLoading(false);
          bump((n) => n + 1);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        inFlight.current = null; // transient — the next search may try again
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [signature, destination]);

  const dray = new Map<string, Dray>();
  for (const cy of new Set(lastCys)) {
    const hit = cache.get(cacheKey(cy, destination));
    if (hit) dray.set(cy, hit);
  }

  return { dray, loading, error };
}
