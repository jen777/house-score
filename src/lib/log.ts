// Tiny structured server-side logger. The geocoding, drive-time, and RentCast
// paths are best-effort (a failure returns null instead of throwing), which
// makes them hard to debug from the outside: drive times simply don't appear
// and nothing explains why. These helpers make every failure visible in the
// server logs with a consistent `[scope]` prefix and `key=value` context, so
// you can tell a missing API key from REQUEST_DENIED (API not enabled on the
// key) from a per-destination ZERO_RESULTS.
//
// Server-only by convention — keep it out of client components.

type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

function render(v: unknown): string {
  if (v == null) return String(v);
  if (v instanceof Error) return v.message;
  if (typeof v === "string") return /\s/.test(v) ? JSON.stringify(v) : v;
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function emit(level: Level, scope: string, msg: string, fields?: Fields): void {
  const ctx = fields
    ? Object.entries(fields)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${render(v)}`)
        .join(" ")
    : "";
  const line = `[${scope}] ${msg}${ctx ? " " + ctx : ""}`;
  const fn =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;
  fn(line);
}

export function logInfo(scope: string, msg: string, fields?: Fields): void {
  emit("info", scope, msg, fields);
}

export function logWarn(scope: string, msg: string, fields?: Fields): void {
  emit("warn", scope, msg, fields);
}

export function logError(scope: string, msg: string, fields?: Fields): void {
  emit("error", scope, msg, fields);
}
