import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import {
  properties,
  propertyScores,
  propertyFeatures,
  propertyNotes,
  scoreNotes,
} from "@/db/schema";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  type CategoryKey,
} from "@/lib/scoring";
import { SCORE_COLUMN } from "@/lib/recompute";
import {
  STATUSES,
  STATUS_LABEL,
  STATUS_CLASS,
  scoreClass,
  recClass,
  ratingClass,
  fmtMoney,
  fmtNum,
  fmtScore,
  fmtRating,
} from "@/lib/ui";
import {
  updatePropertyAction,
  deletePropertyAction,
  updateStatusAction,
  extractAction,
  saveScoresAction,
  addNoteAction,
} from "../../actions";

export const dynamic = "force-dynamic";

function list(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const [prop] = await db
    .select()
    .from(properties)
    .where(eq(properties.id, id));
  if (!prop) notFound();

  const [scores] = await db
    .select()
    .from(propertyScores)
    .where(eq(propertyScores.propertyId, id));
  const [features] = await db
    .select()
    .from(propertyFeatures)
    .where(eq(propertyFeatures.propertyId, id));
  const catNotes = await db
    .select()
    .from(scoreNotes)
    .where(eq(scoreNotes.propertyId, id));
  const notes = await db
    .select()
    .from(propertyNotes)
    .where(eq(propertyNotes.propertyId, id))
    .orderBy(desc(propertyNotes.createdAt));

  const noteMap = new Map(catNotes.map((n) => [n.category, n.note ?? ""]));
  const ratingOf = (key: CategoryKey): number | null => {
    const raw = scores?.[SCORE_COLUMN[key] as keyof typeof scores];
    return raw == null ? null : Number(raw);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/" className="hover:text-brand">
          Houses
        </Link>
        <span>/</span>
        <span className="truncate">{prop.address}</span>
      </div>

      {error ? (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {decodeURIComponent(error)}
        </p>
      ) : null}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{prop.address}</h1>
          <p className="text-slate-500">
            {[prop.communityHoa, prop.cityArea, prop.city, prop.state, prop.zip]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {prop.listingUrl ? (
            <a
              href={prop.listingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-brand hover:underline"
            >
              View listing{prop.source ? ` (${prop.source})` : ""} ↗
            </a>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`badge ${scoreClass(
              scores?.weightedScore == null
                ? null
                : Number(scores.weightedScore),
            )} text-base`}
          >
            Score: {fmtScore(scores?.weightedScore)}
          </span>
          <span className={`badge ${recClass(scores?.recommendation)}`}>
            {scores?.recommendation ?? "Needs data"}
          </span>
          <form action={updateStatusAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={prop.id} />
            <select
              name="status"
              defaultValue={prop.status ?? "New"}
              className="input py-1"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <button className="btn-ghost py-1">Set</button>
          </form>
        </div>
      </div>

      {/* Category ratings */}
      <section className="card">
        <h2 className="mb-1 text-lg font-semibold">Category ratings</h2>
        <p className="mb-3 text-xs text-slate-400">
          Rate each category 1–5 (1 = poor, 5 = excellent). The Weighted Score
          (0–100) and Recommendation update on save. A “must-have issue” forces a
          Pass. See the rubric in docs/SCORING.md.
        </p>
        <form action={saveScoresAction} className="space-y-2">
          <input type="hidden" name="id" value={prop.id} />
          {CATEGORIES.map((key) => {
            const r = ratingOf(key);
            return (
              <div
                key={key}
                className="flex flex-wrap items-center gap-2 rounded border border-slate-100 px-3 py-2"
              >
                <span className="w-52 text-sm">{CATEGORY_LABEL[key]}</span>
                <span className={`badge ${ratingClass(r)}`}>
                  {fmtRating(r)}
                </span>
                <select
                  name={key}
                  defaultValue={r ?? ""}
                  className="input w-24 py-1"
                >
                  <option value="">—</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <input
                  name={`note_${key}`}
                  defaultValue={noteMap.get(key) ?? ""}
                  placeholder="why (optional)"
                  className="input grow py-1"
                />
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <label className="text-sm font-medium">Must-have issue?</label>
            <select
              name="mustHaveIssue"
              defaultValue={prop.mustHaveIssue ?? "No"}
              className="input w-40 py-1"
            >
              <option value="No">No</option>
              <option value="Maybe">Maybe</option>
              <option value="Yes">Yes (forces Pass)</option>
            </select>
            <button className="btn">Save ratings</button>
          </div>
        </form>
      </section>

      {/* AI extraction */}
      <section className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">AI extraction</h2>
          <form action={extractAction}>
            <input type="hidden" name="id" value={prop.id} />
            <button className="btn" disabled={!prop.listingDescription}>
              {features ? "Re-extract" : "Extract from description"}
            </button>
          </form>
        </div>
        {!prop.listingDescription ? (
          <p className="text-sm text-slate-400">
            Add a listing description (edit below) to enable extraction.
          </p>
        ) : !features ? (
          <p className="text-sm text-slate-400">
            Not extracted yet. Click “Extract from description”.
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            {features.emotionalFitSummary ? (
              <p className="rounded bg-slate-50 px-3 py-2 italic text-slate-700">
                {features.emotionalFitSummary}
              </p>
            ) : null}
            <FeatureList title="Family-friendly" items={list(features.familyFriendly)} />
            <FeatureList title="Walking" items={list(features.walkingFeatures)} />
            <FeatureList title="Work from home" items={list(features.workFromHome)} />
            <FeatureList title="Community amenities" items={list(features.communityAmenities)} />
            <FeatureList title="Renovation risk" items={list(features.renovationRisk)} tone="warn" />
            <FeatureList title="Concerns" items={list(features.concerns)} tone="warn" />
            <p className="text-xs text-slate-400">
              Extracted by {features.model}. Ratings remain your call — use these
              signals to inform the 1–5 scores above.
            </p>
          </div>
        )}
      </section>

      {/* Details / edit */}
      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">Details</h2>
        <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <Fact label="Price" value={fmtMoney(prop.price)} />
          <Fact label="Est. monthly" value={fmtMoney(prop.estMonthlyPayment)} />
          <Fact label="Beds" value={fmtNum(prop.beds)} />
          <Fact label="Baths" value={fmtNum(prop.baths)} />
          <Fact label="Sq ft" value={fmtNum(prop.sqft)} />
          <Fact label="Lot (ac)" value={fmtNum(prop.lotAcres)} />
          <Fact label="Year built" value={fmtNum(prop.yearBuilt)} />
          <Fact label="HOA/mo" value={fmtMoney(prop.hoaMonthly)} />
          <Fact label="Taxes/yr" value={fmtMoney(prop.taxesAnnual)} />
          <Fact label="Days on market" value={fmtNum(prop.daysOnMarket)} />
          <Fact label="School rating" value={fmtNum(prop.schoolRating)} />
          <Fact label="Type" value={prop.propertyType ?? "—"} />
          <Fact label="→ Salisbury" value={fmtNum(prop.commuteSalisburyMin, " min")} />
          <Fact label="→ Charlotte" value={fmtNum(prop.commuteCharlotteMin, " min")} />
        </dl>
        {prop.accessNotes || prop.amenitiesNotes || prop.risksRedFlags ? (
          <div className="mb-4 space-y-1 text-sm">
            {prop.accessNotes ? (
              <p><span className="text-slate-400">Access:</span> {prop.accessNotes}</p>
            ) : null}
            {prop.amenitiesNotes ? (
              <p><span className="text-slate-400">Amenities:</span> {prop.amenitiesNotes}</p>
            ) : null}
            {prop.risksRedFlags ? (
              <p className="text-amber-800"><span className="text-slate-400">Risks:</span> {prop.risksRedFlags}</p>
            ) : null}
          </div>
        ) : null}

        <details className="rounded border border-slate-200">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            Edit details
          </summary>
          <form
            action={updatePropertyAction}
            className="space-y-3 border-t border-slate-100 p-3"
          >
            <input type="hidden" name="id" value={prop.id} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field name="address" label="Address" defaultValue={prop.address} />
              <Field name="communityHoa" label="Community / HOA" defaultValue={prop.communityHoa ?? ""} />
              <Field name="cityArea" label="City / Area" defaultValue={prop.cityArea ?? ""} />
              <Field name="city" label="City" defaultValue={prop.city ?? ""} />
              <Field name="state" label="State" defaultValue={prop.state ?? ""} />
              <Field name="zip" label="ZIP" defaultValue={prop.zip ?? ""} />
              <Field name="price" label="Price" type="number" defaultValue={prop.price ?? ""} />
              <Field name="beds" label="Beds" type="number" defaultValue={prop.beds ?? ""} />
              <Field name="baths" label="Baths" type="number" defaultValue={prop.baths ?? ""} />
              <Field name="sqft" label="Sq ft" type="number" defaultValue={prop.sqft ?? ""} />
              <Field name="lotAcres" label="Lot (acres)" type="number" defaultValue={prop.lotAcres ?? ""} />
              <Field name="yearBuilt" label="Year built" type="number" defaultValue={prop.yearBuilt ?? ""} />
              <Field name="hoaMonthly" label="HOA/mo" type="number" defaultValue={prop.hoaMonthly ?? ""} />
              <Field name="taxesAnnual" label="Taxes/yr" type="number" defaultValue={prop.taxesAnnual ?? ""} />
              <Field name="daysOnMarket" label="Days on market" type="number" defaultValue={prop.daysOnMarket ?? ""} />
              <Field name="schoolRating" label="School rating" type="number" defaultValue={prop.schoolRating ?? ""} />
              <Field name="commuteSalisburyMin" label="→ Salisbury (min)" type="number" defaultValue={prop.commuteSalisburyMin ?? ""} />
              <Field name="commuteCharlotteMin" label="→ Charlotte (min)" type="number" defaultValue={prop.commuteCharlotteMin ?? ""} />
              <Field name="propertyType" label="Type" defaultValue={prop.propertyType ?? ""} />
              <Field name="listingUrl" label="Listing URL" defaultValue={prop.listingUrl ?? ""} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field name="accessNotes" label="Access / transit notes" defaultValue={prop.accessNotes ?? ""} />
              <Field name="amenitiesNotes" label="Amenities notes" defaultValue={prop.amenitiesNotes ?? ""} />
              <Field name="risksRedFlags" label="Risks / red flags" defaultValue={prop.risksRedFlags ?? ""} />
            </div>
            <div>
              <label className="label">Listing description</label>
              <textarea
                name="listingDescription"
                className="input min-h-28"
                defaultValue={prop.listingDescription ?? ""}
              />
            </div>
            {/* Preserve must-have-issue when editing details (set via ratings form). */}
            <input type="hidden" name="mustHaveIssue" value={prop.mustHaveIssue ?? "No"} />
            <input type="hidden" name="source" value={prop.source ?? ""} />
            <input type="hidden" name="mlsNumber" value={prop.mlsNumber ?? ""} />
            <button className="btn">Save details</button>
          </form>
        </details>
      </section>

      {/* Notes */}
      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">Notes</h2>
        <form action={addNoteAction} className="mb-3 flex flex-wrap gap-2">
          <input type="hidden" name="id" value={prop.id} />
          <input
            name="note"
            className="input grow"
            placeholder="Add a note..."
            required
          />
          <select name="category" className="input w-40" defaultValue="general">
            <option value="general">General</option>
            <option value="neighborhood">Neighborhood</option>
            <option value="commute">Commute</option>
            <option value="condition">Condition</option>
            <option value="hoa">HOA</option>
            <option value="financial">Financial</option>
            <option value="visit">Visit</option>
          </select>
          <button className="btn">Add</button>
        </form>
        <ul className="space-y-2 text-sm">
          {notes.length === 0 ? (
            <li className="text-slate-400">No notes yet.</li>
          ) : (
            notes.map((n) => (
              <li key={n.id} className="rounded border border-slate-100 px-3 py-2">
                <span className="badge bg-slate-100 text-slate-600">
                  {n.category}
                </span>{" "}
                {n.note}
              </li>
            ))
          )}
        </ul>
      </section>

      {/* Danger zone */}
      <section className="card border-red-200">
        <form action={deletePropertyAction}>
          <input type="hidden" name="id" value={prop.id} />
          <button className="btn-ghost border-red-300 text-red-600 hover:bg-red-50">
            Delete house
          </button>
        </form>
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
}: {
  name: string;
  label: string;
  defaultValue?: string | number;
  type?: string;
}) {
  return (
    <div>
      <label className="label text-xs">{label}</label>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue as string}
        className="input py-1"
      />
    </div>
  );
}

function FeatureList({
  title,
  items,
  tone = "default",
}: {
  title: string;
  items: string[];
  tone?: "default" | "warn";
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{title}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {items.map((it, i) => (
          <span
            key={i}
            className={`badge ${
              tone === "warn"
                ? "bg-amber-100 text-amber-800"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}
