import Link from "next/link";
import { desc, eq, isNull, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { properties, propertyScores, hoaDetails } from "@/db/schema";
import { archivePropertyAction } from "./actions";
import {
  STATUS_LABEL,
  STATUS_CLASS,
  scoreClass,
  recClass,
  ratingClass,
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
      communityHoa: properties.communityHoa,
      cityArea: properties.cityArea,
      status: properties.status,
      price: properties.price,
      estMonthly: properties.estMonthlyPayment,
      total: propertyScores.weightedScore,
      recommendation: propertyScores.recommendation,
      hoaRating: hoaDetails.rating,
    })
    .from(properties)
    .leftJoin(propertyScores, eq(properties.id, propertyScores.propertyId))
    .leftJoin(hoaDetails, eq(properties.id, hoaDetails.propertyId))
    .where(isNull(properties.archivedAt))
    .orderBy(desc(propertyScores.weightedScore));

  // Count archived houses so we can surface a link to the Archived list.
  const archivedRows = await db
    .select({ id: properties.id })
    .from(properties)
    .where(isNotNull(properties.archivedAt));
  const archivedCount = archivedRows.length;

  // Sort: scored first (desc), then unscored.
  const sorted = [...rows].sort((a, b) => {
    const av = a.total == null ? -1 : Number(a.total);
    const bv = b.total == null ? -1 : Number(b.total);
    return bv - av;
  });

  // Dashboard metrics (mirrors the tracker's Dashboard sheet).
  const scores = sorted
    .map((r) => (r.total == null ? null : Number(r.total)))
    .filter((n): n is number => n != null);
  const ests = sorted
    .map((r) => (r.estMonthly == null ? null : Number(r.estMonthly)))
    .filter((n): n is number => n != null);
  const metrics = {
    tracked: sorted.length,
    highest: scores.length ? Math.max(...scores) : null,
    strong: sorted.filter((r) => r.recommendation === "Strong candidate")
      .length,
    good: sorted.filter((r) => r.recommendation === "Good option").length,
    avgMonthly: ests.length
      ? Math.round(ests.reduce((a, b) => a + b, 0) / ests.length)
      : null,
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Houses</h1>
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span>{sorted.length} tracked</span>
          {archivedCount > 0 ? (
            <Link href="/archived" className="hover:text-brand">
              Archived ({archivedCount})
            </Link>
          ) : null}
        </div>
      </div>

      {sorted.length > 0 ? (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Metric label="Tracked" value={String(metrics.tracked)} />
          <Metric label="Highest score" value={fmtScore(metrics.highest)} />
          <Metric label="Strong candidates" value={String(metrics.strong)} />
          <Metric label="Good options" value={String(metrics.good)} />
          <Metric label="Avg est. monthly" value={fmtMoney(metrics.avgMonthly)} />
        </div>
      ) : null}

      {sorted.length === 0 ? (
        <div className="card text-center text-slate-500">
          <p className="mb-3">No houses yet.</p>
          <Link href="/properties/new" className="btn">
            + Add your first house
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Score</th>
                <th className="px-4 py-2 font-medium">Recommendation</th>
                <th className="px-4 py-2 font-medium">Address</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">HOA</th>
                <th className="px-4 py-2 font-medium">Price</th>
                <th className="px-4 py-2 font-medium">Est. monthly</th>
                <th className="px-4 py-2 font-medium"></th>
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
                      className={`badge ${
                        STATUS_CLASS[r.status ?? "New"] ?? ""
                      }`}
                    >
                      {STATUS_LABEL[r.status ?? "New"] ?? r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {r.hoaRating == null ? (
                      <span className="text-slate-300">—</span>
                    ) : (
                      <span
                        className={`badge ${ratingClass(Number(r.hoaRating))}`}
                        title="HOA validator rating (0–5)"
                      >
                        {Number(r.hoaRating).toFixed(1)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">{fmtMoney(r.price)}</td>
                  <td className="px-4 py-2">{fmtMoney(r.estMonthly)}</td>
                  <td className="px-4 py-2 text-right">
                    <form action={archivePropertyAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button
                        className="text-xs text-slate-400 hover:text-amber-700"
                        title="Archive — hide from list, comparison, and map (restore anytime)"
                      >
                        Archive
                      </button>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="card py-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}
