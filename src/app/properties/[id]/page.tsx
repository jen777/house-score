import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, asc, desc } from "drizzle-orm";
import { db } from "@/db";
import {
  properties,
  propertyScores,
  propertyFeatures,
  propertyNotes,
  propertyEnrichment,
  propertyFieldProvenance,
  propertyDriveTimes,
  places,
  scoreNotes,
} from "@/db/schema";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  type CategoryKey,
} from "@/lib/scoring";
import { SCORE_COLUMN } from "@/lib/recompute";
import { rentcastConfigured } from "@/lib/rentcast";
import { driveTimesConfigured } from "@/lib/drivetime";
import { aiConfigured } from "@/lib/ai";
import {
  STATUSES,
  STATUS_LABEL,
  STATUS_CLASS,
  scoreClass,
  recClass,
  ratingClass,
  confidenceClass,
  SOURCE_LABEL,
  PLACE_CATEGORY_LABEL,
  fmtMoney,
  fmtNum,
  fmtScore,
  fmtRating,
  fmtDrive,
} from "@/lib/ui";
import {
  updatePropertyAction,
  deletePropertyAction,
  archivePropertyAction,
  unarchivePropertyAction,
  updateStatusAction,
  extractAction,
  enrichPropertyAction,
  computeDriveTimesAction,
  saveScoresAction,
  suggestRatingsAction,
  addNoteAction,
} from "../../actions";

export const dynamic = "force-dynamic";

