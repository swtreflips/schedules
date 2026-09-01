import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Schedule } from "../types/schedule";

/**
 * The current market, fetched once.
 *
 * Analytics does NOT reuse the grid's `rows`. That array is one lane, found by POL plus a radius
 * around a geocoded destination, so it can answer "which sailing" but not "what does this lane look
 * like compared with the rest". This reads the whole current-market view instead and derives every
 * table from it client-side, which also means the tables are projections of one array and cannot
 * disagree with each other.
 *
 * Narrow column list on purpose: `raw_schedule`, `route_metadata` and the three geometry columns
 * dominate the payload and nothing here needs them.
 *
 * Reads `schedules_latest_secure` — the guarded view — which applies both the internal-org gate and
 * the freshness window at query time. A carrier that has not been scraped inside the window is
 * absent rather than stale, which is why `snapshotAt` is returned: silent absence looks exactly
 * like having no service, and the UI has to be able to say which it is.
 */

const COLUMNS = [
  "carrier_code",
  "carrier_name",
  "port_of_loading",
  "port_of_discharge",
  "last_cy",
  "etd",
  "eta",
  "transit_time_days",
  "transport_type",
  "mother_vessel",
  "ts_ports",
  "ts_vessels",
  "vessel_sequence",
  "query_date",
].join(",");

interface MarketSnapshot {
  rows: Schedule[];
  /** Newest `query_date` in the snapshot — how current the whole picture is. */
  snapshotAt: string | null;
  /** Per carrier, when that carrier was last scraped. A carrier missing here is not in the window. */
  scrapedByCarrier: Map<string, string>;
  loading: boolean;
  error: string | null;
}

export function useMarketSnapshot(): MarketSnapshot {
  const [rows, setRows] = useState<Schedule[]>([]);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [scrapedByCarrier, setScraped] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // PostgREST caps a response, and the market view is larger than that cap; page rather than
      // silently analysing the first slice of it.
      const PAGE = 1000;
      const all: Array<Schedule & { query_date?: string }> = [];
      let start = 0;

      try {
        for (;;) {
          const { data, error: err } = await supabase
            .from("schedules_latest_secure")
            .select(COLUMNS)
            .range(start, start + PAGE - 1);
          if (err) throw new Error(err.message);
          const batch = (data ?? []) as unknown as Array<Schedule & { query_date?: string }>;
          all.push(...batch);
          if (batch.length < PAGE) break;
          start += PAGE;
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
        return;
      }

      if (cancelled) return;

      const scraped = new Map<string, string>();
      let newest: string | null = null;
      for (const r of all) {
        const q = r.query_date ?? null;
        if (!q) continue;
        if (!newest || q > newest) newest = q;
        const prev = scraped.get(r.carrier_code);
        if (!prev || q > prev) scraped.set(r.carrier_code, q);
      }

      setRows(all as Schedule[]);
      setSnapshotAt(newest);
      setScraped(scraped);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { rows, snapshotAt, scrapedByCarrier, loading, error };
}
