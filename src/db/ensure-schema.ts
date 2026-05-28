import { sql, db } from "./index";
import { scoringWeights } from "./schema";
import { SCHEMA_DDL } from "./ddl";
import { DEFAULT_WEIGHTS } from "@/lib/scoring";

let ran = false;

/**
 * Idempotently create the schema and seed default scoring weights.
 * Invoked once at server startup from src/instrumentation.ts.
 */
export async function ensureSchema(): Promise<void> {
  if (ran) return;
  ran = true;

  try {
    // postgres-js: .unsafe() runs the multi-statement DDL as-is.
    await sql.unsafe(SCHEMA_DDL);

    // Seed the single weights row if absent (Drizzle handles jsonb serialization).
    await db
      .insert(scoringWeights)
      .values({ id: 1, weights: DEFAULT_WEIGHTS })
      .onConflictDoNothing();

    console.log("[db] schema ensured");
  } catch (err) {
    ran = false; // allow a retry on next startup
    console.error("[db] ensureSchema failed:", err);
    throw err;
  }
}
