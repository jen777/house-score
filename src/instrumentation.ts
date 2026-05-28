// Runs once when the Next.js server boots (not per request).
export async function register() {
  // Only run DB setup on the Node.js server runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureSchema } = await import("./db/ensure-schema");
    try {
      await ensureSchema();
    } catch {
      // ensureSchema logs the error; don't crash the whole server on a transient
      // DB hiccup at boot — it will retry on the next start.
    }
  }
}
