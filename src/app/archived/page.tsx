import Link from "next/link";
import { desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { properties, propertyScores } from "@/db/schema";
import { unarchivePropertyAction } from "../actions";
import {
  STATUS_LABEL,
  STATUS_CLASS,
  scoreClass,
  recClass,
  fmtMoney,
  fmtScore,
} from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function ArchivedPage() {
  const rows = await db
    .select({
      id: properties.id,
      address: properties.address,
      communityHoa: properties.communityHoa,
      cityArea: properties.cityArea,
      status: properties.status,
      price: properties.price,
      archivedAt: properties.archivedAt,
      total: propertyScores.weightedScore,
      recommendation: propertyScores.recommendation,
    })
    .from(properties)
    .leftJoin(propertyScores, eq(properties.id, propertyScores.propertyId))
    .where(isNotNull(properties.archivedAt))
    .orderBy(desc(properties.archivedAt));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Archived houses</h1>
        <Link href="/" className="text-sm text-slate-500 hover:text-brand">
          ← Back to Houses
        </Link>
      </div>
      <p className="mb-4 text-sm text-slate-500">
        Houses you’ve archived (e.g. sold or no longer of interest). They’re
        hidden from the main list, comparison, and map. Restore one to bring it
        back.
      </p>

      {rows.length === 0 ? (
        <div className="card text-center text-slate-500">
          <p className="mb-3">No archived houses.</p>
          <Link href="/" className="btn">
            Back to Houses
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Score</th>
                <th className="px-4 py-2 font-medium">Recommendation</th>
                <th className="px-4 py-2 font-medium">Address</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Price</th>
                <th className="px-4 py-2 font-medium">Archived</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
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
                    <span className={`badge ${recClass(r.recommendation)}`}>
                      {r.recommendation ?? "Needs data"}
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
                      {[r.communityHoa, r.cityArea].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`badge ${STATUS_CLASS[r.status ?? "New"] ?? ""}`}
                    >
                      {STATUS_LABEL[r.status ?? "New"] ?? r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">{fmtMoney(r.price)}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {r.archivedAt
                      ? new Date(r.archivedAt).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <form action={unarchivePropertyAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="btn-ghost py-1">Restore</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
