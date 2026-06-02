import { createClient } from "@supabase/supabase-js";
import type { Schedule } from "../types/schedule";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export interface NearbySchedulesArgs {
  pol: string;
  lat: number;
  lon: number;
  radiusMiles: number;
}

const MILES_TO_METERS = 1609.34;

export async function findNearbySchedules(
  args: NearbySchedulesArgs
): Promise<Schedule[]> {
  const { data, error } = await supabase.rpc("nearby_schedules", {
    p_pol: args.pol,
    p_lat: args.lat,
    p_lon: args.lon,
    p_radius_meters: args.radiusMiles * MILES_TO_METERS,
  });

  if (error) throw new Error(`Supabase RPC failed: ${error.message}`);
  return (data ?? []) as Schedule[];
}

export { supabase };

/**
 * Fetches every non-null port_of_loading from schedules_latest and returns
 * the deduplicated, alphabetically sorted set. Powers the POL autocomplete.
 *
 * Selecting one column keeps the payload small; if/when this gets sluggish
 * at scale, swap to a dedicated `distinct_pols()` Postgres function.
 */
export async function getDistinctPOLs(): Promise<string[]> {
  const { data, error } = await supabase
    .from("schedules_latest")
    .select("port_of_loading")
    .not("port_of_loading", "is", null);

  if (error) throw new Error(`Failed to load POL options: ${error.message}`);

  const unique = new Set<string>();
  for (const row of data ?? []) {
    const v = (row as { port_of_loading: string | null }).port_of_loading;
    if (v) unique.add(v);
  }
  return [...unique].sort((a, b) => a.localeCompare(b));
}
