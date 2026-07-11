-- Migration 001: Anxiety profiles
-- Captures passenger turbulence sensitivity and curiosity style at briefing time.
-- Linked to FLYREPs and impressions for behavioral analysis.
--
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/gaywclgkgwiayh ckqqlx/sql

-- ── Anxiety profiles ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anxiety_profiles (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Session identity (anonymous by default)
  session_id              TEXT NOT NULL,          -- client-generated UUID per flight session
  user_id                 UUID,                   -- optional, if passenger has an account

  -- Flight context
  flight_number           TEXT,                   -- e.g. 'DL3675'
  corridor_hash           TEXT,                   -- e.g. 'SEA-DEN'
  seat_side               TEXT,                   -- 'A' | 'CD'

  -- Profile answers
  turbulence_sensitivity  TEXT NOT NULL           -- 'calm' | 'aware' | 'anxious' | 'avoidant'
    CHECK (turbulence_sensitivity IN ('calm', 'aware', 'anxious', 'avoidant')),
  curiosity_style         TEXT NOT NULL           -- 'storyteller' | 'scientist' | 'explorer' | 'mixed'
    CHECK (curiosity_style IN ('storyteller', 'scientist', 'explorer', 'mixed')),

  -- Behavioral outcomes (populated during/after flight)
  flyrep_count            INTEGER DEFAULT 0,      -- how many FLYREPs this session submitted
  poi_interactions        INTEGER DEFAULT 0,      -- how many POI cards opened
  conversation_count      INTEGER DEFAULT 0,      -- how many guide conversations started
  ground_check_count      INTEGER DEFAULT 0,      -- how many LLM escalations

  -- Timestamps
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anxiety_profiles_session
  ON anxiety_profiles (session_id);
CREATE INDEX IF NOT EXISTS idx_anxiety_profiles_flight
  ON anxiety_profiles (flight_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anxiety_profiles_sensitivity
  ON anxiety_profiles (turbulence_sensitivity, created_at DESC);

-- ── Add session_id to flyreps ─────────────────────────────────────
-- Links turbulence reports back to the anxiety profile that filed them.
-- Allows: "anxious passengers report more FLYREPs" analysis.
ALTER TABLE flyreps
  ADD COLUMN IF NOT EXISTS session_id TEXT,
  ADD COLUMN IF NOT EXISTS anxiety_profile_id UUID REFERENCES anxiety_profiles(id);

CREATE INDEX IF NOT EXISTS idx_flyreps_session
  ON flyreps (session_id);

-- ── Add session_id to impressions ─────────────────────────────────
ALTER TABLE impressions
  ADD COLUMN IF NOT EXISTS session_id TEXT,
  ADD COLUMN IF NOT EXISTS anxiety_profile_id UUID REFERENCES anxiety_profiles(id);

-- ── Helper view: anxiety × engagement ────────────────────────────
-- Quick read on how sensitivity correlates with engagement depth.
CREATE OR REPLACE VIEW anxiety_engagement_summary AS
SELECT
  turbulence_sensitivity,
  curiosity_style,
  COUNT(*)                              AS sessions,
  AVG(flyrep_count)::NUMERIC(5,2)       AS avg_flyreps,
  AVG(poi_interactions)::NUMERIC(5,2)   AS avg_poi_opens,
  AVG(conversation_count)::NUMERIC(5,2) AS avg_conversations,
  AVG(ground_check_count)::NUMERIC(5,2) AS avg_ground_checks
FROM anxiety_profiles
GROUP BY turbulence_sensitivity, curiosity_style
ORDER BY turbulence_sensitivity, curiosity_style;

-- ── RLS policies ──────────────────────────────────────────────────
-- Passengers can insert their own profile (anonymous, keyed by session_id).
-- No reads from client — analytics are server-side only.
ALTER TABLE anxiety_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "insert_own_profile" ON anxiety_profiles
  FOR INSERT
  WITH CHECK (true);  -- any client can insert; session_id is client-generated UUID

-- Service role (Netlify functions) can read/update for analytics
-- No SELECT policy for anon role — profiles are write-only from client
