// Server-side driving-time lookups via the Google Distance Matrix API. Given a
// house (origin) and the user's saved destinations (grocery, office, gym, ...),
// return driving duration + distance to each.
//
// Like geocoding, this is best-effort: a missing key, a network error, or a
// no-result response never throws — the corresponding destination just comes
// back as null. The server key (GOOGLE_MAPS_API_KEY) is preferred, falling back
// to the public maps key.

import type { LatLng } from "./geocode";

const METERS_PER_MILE = 1609.34;

export interface DriveResult {
  /** Driving time, rounded to whole minutes. */
  durationMin: number;
  /** Driving distance in miles, rounded to one decimal. */
  distanceMi: number;
}

/** True when a Google Maps key is available to compute drive times. */
export function driveTimesConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_MAPS_API_KEY ||
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
  );
}

function mapsKey(): string | undefined {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    undefined
  );
}

interface MatrixElement {
  status?: string;
  duration?: { value?: number };
  distance?: { value?: number };
}

/**
 * Driving duration + distance from a single origin to many destinations, in the
 * same order as `destinations`. Each entry is null when that leg can't be
 * computed (no key, network error, no route). One Distance Matrix request covers
 * all destinations (up to the API's 25-per-request limit, plenty for a handful
 * of saved places).
 */
export async function driveTimes(
  origin: LatLng,
  destinations: LatLng[],
): Promise<(DriveResult | null)[]> {
  const key = mapsKey();
  if (!key || destinations.length === 0) {
    return destinations.map(() => null);
  }

  const originParam = `${origin.latitude},${origin.longitude}`;
  const destParam = destinations
    .map((d) => `${d.latitude},${d.longitude}`)
    .join("|");

  try {
    const url =
      "https://maps.googleapis.com/maps/api/distancematrix/json" +
      `?origins=${encodeURIComponent(originParam)}` +
      `&destinations=${encodeURIComponent(destParam)}` +
      `&mode=driving&units=imperial&key=${key}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return destinations.map(() => null);
    const body = (await res.json()) as {
      status?: string;
      rows?: { elements?: MatrixElement[] }[];
    };
    if (body.status !== "OK") return destinations.map(() => null);

    const elements = body.rows?.[0]?.elements ?? [];
    return destinations.map((_, i) => {
      const el = elements[i];
      if (!el || el.status !== "OK") return null;
      const seconds = el.duration?.value;
      const meters = el.distance?.value;
      if (typeof seconds !== "number" || typeof meters !== "number") return null;
      return {
        durationMin: Math.round(seconds / 60),
        distanceMi: Math.round((meters / METERS_PER_MILE) * 10) / 10,
      };
    });
  } catch {
    return destinations.map(() => null);
  }
}
