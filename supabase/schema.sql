-- FlightLevel Database Schema
-- Run this in the Supabase SQL Editor

-- ── Routes ────────────────────────────────────────────────────────
-- Pre-built route bundles, keyed by corridor hash
CREATE TABLE IF NOT EXISTS routes (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  corridor_hash   TEXT NOT NULL UNIQUE,  -- e.g. 'SEA-DEN-J90'
  origin          TEXT NOT NULL,          -- KSEA
  destination     TEXT NOT NULL,          -- KDEN
  s3_key          TEXT NOT NULL,          -- routes/SEA-DEN-v3.json
  bundle_version  INTEGER DEFAULT 1,
  last_built      TIMESTAMPTZ DEFAULT NOW(),
  route_geometry  JSONB,                  -- array of [lat, lon] points
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Wikipedia POIs ────────────────────────────────────────────────
-- Cached Wikipedia geosearch results, refreshed monthly
CREATE TABLE IF NOT EXISTS wikipedia_pois (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pageid          INTEGER NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  lat             DECIMAL(9,6) NOT NULL,
  lon             DECIMAL(9,6) NOT NULL,
  extract         TEXT,                   -- first 3 sentences
  thumbnail_url   TEXT,
  corridors       TEXT[],                 -- which corridors this POI appears in
  last_updated    TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wikipedia_pois_location
  ON wikipedia_pois USING GIST (point(lon, lat));

-- ── Premium POIs (Tourism Board content) ─────────────────────────
CREATE TABLE IF NOT EXISTS premium_pois (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_account_id  UUID,                   -- references bot_accounts
  name            TEXT NOT NULL,
  lat             DECIMAL(9,6) NOT NULL,
  lon             DECIMAL(9,6) NOT NULL,
  radius_miles    DECIMAL(5,2) DEFAULT 15,
  priority        INTEGER DEFAULT 2,      -- 1=highest, 3=lowest
  seat_side       TEXT DEFAULT 'both',    -- 'A', 'CD', 'both'
  altitude_min_ft INTEGER DEFAULT 18000,
  altitude_max_ft INTEGER DEFAULT 41000,
  hook_clear      TEXT NOT NULL,          -- visible conditions
  hook_partial    TEXT,                   -- partial cloud cover
  hook_obscured   TEXT,                   -- full cloud cover
  divergent_paths JSONB,                  -- array of {path, response}
  interrupt_behavior TEXT DEFAULT 'queue',
  active          BOOLEAN DEFAULT TRUE,
  impression_count INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── FLYREPs ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flyreps (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  flight_number   TEXT,
  lat             DECIMAL(9,6) NOT NULL,
  lon             DECIMAL(9,6) NOT NULL,
  altitude_ft     INTEGER,
  intensity       TEXT NOT NULL CHECK (intensity IN ('lgt', 'mod', 'sev')),
  ongoing         BOOLEAN DEFAULT FALSE,
  raw_label       TEXT,                   -- "Barely felt it" etc
  submitted_at    TIMESTAMPTZ DEFAULT NOW(),
  user_id         UUID,                   -- optional, anonymous ok
  corridor_hash   TEXT                    -- derived from position
);

CREATE INDEX IF NOT EXISTS idx_flyreps_location
  ON flyreps (lat, lon);
CREATE INDEX IF NOT EXISTS idx_flyreps_submitted
  ON flyreps (submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_flyreps_corridor
  ON flyreps (corridor_hash, submitted_at DESC);

-- ── BoT Accounts ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_accounts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,          -- "Wyoming Office of Tourism"
  contact_email   TEXT NOT NULL UNIQUE,
  geography       TEXT[],                 -- corridors they sponsor
  billing_tier    TEXT DEFAULT 'per_impression',
  stripe_customer_id TEXT,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Impressions (BoT billing) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS impressions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  premium_poi_id  UUID REFERENCES premium_pois(id),
  bot_account_id  UUID REFERENCES bot_accounts(id),
  flight_number   TEXT,
  corridor_hash   TEXT,
  seat_side       TEXT,
  engaged         BOOLEAN DEFAULT FALSE,  -- did passenger interact?
  ground_check    BOOLEAN DEFAULT FALSE,  -- did it escalate to LLM?
  impressed_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_impressions_bot
  ON impressions (bot_account_id, impressed_at DESC);
CREATE INDEX IF NOT EXISTS idx_impressions_poi
  ON impressions (premium_poi_id, impressed_at DESC);

-- ── FLYREP aggregates (materialized hourly) ───────────────────────
CREATE TABLE IF NOT EXISTS flyrep_aggregates (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  corridor_hash   TEXT NOT NULL,
  hour_bucket     TIMESTAMPTZ NOT NULL,   -- truncated to hour
  altitude_band   TEXT NOT NULL,          -- 'low', 'mid', 'cruise'
  lgt_count       INTEGER DEFAULT 0,
  mod_count       INTEGER DEFAULT 0,
  sev_count       INTEGER DEFAULT 0,
  total_count     INTEGER DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (corridor_hash, hour_bucket, altitude_band)
);
