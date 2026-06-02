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
