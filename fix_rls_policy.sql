-- Fix anxiety_profiles RLS policy
-- The current policy is blocking anonymous inserts

-- Drop the existing policy
DROP POLICY IF EXISTS "insert_own_profile" ON anxiety_profiles;

-- Create a permissive policy that allows all inserts
-- (profiles are anonymous anyway, keyed by client-generated session_id)
CREATE POLICY "allow_anonymous_insert" ON anxiety_profiles
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Also allow service role to read for analytics
CREATE POLICY "service_role_read" ON anxiety_profiles
  FOR SELECT
  TO service_role
  USING (true);
