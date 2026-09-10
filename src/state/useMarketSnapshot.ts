import { supabase } from "../lib/supabase";
import type { Schedule } from "../types/schedule";

/**
 * The current market — fetched ON DEMAND, for the report only.
 *
 * THIS USED TO RUN ON EVERY VISIT TO THE ANALYTICS TAB, and the comment here used to argue that
 * Analytics must not reuse the grid's rows because that array "can answer which sailing but not
 * what this lane looks like compared with the rest". That was right about the report and wrong
 * about the screen.
 *
 * The screen's question is *"how does the market serve MY destination"* — a warehouse in
 * Gainesville, FL, reached through Jacksonville by some carriers and Savannah by others. That is
 * exactly what the search already returns, so Analytics now reads the search like Plan and Rank do.
 *
 * The whole market is still what the REPORT needs, because a point-to-point comparison wants every
 * lane rather than one destination's worth. So this stayed — as a function, called when the report
 * button is pressed, rather than a hook firing on mount. Opening the tab no longer pages the entire
 * schedules view.
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

export interface MarketSnapshot {
  rows: Schedule[];
  /** Newest `query_date` in the snapshot — how current the whole picture is. */
  snapshotAt: string | null;
  /** Per carrier, when that carrier was last scraped. A carrier missing here is not in the window. */
  scrapedByCarrier: Map<string, string>;
}

/** Throws on failure — the caller has a button to put into an error state. */
export async function fetchMarketSnapshot(): Promise<MarketSnapshot> {
  // PostgREST caps a response, and the market view is larger than that cap; page rather than
  // silently analysing the first slice of it.
  const PAGE = 1000;
  const all: Array<Schedule & { query_date?: string }> = [];
  let start = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("schedules_latest_secure")
      .select(COLUMNS)
      .range(start, start + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as unknown as Array<Schedule & { query_date?: string }>;
    all.push(...batch);
    if (batch.length < PAGE) break;
    start += PAGE;
  }

  const scrapedByCarrier = new Map<string, string>();
  let snapshotAt: string | null = null;
  for (const r of all) {
    const q = r.query_date ?? null;
    if (!q) continue;
    if (!snapshotAt || q > snapshotAt) snapshotAt = q;
    const prev = scrapedByCarrier.get(r.carrier_code);
    if (!prev || q > prev) scrapedByCarrier.set(r.carrier_code, q);
  }

  return { rows: all as Schedule[], snapshotAt, scrapedByCarrier };
}
