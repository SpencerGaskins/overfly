-- Migration 002: Enable RLS on all tables (critical security fix)
--
-- Supabase flagged two CRITICAL issues:
--   1. "Table publicly accessible" (rls_disabled_in_public) — RLS was never
--      enabled on routes, wikipedia_pois, premium_pois, flyreps, bot_accounts,
--      impressions, flyrep_aggregates. Since the anon key is public (shipped
--      in the frontend bundle), anyone with the project URL could SELECT,
--      INSERT, UPDATE, or DELETE all data in these tables via the REST API.
--   2. "Sensitive data publicly accessible" (sensitive_columns_exposed) —
--      bot_accounts.contact_email and bot_accounts.stripe_customer_id were
--      part of that same open table.
--
-- Fix approach: least-privilege. Only grant exactly the access the actual
-- client code needs (checked against src/services/*.js):
--   - flyreps: anon can INSERT (passenger FLYREP submission), nothing else
--   - anxiety_profiles: already had RLS from migration 001 — unchanged
--   - routes: anon can SELECT only (client bundle-fallback lookup)
--   - wikipedia_pois, premium_pois, bot_accounts, impressions,
--     flyrep_aggregates: NO anon/authenticated access at all. These are
--     written and read only by the Lambda route-bundler using the Supabase
--     SERVICE ROLE key, which bypasses RLS entirely — so locking these down
--     does not break the nightly bundler job.
--
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/gaywclgkgwiayhckqqlx/sql

-- ── flyreps ─────────────────────────────────────────────────────
ALTER TABLE flyreps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_insert_flyreps" ON flyreps;
CREATE POLICY "anon_insert_flyreps" ON flyreps
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- No SELECT/UPDATE/DELETE policy for anon/authenticated — submissions are
-- write-only from the client, same pattern as anxiety_profiles. Analytics
-- reads happen server-side with the service role key.

-- ── routes ──────────────────────────────────────────────────────
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_routes" ON routes;
CREATE POLICY "anon_read_routes" ON routes
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE for anon — only the Lambda bundler (service role)
-- writes to this table.

-- ── wikipedia_pois — server/Lambda only, no client access ────────
ALTER TABLE wikipedia_pois ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies for anon/authenticated. Service role bypasses
-- RLS, so the Lambda bundler's upserts continue to work unaffected.

-- ── premium_pois — server/Lambda only, no client access ──────────
ALTER TABLE premium_pois ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies for anon/authenticated.

-- ── bot_accounts — contains contact_email + stripe_customer_id ───
-- This was the "sensitive data publicly accessible" flag. Lock down
-- completely; billing/tourism-board admin access should go through a
-- server-side admin tool, never the public anon key.
ALTER TABLE bot_accounts ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies for anon/authenticated.

-- ── impressions — server/Lambda + billing analytics only ─────────
ALTER TABLE impressions ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies for anon/authenticated.

-- ── flyrep_aggregates — server-side analytics only ────────────────
ALTER TABLE flyrep_aggregates ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies for anon/authenticated. If a future feature
-- needs to show aggregate turbulence stats to passengers, add a narrow
-- SELECT-only policy here rather than reopening the whole table.
