// Server-side geocoding via the Google Geocoding API. Phase 1, step 8 of the
// roadmap: turn a saved address into lat/lng so the Map view can plot it.
//
// This is best-effort: a missing key, a network error, or a no-result response
// never throws — it returns null so saving a property always succeeds. The
// browser-facing map uses NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; server geocoding
// prefers GOOGLE_MAPS_API_KEY and falls back to the public key.

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface AddressParts {
  address: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

/** Build a single-line address string from the property's parts. */
export function formatAddress(parts: AddressParts): string {
  return [parts.address, parts.city, parts.state, parts.zip]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

function geocodingKey(): string | undefined {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    undefined
  );
}

/**
 * Geocode an address to coordinates. Returns null on any failure (no key,
 * network error, zero results) so callers can treat geocoding as optional.
 */
export async function geocode(parts: AddressParts): Promise<LatLng | null> {
  const key = geocodingKey();
  const query = formatAddress(parts);
  if (!key || !query) return null;

  try {
    const url =
      "https://maps.googleapis.com/maps/api/geocode/json" +
      `?address=${encodeURIComponent(query)}&key=${key}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      status?: string;
      results?: { geometry?: { location?: { lat: number; lng: number } } }[];
    };
    if (body.status !== "OK") return null;
    const loc = body.results?.[0]?.geometry?.location;
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
      return null;
    }
    return { latitude: loc.lat, longitude: loc.lng };
  } catch {
    return null;
  }
}
