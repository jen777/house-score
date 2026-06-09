import Link from "next/link";
import { eq, isNotNull, isNull, and } from "drizzle-orm";
import { db } from "@/db";
import { properties, propertyScores } from "@/db/schema";
import MapView, { type MapMarker } from "./MapView";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

  const rows = await db
    .select({
      id: properties.id,
      address: properties.address,
      communityHoa: properties.communityHoa,
      cityArea: properties.cityArea,
      status: properties.status,
      price: properties.price,
      latitude: properties.latitude,
      longitude: properties.longitude,
      score: propertyScores.weightedScore,
      recommendation: propertyScores.recommendation,
    })
    .from(properties)
    .leftJoin(propertyScores, eq(properties.id, propertyScores.propertyId))
    .where(
      and(
        isNotNull(properties.latitude),
        isNotNull(properties.longitude),
        isNull(properties.archivedAt),
      ),
    );

  const markers: MapMarker[] = rows.map((r) => ({
    id: r.id,
    address: r.address,
    community: [r.communityHoa, r.cityArea].filter(Boolean).join(" · ") || null,
    lat: Number(r.latitude),
    lng: Number(r.longitude),
    score: r.score == null ? null : Number(r.score),
    recommendation: r.recommendation,
    status: r.status,
    price: r.price,
  }));

  // How many active (non-archived) properties don't have coordinates yet.
  const total = await db
    .select({ id: properties.id })
    .from(properties)
    .where(isNull(properties.archivedAt));
  const missing = total.length - markers.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Map</h1>
        <p className="text-sm text-slate-500">{markers.length} mapped</p>
      </div>

      {!apiKey ? (
        <div className="card text-sm text-slate-600">
          <p className="mb-1 font-medium">Map key not configured.</p>
          <p className="text-slate-500">
            Set <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> (browser map) and{" "}
            <code>GOOGLE_MAPS_API_KEY</code> (server geocoding) to enable the
            map. See <code>.env.example</code>.
          </p>
        </div>
      ) : markers.length === 0 ? (
        <div className="card text-center text-slate-500">
          <p className="mb-3">
            No mapped houses yet. Coordinates are filled in automatically when
            you add or edit a house with a valid address.
          </p>
          <Link href="/properties/new" className="btn">
            + Add a house
          </Link>
        </div>
      ) : (
        <>
          <MapView markers={markers} apiKey={apiKey} />
          {missing > 0 ? (
            <p className="text-xs text-slate-400">
              {missing} saved{" "}
              {missing === 1 ? "house has" : "houses have"} no coordinates yet —
              edit and re-save to geocode.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
