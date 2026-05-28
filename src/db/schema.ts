import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  smallint,
  boolean,
  timestamp,
  jsonb,
  doublePrecision,
} from "drizzle-orm/pg-core";

// Single-user Phase 1: no owner_id / RLS yet (see docs/DATA_MODEL.md for the
// multi-user-ready design we'll grow into). Columns mirror the owner's
// house_comparison_scoring_tracker.xlsx.

export const properties = pgTable("properties", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: text("status").default("New"), // see STATUSES in lib/ui
  address: text("address").notNull(),
  communityHoa: text("community_hoa"),
  cityArea: text("city_area"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  listingUrl: text("listing_url"),
  source: text("source"), // Redfin|Zillow|Realtor.com|MLS/Agent|Other
  mlsNumber: text("mls_number"),
  price: numeric("price"),
  beds: numeric("beds"),
  baths: numeric("baths"),
  sqft: integer("sqft"),
  lotAcres: numeric("lot_acres"),
  yearBuilt: integer("year_built"),
  hoaMonthly: numeric("hoa_monthly"),
  taxesAnnual: numeric("taxes_annual"),
  estMonthlyPayment: numeric("est_monthly_payment"),
  daysOnMarket: integer("days_on_market"),
  schoolRating: numeric("school_rating"),
  commuteSalisburyMin: integer("commute_salisbury_min"),
  commuteCharlotteMin: integer("commute_charlotte_min"),
  accessNotes: text("access_notes"),
  amenitiesNotes: text("amenities_notes"),
  risksRedFlags: text("risks_red_flags"),
  mustHaveIssue: text("must_have_issue").default("No"), // Yes|No|Maybe
  propertyType: text("property_type"),
  listingDescription: text("listing_description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const propertyScores = pgTable("property_scores", {
  propertyId: uuid("property_id").primaryKey(),
  // The seven 1–5 category ratings.
  locationWalkability: smallint("location_walkability"),
  communityKids: smallint("community_kids"),
  layoutFamilyFit: smallint("layout_family_fit"),
  schoolsChildcare: smallint("schools_childcare"),
  commuteAccess: smallint("commute_access"),
  financialFit: smallint("financial_fit"),
  conditionRiskResale: smallint("condition_risk_resale"),
  // Derived.
  weightedScore: numeric("weighted_score"),
  recommendation: text("recommendation"),
  computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow(),
});

export const scoreNotes = pgTable("score_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull(),
  category: text("category").notNull(), // one of the 7 category keys
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const hoaDetails = pgTable("hoa_details", {
  propertyId: uuid("property_id").primaryKey(),
  hoaExists: boolean("hoa_exists"),
  hoaName: text("hoa_name"),
  feeAmount: numeric("fee_amount"),
  feeFrequency: text("fee_frequency"), // monthly|quarterly|annual|one_time|unknown
  amenities: jsonb("amenities"),
  restrictions: jsonb("restrictions"),
  managementCompany: text("management_company"),
  website: text("website"),
  declarationUrl: text("declaration_url"),
  sourceUrl: text("source_url"),
  confidenceLevel: text("confidence_level").default("unknown"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const propertyFeatures = pgTable("property_features", {
  propertyId: uuid("property_id").primaryKey(),
  familyFriendly: jsonb("family_friendly"),
  walkingFeatures: jsonb("walking_features"),
  workFromHome: jsonb("work_from_home"),
  renovationRisk: jsonb("renovation_risk"),
  communityAmenities: jsonb("community_amenities"),
  concerns: jsonb("concerns"),
  emotionalFitSummary: text("emotional_fit_summary"),
  extraction: jsonb("extraction"),
  model: text("model"),
  extractedAt: timestamp("extracted_at", { withTimezone: true }).defaultNow(),
});

export const propertyNotes = pgTable("property_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull(),
  note: text("note").notNull(),
  category: text("category").default("general"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const scoringConfig = pgTable("scoring_config", {
  id: integer("id").primaryKey().default(1),
  weights: jsonb("weights"),
  inputs: jsonb("inputs"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type Property = typeof properties.$inferSelect;
export type NewProperty = typeof properties.$inferInsert;
export type PropertyScores = typeof propertyScores.$inferSelect;
export type PropertyFeatures = typeof propertyFeatures.$inferSelect;
export type HoaDetails = typeof hoaDetails.$inferSelect;
export type PropertyNote = typeof propertyNotes.$inferSelect;
export type ScoreNote = typeof scoreNotes.$inferSelect;
export type ScoringConfig = typeof scoringConfig.$inferSelect;
