import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // Surface misconfiguration early rather than failing on first query.
  // (At build time DATABASE_URL may be absent; queries only run at runtime.)
  console.warn("[db] DATABASE_URL is not set");
}

// Reuse the client across hot reloads in dev to avoid exhausting connections.
const globalForDb = globalThis as unknown as {
  __pg?: ReturnType<typeof postgres>;
};

export const sql =
  globalForDb.__pg ??
  postgres(connectionString ?? "postgres://localhost:5432/postgres", {
    max: 10,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__pg = sql;

export const db = drizzle(sql, { schema });