const ERROR_MESSAGE: Record<string, string> = {
  "no-address": "Add an address before enriching this house.",
  "no-coords":
    "This house has no coordinates yet — re-save the address (with a Maps key set) to geocode it, then try again.",
  "no-places":
    "No saved places have coordinates yet. Add destinations on the Places page first.",
  "no-description": "Add a listing description before running AI extraction.",
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
  const catNotes = await db
    .select()
    .from(scoreNotes)
    .where(eq(scoreNotes.propertyId, id));
  const notes = await db
    .select()
    .from(propertyNotes)
    .where(eq(propertyNotes.propertyId, id))
    .orderBy(desc(propertyNotes.createdAt));
  const [enrichment] = await db
    .select()
    .from(propertyEnrichment)
    .where(eq(propertyEnrichment.propertyId, id));
  const provRows = await db
    .select()
    .from(propertyFieldProvenance)
    .where(eq(propertyFieldProvenance.propertyId, id));
  const placeRows = await db.select().from(places).orderBy(asc(places.createdAt));
  const driveRows = await db
    .select()
    .from(propertyDriveTimes)
    .where(eq(propertyDriveTimes.propertyId, id));
  const driveMap = new Map(driveRows.map((d) => [d.placeId, d]));
  const hasCoords = prop.latitude != null && prop.longitude != null;

  const noteMap = new Map(catNotes.map((n) => [n.category, n.note ?? ""]));
  const provMap = new Map(
    provRows.map((p) => [p.fieldName, { source: p.source, confidence: p.confidence }]),
  );
  const enrichComps = Array.isArray(enrichment?.comparables)
    ? (enrichment!.comparables as Array<{
        address: string | null;
        price: number | null;
        sqft: number | null;
        beds: number | null;
        baths: number | null;
        distanceMi: number | null;
        daysOld: number | null;
      }>)
    : [];
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
          {ERROR_MESSAGE[error] ?? decodeURIComponent(error)}
        </p>
      ) : null}

      {prop.archivedAt ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>
            This house is archived
            {prop.archivedAt
              ? ` (${new Date(prop.archivedAt).toLocaleDateString()})`
              : ""}{" "}
            — hidden from the main list, comparison, and map.
          </span>
          <form action={unarchivePropertyAction}>
            <input type="hidden" name="id" value={prop.id} />
            <button className="btn-ghost py-1">Restore to active</button>
          </form>
        </div>
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
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Category ratings</h2>
          <form action={suggestRatingsAction}>
            <input type="hidden" name="id" value={prop.id} />
            <button
              className="btn"
              disabled={!aiConfigured()}
              title={
                aiConfigured()
                  ? "Let AI propose all seven ratings from this house's data"
                  : "Set ANTHROPIC_API_KEY to enable AI rating suggestions"
              }
            >
              Suggest with AI
            </button>
          </form>
        </div>
        <p className="mb-3 text-xs text-slate-400">
          Rate each category 1–5 (1 = poor, 5 = excellent). The Weighted Score
          (0–100) and Recommendation update on save. A “must-have issue” forces a
          Pass. See the rubric in docs/SCORING.md.{" "}
          <span className="text-slate-400">
            “Suggest with AI” fills all seven from the house’s facts, listing
            analysis, RentCast data, and drive times (overwriting current
            ratings/notes) — review and adjust before saving.
          </span>
        </p>
        <form action={saveScoresAction} className="space-y-2">
          <input type="hidden" name="id" value={prop.id} />
          {CATEGORIES.map((key) => {
            const r = ratingOf(key);
            return (
              <div
                key={key}
                className="rounded border border-slate-100 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium sm:w-52">
                    {CATEGORY_LABEL[key]}
                  </span>
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
                </div>
                <textarea
                  name={`note_${key}`}
                  defaultValue={noteMap.get(key) ?? ""}
                  placeholder="why (optional)"
                  rows={3}
                  className="input mt-2 min-h-20 w-full"
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

      {/* Enrichment (RentCast) */}
      <section className="card">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Property data (RentCast)</h2>
          <form action={enrichPropertyAction}>
            <input type="hidden" name="id" value={prop.id} />
            <button className="btn" disabled={!rentcastConfigured()}>
              {enrichment ? "Refresh from RentCast" : "Enrich from RentCast"}
            </button>
          </form>
        </div>
        <p className="mb-3 text-xs text-slate-400">
          Looks up the address via the RentCast API and overwrites record fields
          (beds/baths/sqft/lot/year/type/HOA/taxes) where data is available. List
          price is never overwritten. See docs/DATA_SOURCES.md.
        </p>
        {!rentcastConfigured() ? (
          <p className="text-sm text-slate-400">
            Set <code className="rounded bg-slate-100 px-1">RENTCAST_API_KEY</code>{" "}
            to enable enrichment.
          </p>
        ) : !enrichment ? (
          <p className="text-sm text-slate-400">
            Not enriched yet. Click “Enrich from RentCast”.
          </p>
        ) : (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
              <Fact
                label="Value estimate"
                value={fmtMoney(enrichment.valueEstimate)}
              />
              <Fact
                label="Value range"
                value={
                  enrichment.valueLow || enrichment.valueHigh
                    ? `${fmtMoney(enrichment.valueLow)} – ${fmtMoney(
                        enrichment.valueHigh,
                      )}`
                    : "—"
                }
              />
              <Fact
                label="Rent estimate"
                value={
                  enrichment.rentEstimate
                    ? `${fmtMoney(enrichment.rentEstimate)}/mo`
                    : "—"
                }
              />
              <Fact
                label="Last sale"
                value={
                  enrichment.lastSalePrice
                    ? `${fmtMoney(enrichment.lastSalePrice)}${
                        enrichment.lastSaleDate
                          ? ` · ${enrichment.lastSaleDate.slice(0, 10)}`
                          : ""
                      }`
                    : "—"
                }
              />
            </dl>

            {enrichComps.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium text-slate-500">
                  Comparable sales
                </p>
                <div className="overflow-x-auto rounded border border-slate-100">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-left text-slate-500">
                      <tr>
                        <th className="px-2 py-1 font-medium">Address</th>
                        <th className="px-2 py-1 font-medium">Price</th>
                        <th className="px-2 py-1 font-medium">Sq ft</th>
                        <th className="px-2 py-1 font-medium">Bd/Ba</th>
                        <th className="px-2 py-1 font-medium">Dist</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {enrichComps.map((c, i) => (
                        <tr key={i}>
                          <td className="px-2 py-1">{c.address ?? "—"}</td>
                          <td className="px-2 py-1">{fmtMoney(c.price)}</td>
                          <td className="px-2 py-1">{fmtNum(c.sqft)}</td>
                          <td className="px-2 py-1">
                            {fmtNum(c.beds)}/{fmtNum(c.baths)}
                          </td>
                          <td className="px-2 py-1">
                            {c.distanceMi == null
                              ? "—"
                              : `${c.distanceMi.toFixed(1)} mi`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <p className="text-xs text-slate-400">
              Fetched{" "}
              {enrichment.fetchedAt
                ? new Date(enrichment.fetchedAt).toLocaleString()
                : "—"}{" "}
              from RentCast. Value/rent are AVM estimates, not list prices.
            </p>
          </div>
        )}
      </section>

      {/* Drive times to saved places */}
      <section className="card">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Drive times</h2>
          <form action={computeDriveTimesAction}>
            <input type="hidden" name="id" value={prop.id} />
            <button
              className="btn"
              disabled={
                !driveTimesConfigured() || !hasCoords || placeRows.length === 0
              }
            >
              {driveRows.length ? "Refresh drive times" : "Calculate drive times"}
            </button>
          </form>
        </div>
        <p className="mb-3 text-xs text-slate-400">
          Driving time from this house to each of your{" "}
          <Link href="/places" className="text-brand hover:underline">
            saved places
          </Link>
          .
        </p>
        {!driveTimesConfigured() ? (
          <p className="text-sm text-slate-400">
            Set{" "}
            <code className="rounded bg-slate-100 px-1">GOOGLE_MAPS_API_KEY</code>{" "}
            to enable drive-time lookups.
          </p>
        ) : placeRows.length === 0 ? (
          <p className="text-sm text-slate-400">
            No saved places yet. Add destinations on the{" "}
            <Link href="/places" className="text-brand hover:underline">
              Places
            </Link>{" "}
            page first.
          </p>
        ) : !hasCoords ? (
          <p className="text-sm text-slate-400">
            This house has no coordinates yet, so drive times can’t be computed.
            Re-save the address (with a Maps key set) to geocode it.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-slate-100">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Place</th>
                  <th className="px-3 py-1.5 font-medium">Category</th>
                  <th className="px-3 py-1.5 font-medium">Drive</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {placeRows.map((pl) => {
                  const d = driveMap.get(pl.id);
                  return (
                    <tr key={pl.id}>
                      <td className="px-3 py-1.5">{pl.name}</td>
                      <td className="px-3 py-1.5 text-slate-500">
                        {PLACE_CATEGORY_LABEL[pl.category ?? "other"] ??
                          pl.category}
                      </td>
                      <td className="px-3 py-1.5 font-medium">
                        {fmtDrive(d?.durationMin, d?.distanceMi)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {driveRows.length ? (
          <p className="mt-2 text-xs text-slate-400">
            Driving estimates from Google. A dash means that place isn’t geocoded
            or hasn’t been calculated yet.
          </p>
        ) : null}
      </section>

      {/* Details / edit */}
      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">Details</h2>
        <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <Fact label="Price" value={fmtMoney(prop.price)} />
          <Fact label="Est. monthly" value={fmtMoney(prop.estMonthlyPayment)} />
          <Fact label="Beds" value={fmtNum(prop.beds)} prov={provMap.get("beds")} />
          <Fact label="Baths" value={fmtNum(prop.baths)} prov={provMap.get("baths")} />
          <Fact label="Sq ft" value={fmtNum(prop.sqft)} prov={provMap.get("sqft")} />
          <Fact label="Lot (ac)" value={fmtNum(prop.lotAcres)} prov={provMap.get("lot_acres")} />
          <Fact label="Year built" value={fmtNum(prop.yearBuilt)} prov={provMap.get("year_built")} />
          <Fact label="HOA/mo" value={fmtMoney(prop.hoaMonthly)} prov={provMap.get("hoa_monthly")} />
          <Fact label="Taxes/yr" value={fmtMoney(prop.taxesAnnual)} prov={provMap.get("taxes_annual")} />
          <Fact label="Days on market" value={fmtNum(prop.daysOnMarket)} />
          <Fact
            label="School rating (avg)"
            value={fmtNum(prop.schoolRating, "/10")}
            prov={provMap.get("school_rating")}
          />
          <Fact label="Elementary" value={fmtNum(prop.schoolElementary, "/10")} />
          <Fact label="Middle school" value={fmtNum(prop.schoolMiddle, "/10")} />
          <Fact label="High school" value={fmtNum(prop.schoolHigh, "/10")} />
          <Fact label="Type" value={prop.propertyType ?? "—"} prov={provMap.get("property_type")} />
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
              <Field name="schoolRating" label="School rating (0–10)" type="number" defaultValue={prop.schoolRating ?? ""} />
              <Field name="schoolElementary" label="Elementary (0–10)" type="number" defaultValue={prop.schoolElementary ?? ""} />
              <Field name="schoolMiddle" label="Middle (0–10)" type="number" defaultValue={prop.schoolMiddle ?? ""} />
              <Field name="schoolHigh" label="High (0–10)" type="number" defaultValue={prop.schoolHigh ?? ""} />
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

      {/* Archive + danger zone */}
      <section className="card flex flex-wrap items-center gap-3 border-red-200">
        {prop.archivedAt ? (
          <form action={unarchivePropertyAction}>
            <input type="hidden" name="id" value={prop.id} />
            <button className="btn-ghost">Restore to active list</button>
          </form>
        ) : (
          <form action={archivePropertyAction}>
            <input type="hidden" name="id" value={prop.id} />
            <button
              className="btn-ghost"
              title="Hide from the main list, comparison, and map. Keeps all data; restore anytime."
            >
              Archive house
            </button>
          </form>
        )}
        <span className="grow" />
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

function Fact({
  label,
  value,
  prov,
}: {
  label: string;
  value: React.ReactNode;
  prov?: { source: string; confidence: string | null } | undefined;
}) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="font-medium">{value}</dd>
      {prov ? (
        <span
          className={`badge mt-0.5 text-[10px] ${confidenceClass(prov.confidence)}`}
          title={`Source: ${SOURCE_LABEL[prov.source] ?? prov.source} · confidence: ${prov.confidence ?? "unknown"}`}
        >
          {SOURCE_LABEL[prov.source] ?? prov.source}
        </span>
      ) : null}
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
