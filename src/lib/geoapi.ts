import { supabase } from "./supabase";

export interface GeocodeResult {
  query: string;
  latitude: number;
  longitude: number;
  display_name?: string;
  provider: string;
  cached: boolean;
}

export class GeocodeError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "GeocodeError";
  }
}

/**
 * Geocode a destination through the shared geo brain (geoapi-next).
 *
 * This used to call a FastAPI service on Render at `${base}/geocode`, built before the
 * brain existed and doing the same job: Nominatim lookup, PostGIS cache. The brain is the
 * org's geo service, not a rates dependency, so there is one geocoder and one cache.
 *
 * Two things changed with the move:
 *   * the path gained an /api prefix
 *   * it requires a Supabase access token — only signed-in users spend the upstream quota
 *
 * The token is read PER REQUEST, never captured at module load: access tokens last an
 * hour, and getSession() refreshes one that is close to expiry. A captured token turns
 * into a 401 partway through a session.
 */
export async function geocode(query: string): Promise<GeocodeResult> {
  const base = import.meta.env.VITE_GEOAPI_URL;
  const url = `${base}/api/geocode?q=${encodeURIComponent(query)}`;

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new GeocodeError("Not signed in — cannot reach the geocoder.", 401);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
  } catch (e) {
    throw new GeocodeError(
      `Network error reaching geocoder: ${(e as Error).message}`
    );
  }

  if (res.status === 401) {
    throw new GeocodeError("Session expired — sign in again.", 401);
  }
  if (res.status === 404) {
    throw new GeocodeError(`No location found for "${query}"`, 404);
  }
  if (!res.ok) {
    throw new GeocodeError(`Geocoder returned ${res.status}`, res.status);
  }

  return res.json();
}
