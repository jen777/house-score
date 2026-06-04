import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { places } from "@/db/schema";
import { driveTimesConfigured } from "@/lib/drivetime";
import { PLACE_CATEGORIES, PLACE_CATEGORY_LABEL } from "@/lib/ui";
import { addPlaceAction, deletePlaceAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function PlacesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const rows = await db.select().from(places).orderBy(asc(places.createdAt));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/" className="hover:text-brand">
          Houses
        </Link>
        <span>/</span>
        <span>Places</span>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">Saved places</h1>
        <p className="mt-1 text-sm text-slate-500">
          The destinations you care about — grocery store, office, gym, family.
          Add them once here, then on any house page compute the driving time to
          each.
        </p>
      </div>

      {error === "name-address" ? (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          A name and address are both required.
        </p>
      ) : null}

      {!driveTimesConfigured() ? (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Set <code className="rounded bg-amber-100 px-1">GOOGLE_MAPS_API_KEY</code>{" "}
          to geocode places and compute drive times. You can still add places
          now; they’ll be geocoded once a key is configured (re-save to retry).
        </p>
      ) : null}

      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">Add a place</h2>
        <form action={addPlaceAction} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="label">Name *</label>
              <input
                name="name"
                className="input"
                placeholder="Harris Teeter — Ballantyne"
                required
              />
            </div>
            <div>
              <label className="label">Category</label>
              <select name="category" className="input" defaultValue="grocery">
                {PLACE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {PLACE_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Address *</label>
            <input
              name="address"
              className="input"
              placeholder="123 Main St, Charlotte, NC 28277"
              required
            />
          </div>
          <button type="submit" className="btn">
            Add place
          </button>
        </form>
      </section>

      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">
          Your places{rows.length ? ` (${rows.length})` : ""}
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">
            No places yet. Add a few above to get started.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <span className="badge bg-slate-100 text-slate-600">
                      {PLACE_CATEGORY_LABEL[p.category ?? "other"] ??
                        p.category}
                    </span>
                    {p.latitude == null ? (
                      <span
                        className="badge bg-amber-100 text-amber-800"
                        title="Not geocoded — drive times can’t be computed until this resolves."
                      >
                        no coords
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-sm text-slate-500">{p.address}</p>
                </div>
                <form action={deletePlaceAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <button className="btn-ghost border-red-300 py-1 text-red-600 hover:bg-red-50">
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
