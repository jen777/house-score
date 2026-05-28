import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { properties, propertyScores } from "@/db/schema";
import {
  OBJECTIVE_SCORES,
  PERSONAL_SCORES,
  type ScoreName,
} from "@/lib/scoring";
import { scoreClass, fmtMoney, fmtNum, fmtScore } from "@/lib/ui";

export const dynamic = "force-dynamic";

const SCORE_LABEL: Record<ScoreName, string> = {
  price: "Price fit",
  monthly_cost: "Monthly cost",
  commute: "Commute",
  school: "Schools",
  condition: "Condition",
  resale: "Resale",
  hoa: "HOA",
  walkability: "Walkability",
  toddler_friendly: "Toddler-friendly",
  community: "Community",
  emotional_fit: "Emotional fit",
};

const COL: Record<ScoreName, keyof typeof propertyScores.$inferSelect> = {
  price: "priceScore",
  monthly_cost: "monthlyCostScore",
  commute: "commuteScore",
  school: "schoolScore",
  condition: "conditionScore",
  resale: "resaleScore",
  hoa: "hoaScore",
  walkability: "walkabilityScore",
  toddler_friendly: "toddlerFriendlyScore",
  community: "communityScore",
  emotional_fit: "emotionalFitScore",
};

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
    .select({
      id: properties.id,
      address: properties.address,
      total: propertyScores.totalWeightedScore,
    })
    .from(properties)
    .leftJoin(propertyScores, eq(properties.id, propertyScores.propertyId));

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
                <td className="px-4 py-2">Total score</td>
                {selected.map((s) => {
                  const v =
                    s.property_scores?.totalWeightedScore == null
                      ? null
                      : Number(s.property_scores.totalWeightedScore);
                  return (
                    <td key={s.properties.id} className="px-4 py-2">
                      <span className={`badge ${scoreClass(v)}`}>
                        {fmtScore(v)}
                      </span>
                    </td>
                  );
                })}
              </tr>
              <Row label="Price" cells={selected.map((s) => fmtMoney(s.properties.price))} />
              <Row label="Beds / Baths" cells={selected.map((s) => `${fmtNum(s.properties.beds)} / ${fmtNum(s.properties.baths)}`)} />
              <Row label="Sq ft" cells={selected.map((s) => fmtNum(s.properties.sqft))} />
              <Row label="Year built" cells={selected.map((s) => fmtNum(s.properties.yearBuilt))} />
              <Row label="HOA/mo" cells={selected.map((s) => fmtMoney(s.properties.hoaFee))} />

              {[...OBJECTIVE_SCORES, ...PERSONAL_SCORES].map((name) => (
                <tr key={name}>
                  <td className="px-4 py-2 text-slate-600">
                    {SCORE_LABEL[name]}
                  </td>
                  {selected.map((s) => {
                    const raw = s.property_scores?.[COL[name]];
                    const v = raw == null ? null : Number(raw);
                    return (
                      <td key={s.properties.id} className="px-4 py-2">
                        <span className={`badge ${scoreClass(v)}`}>
                          {fmtScore(v)}
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
