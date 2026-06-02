import { useEffect, useState } from "react";
import { getDistinctPOLs } from "../lib/supabase";

/**
 * Fetches the distinct Port of Loading universe from schedules_latest once
 * on mount. The POL set is small and stable enough that one upfront fetch
 * gives instant client-side filtering as the user types — no per-keystroke
 * round-trip to Supabase.
 */
export function usePOLOptions() {
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDistinctPOLs()
      .then((opts) => {
        if (cancelled) return;
        setOptions(opts);
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

  return { options, loading, error };
}
