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

export async function geocode(query: string): Promise<GeocodeResult> {
  const base = import.meta.env.VITE_GEOAPI_URL;
  const url = `${base}/geocode?q=${encodeURIComponent(query)}`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new GeocodeError(
      `Network error reaching geocoder: ${(e as Error).message}`
    );
  }

  if (res.status === 404) {
    throw new GeocodeError(`No location found for "${query}"`, 404);
  }
  if (!res.ok) {
    throw new GeocodeError(`Geocoder returned ${res.status}`, res.status);
  }

  return res.json();
}
