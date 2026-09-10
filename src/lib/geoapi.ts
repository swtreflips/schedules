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

/** One leg's answer. `ok: false` is a real outcome, not an exception — see `routeBatch`. */
export type RouteLeg =
  | { ok: true; distance_m: number; duration_s: number; cached: boolean }
  | { ok: false; detail: string };

/**
 * Truck routing for many pairs in one call — the drayage leg from each Last CY to the destination.
 *
 * ROAD MILES, NOT STRAIGHT-LINE. The search radius is already a haversine test done in PostGIS, and
 * it answers a different question: whether a discharge point is close enough to be worth
 * considering. What the ground move actually costs is a road distance, and a bay or a mountain
 * makes those two numbers diverge badly.
 *
 * INDEX-ALIGNED, AND A BAD PAIR DEGRADES ALONE. The endpoint guarantees `results[i]` answers
 * `pairs[i]`, and returns `{ ok: false, detail }` for a pair it could not resolve rather than
 * failing the batch. Verified against the live service: five real pairs plus one deliberately empty
 * origin came back six-long with only the empty one failing.
 *
 * The result is cached server-side in `drayage_routes`, so the same pairs are cheap on repeat —
 * measured 7.9s cold for five novel pairs against 281ms warm. Callers should still memoise, because
 * a re-render is not a reason to spend even 281ms.
 *
 * Token read PER REQUEST for the same reason `geocode` does it: access tokens last an hour, and one
 * captured at module load becomes a 401 partway through a session.
 */
export async function routeBatch(
  pairs: Array<{ a: string; b: string }>,
): Promise<RouteLeg[]> {
  if (!pairs.length) return [];

  const base = import.meta.env.VITE_GEOAPI_URL;
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new GeocodeError("Not signed in — cannot reach the router.", 401);
  }

  let res: Response;
  try {
    res = await fetch(`${base}/api/route-batch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pairs }),
    });
  } catch (e) {
    throw new GeocodeError(`Network error reaching router: ${(e as Error).message}`);
  }

  if (res.status === 401) throw new GeocodeError("Session expired — sign in again.", 401);
  if (!res.ok) throw new GeocodeError(`Router returned ${res.status}`, res.status);

  const body = (await res.json()) as { results?: RouteLeg[] };
  return body.results ?? [];
}
