import type { Config } from "drizzle-kit";

// Optional: for generating/inspecting migrations with drizzle-kit in the
// future. Phase 1 creates the schema at startup via src/db/ensure-schema.ts.
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
} satisfies Config;
