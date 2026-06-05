// Server-side driving-time lookups via the Google Distance Matrix API. Given a
// house (origin) and the user's saved destinations (grocery, office, gym, ...),
// return driving duration + distance to each.
//
// Like geocoding, this is best-effort: a missing key, a network error, or a
// no-result response never throws — the corresponding destination just comes
// back as null. The server key (GOOGLE_MAPS_API_KEY) is preferred, falling back
// to the public maps key.

import type { LatLng } from "./geocode";
import { logInfo, logWarn, logError } from "./log";

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
  if (!key) {
    logWarn("drivetime", "no Google Maps API key configured; skipping", {
      destinations: destinations.length,
    });
    return destinations.map(() => null);
  }
  if (destinations.length === 0) return [];

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
    if (!res.ok) {
      logError("drivetime", "HTTP error from Distance Matrix API", {
        httpStatus: res.status,
        destinations: destinations.length,
      });
      return destinations.map(() => null);
    }
    const body = (await res.json()) as {
      status?: string;
      error_message?: string;
      rows?: { elements?: MatrixElement[] }[];
    };
    // status REQUEST_DENIED usually means the Distance Matrix API isn't enabled
    // on the key (the most common cause of "drive times never show up");
    // error_message carries Google's exact explanation.
    if (body.status !== "OK") {
      logError("drivetime", "Distance Matrix API returned non-OK status", {
        status: body.status,
        error: body.error_message,
        destinations: destinations.length,
      });
      return destinations.map(() => null);
    }

    const elements = body.rows?.[0]?.elements ?? [];
    let ok = 0;
    let failed = 0;
    const out = destinations.map((_, i) => {
      const el = elements[i];
      if (!el || el.status !== "OK") {
        // Per-leg failure: NOT_FOUND (un-geocodable point) or ZERO_RESULTS
        // (no drivable route, e.g. an island).
        logWarn("drivetime", "no route for destination", {
          index: i,
          status: el?.status ?? "MISSING",
        });
        failed++;
        return null;
      }
      const seconds = el.duration?.value;
      const meters = el.distance?.value;
      if (typeof seconds !== "number" || typeof meters !== "number") {
        logWarn("drivetime", "missing duration/distance for destination", {
          index: i,
        });
        failed++;
        return null;
      }
      ok++;
      return {
        durationMin: Math.round(seconds / 60),
        distanceMi: Math.round((meters / METERS_PER_MILE) * 10) / 10,
      };
    });
    logInfo("drivetime", "computed drive times", {
      requested: destinations.length,
      ok,
      failed,
    });
    return out;
  } catch (err) {
    logError("drivetime", "network error calling Distance Matrix API", {
      error: err,
      destinations: destinations.length,
    });
    return destinations.map(() => null);
  }
}
