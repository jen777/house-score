export const STATUSES = [
  "new",
  "maybe",
  "visit",
  "favorite",
  "rejected",
  "offer_candidate",
] as const;

export const STATUS_LABEL: Record<string, string> = {
  new: "New",
  maybe: "Maybe",
  visit: "Visit",
  favorite: "Favorite",
  rejected: "Rejected",
  offer_candidate: "Offer candidate",
};

export const STATUS_CLASS: Record<string, string> = {
  new: "bg-slate-100 text-slate-700",
  maybe: "bg-amber-100 text-amber-800",
  visit: "bg-blue-100 text-blue-800",
  favorite: "bg-pink-100 text-pink-800",
  rejected: "bg-red-100 text-red-700",
  offer_candidate: "bg-green-100 text-green-800",
};

export function scoreClass(score: number | null | undefined): string {
  if (score == null) return "bg-slate-100 text-slate-400";
  if (score >= 80) return "bg-green-100 text-green-800";
  if (score >= 60) return "bg-lime-100 text-lime-800";
  if (score >= 40) return "bg-amber-100 text-amber-800";
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
