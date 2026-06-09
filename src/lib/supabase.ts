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
 * Returns the deduplicated, alphabetically sorted set of every Port of
 * Loading present in schedules_latest. Powers the POL autocomplete.
 *
 * Backed by a Postgres function (distinct_pols) so the DISTINCT happens
 * server-side. The previous table-query approach silently truncated at
 * PostgREST's 1000-row default, missing any POL whose rows landed past
 * that boundary.
 */
export async function getDistinctPOLs(): Promise<string[]> {
  const { data, error } = await supabase.rpc("distinct_pols");
  if (error) throw new Error(`Failed to load POL options: ${error.message}`);
  return (data ?? []) as string[];
}
