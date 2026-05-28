import Link from "next/link";
import { createPropertyAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function NewPropertyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center gap-2 text-sm text-slate-500">
        <Link href="/" className="hover:text-brand">
          Houses
        </Link>
        <span>/</span>
        <span>Add house</span>
      </div>

      <h1 className="mb-4 text-2xl font-semibold">Add a house</h1>

      {error === "address" ? (
        <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          Address is required.
        </p>
      ) : null}

      <form action={createPropertyAction} className="space-y-5">
        <div className="card space-y-4">
          <div>
            <label className="label" htmlFor="address">
              Address *
            </label>
            <input id="address" name="address" className="input" required />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">City</label>
              <input name="city" className="input" />
            </div>
            <div>
              <label className="label">State</label>
              <input name="state" className="input" defaultValue="NC" />
            </div>
            <div>
              <label className="label">ZIP</label>
              <input name="zip" className="input" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Listing URL (reference only)</label>
              <input
                name="listingUrl"
                className="input"
                placeholder="https://www.redfin.com/..."
              />
            </div>
            <div>
              <label className="label">Source</label>
              <select name="source" className="input" defaultValue="redfin">
                <option value="redfin">Redfin</option>
                <option value="zillow">Zillow</option>
                <option value="realtor">Realtor.com</option>
                <option value="manual">Manual</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
        </div>

        <div className="card grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label className="label">Price ($)</label>
            <input name="price" type="number" className="input" />
          </div>
          <div>
            <label className="label">Beds</label>
            <input name="beds" type="number" step="0.5" className="input" />
          </div>
          <div>
            <label className="label">Baths</label>
            <input name="baths" type="number" step="0.5" className="input" />
          </div>
          <div>
            <label className="label">Sq ft</label>
            <input name="sqft" type="number" className="input" />
          </div>
          <div>
            <label className="label">Lot size</label>
            <input name="lotSize" className="input" placeholder="0.25 ac" />
          </div>
          <div>
            <label className="label">Year built</label>
            <input name="yearBuilt" type="number" className="input" />
          </div>
          <div>
            <label className="label">HOA fee ($/mo)</label>
            <input name="hoaFee" type="number" className="input" />
          </div>
          <div>
            <label className="label">Property type</label>
            <select
              name="propertyType"
              className="input"
              defaultValue="single_family"
            >
              <option value="single_family">Single family</option>
              <option value="townhome">Townhome</option>
              <option value="condo">Condo</option>
            </select>
          </div>
        </div>

        <div className="card">
          <label className="label" htmlFor="listingDescription">
            Listing description (paste the remarks — fed to AI extraction)
          </label>
          <textarea
            id="listingDescription"
            name="listingDescription"
            className="input min-h-32"
            placeholder="Paste the full listing description here..."
          />
          <p className="mt-1 text-xs text-slate-400">
            After saving, run AI extraction on the house page to auto-fill
            features and concerns.
          </p>
        </div>

        <div className="flex gap-2">
          <button type="submit" className="btn">
            Save house
          </button>
          <Link href="/" className="btn-ghost">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
