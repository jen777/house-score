// Source of truth for the Phase 1 schema, embedded as a string so it is
// available at runtime in the Next.js standalone Docker image (where source
// files like init.sql are not copied). src/db/init.sql mirrors this for manual
// psql use; keep them in sync.

export const SCHEMA_DDL = /* sql */ `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS properties (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address             text NOT NULL,
  city                text,
  state               text,
  zip                 text,
  latitude            double precision,
  longitude           double precision,
  listing_url         text,
  source              text DEFAULT 'manual',
  mls_number          text,
  status              text DEFAULT 'new',
  price               numeric,
  beds                numeric,
  baths               numeric,
  sqft                integer,
  lot_size            numeric,
  year_built          integer,
  hoa_fee             numeric,
  property_type       text,
  listing_description text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS property_scores (
  property_id            uuid PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  price_score            numeric,
  monthly_cost_score     numeric,
  commute_score          numeric,
  school_score           numeric,
  walkability_score      numeric,
  toddler_friendly_score numeric,
  community_score        numeric,
  hoa_score              numeric,
  condition_score        numeric,
  resale_score           numeric,
  emotional_fit_score    numeric,
  total_weighted_score   numeric,
  computed_at            timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS score_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  score_name  text NOT NULL,
  value       numeric,
  reason      text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (property_id, score_name)
);

CREATE TABLE IF NOT EXISTS hoa_details (
  property_id        uuid PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  hoa_exists         boolean,
  hoa_name           text,
  fee_amount         numeric,
  fee_frequency      text,
  amenities          jsonb,
  restrictions       jsonb,
  management_company text,
  website            text,
  declaration_url    text,
  source_url         text,
  confidence_level   text DEFAULT 'unknown',
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS property_features (
  property_id           uuid PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  family_friendly       jsonb,
  walking_features      jsonb,
  work_from_home        jsonb,
  renovation_risk       jsonb,
  community_amenities   jsonb,
  concerns              jsonb,
  emotional_fit_summary text,
  extraction            jsonb,
  model                 text,
  extracted_at          timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS property_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  note        text NOT NULL,
  category    text DEFAULT 'general',
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scoring_weights (
  id         integer PRIMARY KEY DEFAULT 1,
  weights    jsonb,
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_notes_property ON property_notes(property_id);
`;
