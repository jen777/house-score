import Link from "next/link";
import { eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { properties, propertyScores } from "@/db/schema";
import { CATEGORIES, CATEGORY_LABEL, type CategoryKey } from "@/lib/scoring";
import { SCORE_COLUMN } from "@/lib/recompute";
import {
  scoreClass,
  recClass,
  ratingClass,
  fmtMoney,
  fmtNum,
  fmtScore,
  fmtRating,
} from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[]; ids?: string }>;
}) {
  const sp = await searchParams;
  // Accept either ?id=a&id=b (from the form) or ?ids=a,b (shareable link).
  const fromId = Array.isArray(sp.id) ? sp.id : sp.id ? [sp.id] : [];
  const fromIds = (sp.ids ?? "").split(",").filter(Boolean);
  const all = await db
    .select({ id: properties.id, address: properties.address })
    .from(properties)
    .where(isNull(properties.archivedAt));

  const selectedIds = [...new Set([...fromId, ...fromIds])].slice(0, 4);

  const selected = selectedIds.length
    ? await db
        .select()
        .from(properties)
        .leftJoin(propertyScores, eq(properties.id, propertyScores.propertyId))
        .where(inArray(properties.id, selectedIds))
    : [];

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Compare</h1>

      <div className="card">
        <p className="mb-2 text-sm text-slate-500">
          Pick up to 4 houses to compare side by side.
        </p>
        <form method="get" className="flex flex-wrap gap-3">
          {all.map((p) => (
            <label key={p.id} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                name="id"
                value={p.id}
                defaultChecked={selectedIds.includes(p.id)}
              />
              {p.address}
            </label>
          ))}
          {all.length === 0 ? (
            <span className="text-sm text-slate-400">No houses yet.</span>
          ) : null}
          <button className="btn">Compare</button>
        </form>
      </div>

      {selected.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium text-slate-500">Metric</th>
                {selected.map((s) => (
                  <th key={s.properties.id} className="px-4 py-2 font-medium">
                    <Link
                      href={`/properties/${s.properties.id}`}
                      className="text-brand hover:underline"
                    >
                      {s.properties.address}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50/50 font-semibold">
                <td className="px-4 py-2">Weighted score</td>
                {selected.map((s) => {
                  const v =
                    s.property_scores?.weightedScore == null
                      ? null
                      : Number(s.property_scores.weightedScore);
                  return (
                    <td key={s.properties.id} className="px-4 py-2">
                      <span className={`badge ${scoreClass(v)}`}>
                        {fmtScore(v)}
                      </span>
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td className="px-4 py-2 text-slate-600">Recommendation</td>
                {selected.map((s) => (
                  <td key={s.properties.id} className="px-4 py-2">
                    <span
                      className={`badge ${recClass(
                        s.property_scores?.recommendation,
                      )}`}
                    >
                      {s.property_scores?.recommendation ?? "Needs data"}
                    </span>
                  </td>
                ))}
              </tr>
              <Row label="Price" cells={selected.map((s) => fmtMoney(s.properties.price))} />
              <Row label="Est. monthly" cells={selected.map((s) => fmtMoney(s.properties.estMonthlyPayment))} />
              <Row label="Beds / Baths" cells={selected.map((s) => `${fmtNum(s.properties.beds)} / ${fmtNum(s.properties.baths)}`)} />
              <Row label="Sq ft" cells={selected.map((s) => fmtNum(s.properties.sqft))} />
              <Row label="Year built" cells={selected.map((s) => fmtNum(s.properties.yearBuilt))} />
              <Row label="HOA/mo" cells={selected.map((s) => fmtMoney(s.properties.hoaMonthly))} />
              <Row label="→ Salisbury" cells={selected.map((s) => fmtNum(s.properties.commuteSalisburyMin, " min"))} />
              <Row label="→ Charlotte" cells={selected.map((s) => fmtNum(s.properties.commuteCharlotteMin, " min"))} />

              {CATEGORIES.map((key: CategoryKey) => (
                <tr key={key}>
                  <td className="px-4 py-2 text-slate-600">
                    {CATEGORY_LABEL[key]}
                  </td>
                  {selected.map((s) => {
                    const raw =
                      s.property_scores?.[
                        SCORE_COLUMN[key] as keyof NonNullable<
                          typeof s.property_scores
                        >
                      ];
                    const v = raw == null ? null : Number(raw);
                    return (
                      <td key={s.properties.id} className="px-4 py-2">
                        <span className={`badge ${ratingClass(v)}`}>
                          {fmtRating(v)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, cells }: { label: string; cells: React.ReactNode[] }) {
  return (
    <tr>
      <td className="px-4 py-2 text-slate-600">{label}</td>
      {cells.map((c, i) => (
        <td key={i} className="px-4 py-2">
          {c}
        </td>
      ))}
    </tr>
  );
}
