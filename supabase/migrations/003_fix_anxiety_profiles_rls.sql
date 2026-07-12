-- Migration 003: Fix anxiety_profiles RLS regression + security_definer view
--
-- Supabase's linter flagged 4 issues, all stemming from one root cause:
-- RLS was somehow disabled on anxiety_profiles again after migration 001
-- enabled it (policies existed — including an "allow_all_inserts" policy
-- not created by any migration in this repo, likely added via the Supabase
-- dashboard UI at some point — but RLS enforcement itself was off, which
-- makes those policies decorative rather than protective).
--
--   1. policy_exists_rls_disabled  — policies present, RLS not enforcing them
--   2. rls_disabled_in_public      — table publicly exposed with no RLS
--   3. sensitive_columns_exposed   — session_id column open with no RLS
--   4. security_definer_view       — anxiety_engagement_summary runs with
--      the view creator's permissions, not the querying user's, so it can
--      read through anxiety_profiles regardless of RLS on the base table
--
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/gaywclgkgwiayhckqqlx/sql

-- ── Re-enable RLS (idempotent — safe even if already enabled) ────
ALTER TABLE anxiety_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE anxiety_profiles FORCE ROW LEVEL SECURITY;  -- also applies to table owner

-- ── Consolidate policies under known names ────────────────────────
-- Drop every policy name that has existed on this table across migrations
-- 001, fix_rls_policy.sql, and whatever "allow_all_inserts" was (dashboard-
-- created, not tracked in this repo) — then recreate cleanly from scratch
-- so there's exactly one INSERT policy and one SELECT policy, both known
-- and both tracked in version control going forward.
DROP POLICY IF EXISTS "insert_own_profile"     ON anxiety_profiles;
DROP POLICY IF EXISTS "allow_anonymous_insert" ON anxiety_profiles;
DROP POLICY IF EXISTS "allow_all_inserts"      ON anxiety_profiles;
DROP POLICY IF EXISTS "service_role_read"      ON anxiety_profiles;

CREATE POLICY "anon_insert_anxiety_profiles" ON anxiety_profiles
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "service_role_select_anxiety_profiles" ON anxiety_profiles
  FOR SELECT
  TO service_role
  USING (true);

-- No SELECT policy for anon/authenticated — write-only from client, same
-- pattern as flyreps (migration 002). Analytics reads happen server-side
-- with the service role key, which bypasses RLS entirely anyway.

-- ── Fix security_definer_view on anxiety_engagement_summary ───────
-- Recreate with security_invoker=true so the view runs with the *querying*
-- user's permissions/RLS, not the view creator's. Without this, the view
-- could read through anxiety_profiles' RLS regardless of the policies above.
CREATE OR REPLACE VIEW anxiety_engagement_summary
WITH (security_invoker = true)
AS
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
