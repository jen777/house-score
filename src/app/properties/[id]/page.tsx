import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import {
  properties,
  propertyScores,
  propertyFeatures,
  propertyNotes,
  scoreOverrides,
} from "@/db/schema";
import {
  OBJECTIVE_SCORES,
  PERSONAL_SCORES,
  type ScoreName,
} from "@/lib/scoring";
import {
  STATUSES,
  STATUS_LABEL,
  STATUS_CLASS,
  scoreClass,
  fmtMoney,
  fmtNum,
  fmtScore,
} from "@/lib/ui";
import {
  updatePropertyAction,
  deletePropertyAction,
  updateStatusAction,
  extractAction,
  savePersonalScoresAction,
  setOverrideAction,
  addNoteAction,
} from "../../actions";

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

// drizzle column key for a score name
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
  const overrides = await db
    .select()
    .from(scoreOverrides)
    .where(eq(scoreOverrides.propertyId, id));
  const notes = await db
    .select()
    .from(propertyNotes)
    .where(eq(propertyNotes.propertyId, id))
    .orderBy(desc(propertyNotes.createdAt));

  const overrideMap = new Map(overrides.map((o) => [o.scoreName, o]));

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
            {[prop.city, prop.state, prop.zip].filter(Boolean).join(", ")}
          </p>
          {prop.listingUrl ? (
            <a
              href={prop.listingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-brand hover:underline"
            >
              View listing ({prop.source}) ↗
            </a>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`badge ${scoreClass(
              scores?.totalWeightedScore == null
                ? null
                : Number(scores.totalWeightedScore),
            )} text-base`}
          >
            Score: {fmtScore(scores?.totalWeightedScore)}
          </span>
          <form action={updateStatusAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={prop.id} />
            <select
              name="status"
              defaultValue={prop.status ?? "new"}
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
          <span className={`badge ${STATUS_CLASS[prop.status ?? "new"]}`}>
            {STATUS_LABEL[prop.status ?? "new"]}
          </span>
        </div>
      </div>

      {/* Scores */}
      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">Scores</h2>
        <p className="mb-3 text-xs text-slate-400">
          Objective scores are computed from data. Personal-fit scores are
          entered below (often after a visit). Any score can be overridden.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {[...OBJECTIVE_SCORES, ...PERSONAL_SCORES].map((name) => {
            const raw = scores?.[COL[name]];
            const val = raw == null ? null : Number(raw);
            const ov = overrideMap.get(name);
            return (
              <details key={name} className="rounded border border-slate-200">
                <summary className="flex cursor-pointer items-center justify-between px-3 py-2">
                  <span className="text-sm">{SCORE_LABEL[name]}</span>
                  <span className="flex items-center gap-2">
                    {ov ? (
                      <span className="badge bg-purple-100 text-purple-700">
                        override
                      </span>
                    ) : null}
                    <span className={`badge ${scoreClass(val)}`}>
                      {fmtScore(val)}
                    </span>
                  </span>
                </summary>
                <form
                  action={setOverrideAction}
                  className="flex flex-wrap items-end gap-2 border-t border-slate-100 px-3 py-2"
                >
                  <input type="hidden" name="id" value={prop.id} />
                  <input type="hidden" name="scoreName" value={name} />
                  <div>
                    <label className="label text-xs">Override (0–100)</label>
                    <input
                      name="value"
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={ov?.value ?? ""}
                      className="input w-28 py-1"
                      placeholder="clear"
                    />
                  </div>
                  <div className="grow">
                    <label className="label text-xs">Reason</label>
                    <input
                      name="reason"
                      defaultValue={ov?.reason ?? ""}
                      className="input py-1"
                    />
                  </div>
                  <button className="btn-ghost py-1">Save</button>
                </form>
              </details>
            );
          })}
        </div>
      </section>

      {/* Personal-fit input */}
      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">Personal-fit ratings</h2>
        <form
          action={savePersonalScoresAction}
          className="grid gap-3 sm:grid-cols-4"
        >
          <input type="hidden" name="id" value={prop.id} />
          {PERSONAL_SCORES.map((name) => (
            <div key={name}>
              <label className="label text-xs">{SCORE_LABEL[name]}</label>
              <input
                name={name}
                type="number"
                min={0}
                max={100}
                defaultValue={
                  scores?.[COL[name]] == null ? "" : Number(scores[COL[name]])
                }
                className="input py-1"
              />
            </div>
          ))}
          <div className="sm:col-span-4">
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
              Extracted by {features.model}.
            </p>
          </div>
        )}
      </section>

      {/* Details / edit */}
      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">Details</h2>
        <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <Fact label="Price" value={fmtMoney(prop.price)} />
          <Fact label="Beds" value={fmtNum(prop.beds)} />
          <Fact label="Baths" value={fmtNum(prop.baths)} />
          <Fact label="Sq ft" value={fmtNum(prop.sqft)} />
          <Fact label="Lot" value={prop.lotSize ?? "—"} />
          <Fact label="Year built" value={fmtNum(prop.yearBuilt)} />
          <Fact label="HOA/mo" value={fmtMoney(prop.hoaFee)} />
          <Fact label="Type" value={prop.propertyType ?? "—"} />
        </dl>

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
              <Field name="city" label="City" defaultValue={prop.city ?? ""} />
              <Field name="state" label="State" defaultValue={prop.state ?? ""} />
              <Field name="zip" label="ZIP" defaultValue={prop.zip ?? ""} />
              <Field name="price" label="Price" type="number" defaultValue={prop.price ?? ""} />
              <Field name="beds" label="Beds" type="number" defaultValue={prop.beds ?? ""} />
              <Field name="baths" label="Baths" type="number" defaultValue={prop.baths ?? ""} />
              <Field name="sqft" label="Sq ft" type="number" defaultValue={prop.sqft ?? ""} />
              <Field name="lotSize" label="Lot size" defaultValue={prop.lotSize ?? ""} />
              <Field name="yearBuilt" label="Year built" type="number" defaultValue={prop.yearBuilt ?? ""} />
              <Field name="hoaFee" label="HOA/mo" type="number" defaultValue={prop.hoaFee ?? ""} />
              <Field name="propertyType" label="Type" defaultValue={prop.propertyType ?? ""} />
              <Field name="listingUrl" label="Listing URL" defaultValue={prop.listingUrl ?? ""} />
            </div>
            <div>
              <label className="label">Listing description</label>
              <textarea
                name="listingDescription"
                className="input min-h-28"
                defaultValue={prop.listingDescription ?? ""}
              />
            </div>
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
