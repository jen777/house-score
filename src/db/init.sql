-- Idempotent schema for HouseScore Phase 1 (single-user).
-- Executed once at server startup via src/instrumentation.ts (mirrored in
-- src/db/ddl.ts; keep them in sync). Also usable as a Postgres
-- docker-entrypoint-initdb.d script.
--
-- The model matches docs/SCORING.md & docs/DATA_MODEL.md (the owner's
-- house_comparison_scoring_tracker.xlsx): 7 categories rated 1–5. The ALTER
-- statements migrate an existing dev DB created by an earlier draft.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS properties (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status                text DEFAULT 'New',
  address               text NOT NULL,
  community_hoa         text,
  city_area             text,
  city                  text,
  state                 text,
  zip                   text,
  latitude              double precision,
  longitude             double precision,
  listing_url           text,
  source                text,
  mls_number            text,
  price                 numeric,
  beds                  numeric,
  baths                 numeric,
  sqft                  integer,
  lot_acres             numeric,
  year_built            integer,
  hoa_monthly           numeric,
  taxes_annual          numeric,
  est_monthly_payment   numeric,
  days_on_market        integer,
  school_rating         numeric,
  school_elementary     numeric,
  school_middle         numeric,
  school_high           numeric,
  commute_salisbury_min integer,
  commute_charlotte_min integer,
  access_notes          text,
  amenities_notes       text,
  risks_red_flags       text,
  must_have_issue       text DEFAULT 'No',
  property_type         text,
  listing_description   text,
  archived_at           timestamptz,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- Migrate dev DBs created by the earlier 11-dimension draft.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS community_hoa         text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS city_area             text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS lot_acres             numeric;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS hoa_monthly           numeric;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS taxes_annual          numeric;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS est_monthly_payment   numeric;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS days_on_market        integer;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS school_rating         numeric;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS commute_salisbury_min integer;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS commute_charlotte_min integer;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS access_notes          text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS amenities_notes       text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS risks_red_flags       text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS must_have_issue       text DEFAULT 'No';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS archived_at           timestamptz;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS school_elementary     numeric;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS school_middle         numeric;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS school_high           numeric;

CREATE TABLE IF NOT EXISTS property_scores (
  property_id           uuid PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  location_walkability  smallint,
  community_kids        smallint,
  layout_family_fit     smallint,
  schools_childcare     smallint,
  commute_access        smallint,
  financial_fit         smallint,
  condition_risk_resale smallint,
  weighted_score        numeric,
  recommendation        text,
  computed_at           timestamptz DEFAULT now()
);

ALTER TABLE property_scores ADD COLUMN IF NOT EXISTS location_walkability  smallint;
ALTER TABLE property_scores ADD COLUMN IF NOT EXISTS community_kids        smallint;
ALTER TABLE property_scores ADD COLUMN IF NOT EXISTS layout_family_fit     smallint;
ALTER TABLE property_scores ADD COLUMN IF NOT EXISTS schools_childcare     smallint;
ALTER TABLE property_scores ADD COLUMN IF NOT EXISTS commute_access        smallint;
ALTER TABLE property_scores ADD COLUMN IF NOT EXISTS financial_fit         smallint;
ALTER TABLE property_scores ADD COLUMN IF NOT EXISTS condition_risk_resale smallint;
ALTER TABLE property_scores ADD COLUMN IF NOT EXISTS weighted_score        numeric;
ALTER TABLE property_scores ADD COLUMN IF NOT EXISTS recommendation        text;

CREATE TABLE IF NOT EXISTS score_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  category    text NOT NULL,
  note        text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (property_id, category)
);

CREATE TABLE IF NOT EXISTS hoa_details (
  property_id         uuid PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  hoa_exists          boolean,
  hoa_name            text,
  fee_amount          numeric,
  fee_frequency       text,
  amenities           jsonb,
  restrictions        jsonb,
  management_company  text,
  management_contact  text,
  website             text,
  special_assessments text,
  pet_policy          text,
  rental_policy       text,
  declaration_url     text,
  rating              numeric,
  review_count        integer,
  pros                jsonb,
  cons                jsonb,
  verdict             text,
  open_questions      jsonb,
  sources             jsonb,
  source_url          text,
  confidence_level    text DEFAULT 'unknown',
  model               text,
  researched_at       timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);
ALTER TABLE hoa_details ADD COLUMN IF NOT EXISTS management_contact  text;
ALTER TABLE hoa_details ADD COLUMN IF NOT EXISTS special_assessments text;
ALTER TABLE hoa_details ADD COLUMN IF NOT EXISTS pet_policy          text;
ALTER TABLE hoa_details ADD COLUMN IF NOT EXISTS rental_policy       text;
ALTER TABLE hoa_details ADD COLUMN IF NOT EXISTS rating              numeric;
ALTER TABLE hoa_details ADD COLUMN IF NOT EXISTS review_count        integer;
ALTER TABLE hoa_details ADD COLUMN IF NOT EXISTS pros                jsonb;
ALTER TABLE hoa_details ADD COLUMN IF NOT EXISTS cons                jsonb;
ALTER TABLE hoa_details ADD COLUMN IF NOT EXISTS verdict             text;
ALTER TABLE hoa_details ADD COLUMN IF NOT EXISTS open_questions      jsonb;
ALTER TABLE hoa_details ADD COLUMN IF NOT EXISTS sources             jsonb;
ALTER TABLE hoa_details ADD COLUMN IF NOT EXISTS model               text;
ALTER TABLE hoa_details ADD COLUMN IF NOT EXISTS researched_at       timestamptz;

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

CREATE TABLE IF NOT EXISTS scoring_config (
  id         integer PRIMARY KEY DEFAULT 1,
  weights    jsonb,
  inputs     jsonb,
  updated_at timestamptz DEFAULT now()
);

-- Drive-time feature: saved destinations + cached driving times per property.
CREATE TABLE IF NOT EXISTS places (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  category   text DEFAULT 'other',
  address    text NOT NULL,
  latitude   double precision,
  longitude  double precision,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS property_drive_times (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  place_id     uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  duration_min integer,
  distance_mi  double precision,
  computed_at  timestamptz DEFAULT now(),
  UNIQUE (property_id, place_id)
);

-- Phase 2: per-field provenance (source + confidence) for enriched fields.
CREATE TABLE IF NOT EXISTS property_field_provenance (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  field_name  text NOT NULL,
  source      text NOT NULL,
  confidence  text DEFAULT 'unknown',
  captured_at timestamptz DEFAULT now(),
  UNIQUE (property_id, field_name)
);

-- Phase 2: cached property-data API response (valuation, rent, comps + raw).
CREATE TABLE IF NOT EXISTS property_enrichment (
  property_id     uuid PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  source          text DEFAULT 'rentcast',
  value_estimate  numeric,
  value_low       numeric,
  value_high      numeric,
  rent_estimate   numeric,
  rent_low        numeric,
  rent_high       numeric,
  last_sale_price numeric,
  last_sale_date  text,
  comparables     jsonb,
  raw             jsonb,
  fetched_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_archived_at ON properties(archived_at);
CREATE INDEX IF NOT EXISTS idx_notes_property ON property_notes(property_id);
CREATE INDEX IF NOT EXISTS idx_provenance_property ON property_field_provenance(property_id);
CREATE INDEX IF NOT EXISTS idx_drive_times_property ON property_drive_times(property_id);
