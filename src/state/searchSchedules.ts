import { geocode } from "../lib/geoapi";
import { findNearbySchedules } from "../lib/supabase";
import type { Schedule } from "../types/schedule";

export interface SearchParams {
  pol: string;
  destination: string;
  radiusMiles: number;
}

/**
 * Orchestrator: chains the geocode call and the Supabase RPC call.
 * - Step 1: geocode the destination (cache-first via Render API)
 * - Step 2: query schedules within radius of the resolved coords
 * Throws on either failure so the caller can handle errors once.
 */
export async function searchSchedules(
  params: SearchParams
): Promise<Schedule[]> {
  const { latitude, longitude } = await geocode(params.destination);

  return findNearbySchedules({
    pol: params.pol,
    lat: latitude,
    lon: longitude,
    radiusMiles: params.radiusMiles,
  });
}
