import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  doublePrecision,
} from "drizzle-orm/pg-core";

// Single-user Phase 1: no owner_id / RLS yet (see docs/DATA_MODEL.md for the
// multi-user-ready design we'll grow into).

export const properties = pgTable("properties", {
  id: uuid("id").primaryKey().defaultRandom(),
  address: text("address").notNull(),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  listingUrl: text("listing_url"),
  source: text("source").default("manual"), // redfin|zillow|realtor|manual|other
  mlsNumber: text("mls_number"),
  status: text("status").default("new"), // new|maybe|visit|favorite|rejected|offer_candidate
  price: numeric("price"),
  beds: numeric("beds"),
  baths: numeric("baths"),
  sqft: integer("sqft"),
  lotSize: numeric("lot_size"),
  yearBuilt: integer("year_built"),
  hoaFee: numeric("hoa_fee"),
  propertyType: text("property_type"),
  listingDescription: text("listing_description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const propertyScores = pgTable("property_scores", {
  propertyId: uuid("property_id").primaryKey(),
  priceScore: numeric("price_score"),
  monthlyCostScore: numeric("monthly_cost_score"),
  commuteScore: numeric("commute_score"),
  schoolScore: numeric("school_score"),
  walkabilityScore: numeric("walkability_score"),
  toddlerFriendlyScore: numeric("toddler_friendly_score"),
  communityScore: numeric("community_score"),
  hoaScore: numeric("hoa_score"),
  conditionScore: numeric("condition_score"),
  resaleScore: numeric("resale_score"),
  emotionalFitScore: numeric("emotional_fit_score"),
  totalWeightedScore: numeric("total_weighted_score"),
  computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow(),
});

export const scoreOverrides = pgTable("score_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull(),
  scoreName: text("score_name").notNull(),
  value: numeric("value"),
  reason: text("reason"),
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

export const scoringWeights = pgTable("scoring_weights", {
  id: integer("id").primaryKey().default(1),
  weights: jsonb("weights"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type Property = typeof properties.$inferSelect;
export type NewProperty = typeof properties.$inferInsert;
export type PropertyScores = typeof propertyScores.$inferSelect;
export type PropertyFeatures = typeof propertyFeatures.$inferSelect;
export type HoaDetails = typeof hoaDetails.$inferSelect;
export type PropertyNote = typeof propertyNotes.$inferSelect;
