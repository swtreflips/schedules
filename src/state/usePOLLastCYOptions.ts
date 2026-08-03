import { useEffect, useMemo, useState } from "react";
import { getDistinctPOLLastCYPairs, type POLLastCYPair } from "../lib/supabase";

/**
 * Fetches all unique (pol, last_cy) pairs once on mount, then derives
 * filtered option lists for both fields client-side.
 *
 * Cross-filtering rules:
 *   - polOptions:   if lastCY is a confirmed selection → only POLs that share
 *                  that last_cy; otherwise all distinct POLs.
 *   - lastCYOptions: if pol is a confirmed selection → only last_cy values that
 *                    share that POL; otherwise all distinct last_cy values.
 *
 * A value is a "confirmed selection" when it exactly matches an entry in the
 * pairs universe — meaning the user picked from the dropdown, not mid-type.
 */
export function usePOLLastCYOptions(pol: string, lastCY: string) {
  const [pairs, setPairs] = useState<POLLastCYPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDistinctPOLLastCYPairs()
      .then((data) => {
        if (cancelled) return;
        setPairs(data);
        setError(null);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const polSet = useMemo(() => new Set(pairs.map((p) => p.pol)), [pairs]);
  const lastCYSet = useMemo(() => new Set(pairs.map((p) => p.last_cy)), [pairs]);

  const polOptions = useMemo(() => {
    if (lastCYSet.has(lastCY)) {
      return pairs
        .filter((p) => p.last_cy === lastCY)
        .map((p) => p.pol)
        .sort();
    }
    return [...polSet].sort();
  }, [pairs, polSet, lastCY, lastCYSet]);

  const lastCYOptions = useMemo(() => {
    if (polSet.has(pol)) {
      return pairs
        .filter((p) => p.pol === pol)
        .map((p) => p.last_cy)
        .sort();
    }
    return [...lastCYSet].sort();
  }, [pairs, lastCYSet, pol, polSet]);

  return { polOptions, lastCYOptions, loading, error };
}
