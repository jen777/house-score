// Status values match the tracker's Dropdowns sheet (see docs/DATA_MODEL.md).
export const STATUSES = [
  "New",
  "Watching",
  "Tour scheduled",
  "Offer candidate",
  "Rejected",
  "Under contract",
  "Sold",
] as const;

export const STATUS_LABEL: Record<string, string> = {
  New: "New",
  Watching: "Watching",
  "Tour scheduled": "Tour scheduled",
  "Offer candidate": "Offer candidate",
  Rejected: "Rejected",
  "Under contract": "Under contract",
  Sold: "Sold",
};

export const STATUS_CLASS: Record<string, string> = {
  New: "bg-slate-100 text-slate-700",
  Watching: "bg-amber-100 text-amber-800",
  "Tour scheduled": "bg-blue-100 text-blue-800",
  "Offer candidate": "bg-green-100 text-green-800",
  Rejected: "bg-red-100 text-red-700",
  "Under contract": "bg-purple-100 text-purple-800",
  Sold: "bg-slate-200 text-slate-600",
};

export const SOURCES = [
  "Redfin",
  "Zillow",
  "Realtor.com",
  "MLS/Agent",
  "Other",
] as const;

// Weighted Score (0–100) badge color, banded to the recommendation cutoffs.
export function scoreClass(score: number | null | undefined): string {
  if (score == null) return "bg-slate-100 text-slate-400";
  if (score >= 85) return "bg-green-100 text-green-800";
  if (score >= 75) return "bg-lime-100 text-lime-800";
  if (score >= 65) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-700";
}

// Recommendation badge color.
export function recClass(rec: string | null | undefined): string {
  switch (rec) {
    case "Strong candidate":
      return "bg-green-100 text-green-800";
    case "Good option":
      return "bg-lime-100 text-lime-800";
    case "Maybe":
      return "bg-amber-100 text-amber-800";
    case "Pass":
      return "bg-red-100 text-red-700";
    case "Pass / must-have issue":
      return "bg-red-200 text-red-800";
    default:
      return "bg-slate-100 text-slate-400"; // Needs data
  }
}

// Per-category 1–5 rating badge color.
export function ratingClass(r: number | null | undefined): string {
  if (r == null) return "bg-slate-100 text-slate-400";
  if (r >= 5) return "bg-green-100 text-green-800";
  if (r >= 4) return "bg-lime-100 text-lime-800";
  if (r >= 3) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-700";
}

export function fmtMoney(v: unknown): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function fmtNum(v: unknown, suffix = ""): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return `${n.toLocaleString("en-US")}${suffix}`;
}

export function fmtScore(v: unknown): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return String(Math.round(n * 10) / 10);
}

export function fmtRating(v: unknown): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return `${n}/5`;
}
