import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { properties, propertyScores } from "@/db/schema";
import {
  STATUS_LABEL,
  STATUS_CLASS,
  scoreClass,
  fmtMoney,
  fmtNum,
  fmtScore,
} from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const rows = await db
    .select({
      id: properties.id,
      address: properties.address,
      city: properties.city,
      state: properties.state,
      status: properties.status,
      price: properties.price,
      beds: properties.beds,
      baths: properties.baths,
      sqft: properties.sqft,
      total: propertyScores.totalWeightedScore,
    })
    .from(properties)
    .leftJoin(
      propertyScores,
      eq(properties.id, propertyScores.propertyId),
    )
    .orderBy(desc(propertyScores.totalWeightedScore));

  // Sort: scored first (desc), then unscored.
  const sorted = [...rows].sort((a, b) => {
    const av = a.total == null ? -1 : Number(a.total);
    const bv = b.total == null ? -1 : Number(b.total);
    return bv - av;
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Houses</h1>
        <p className="text-sm text-slate-500">{sorted.length} tracked</p>
      </div>

      {sorted.length === 0 ? (
        <div className="card text-center text-slate-500">
          <p className="mb-3">No houses yet.</p>
          <Link href="/properties/new" className="btn">
            + Add your first house
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Score</th>
                <th className="px-4 py-2 font-medium">Address</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Price</th>
                <th className="px-4 py-2 font-medium">Beds/Baths</th>
                <th className="px-4 py-2 font-medium">Sq ft</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <span
                      className={`badge ${scoreClass(
                        r.total == null ? null : Number(r.total),
                      )}`}
                    >
                      {fmtScore(r.total)}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/properties/${r.id}`}
                      className="font-medium text-brand hover:underline"
                    >
                      {r.address}
                    </Link>
                    <div className="text-xs text-slate-400">
                      {[r.city, r.state].filter(Boolean).join(", ")}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`badge ${
                        STATUS_CLASS[r.status ?? "new"] ?? ""
                      }`}
                    >
                      {STATUS_LABEL[r.status ?? "new"] ?? r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">{fmtMoney(r.price)}</td>
                  <td className="px-4 py-2">
                    {fmtNum(r.beds)} / {fmtNum(r.baths)}
                  </td>
                  <td className="px-4 py-2">{fmtNum(r.sqft)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
