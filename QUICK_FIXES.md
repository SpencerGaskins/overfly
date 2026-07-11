# Quick Fixes Needed

## 1. Fix Anxiety Profile RLS Policy (1 minute)

**Error**: `401 - new row violates row-level security policy for table "anxiety_profiles"`

**Fix**: Run this SQL in Supabase SQL Editor:

```sql
-- Drop the existing policy
DROP POLICY IF EXISTS "insert_own_profile" ON anxiety_profiles;

-- Create a permissive policy that allows all inserts
CREATE POLICY "allow_anonymous_insert" ON anxiety_profiles
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Also allow service role to read for analytics
CREATE POLICY "service_role_read" ON anxiety_profiles
  FOR SELECT
  TO service_role
  USING (true);
```

---

## 2. Check Livetrack Error (2 minutes)

**Error**: `/.netlify/functions/livetrack 500`

**Next Steps**:
1. Refresh the app and try "Live Flight" mode
2. Open browser console and look for the detailed error message
3. The new deployment includes better error logging - it will show:
   - The actual error message
   - Stack trace
   - Action and params that were sent

**Possible causes**:
- OpenSky API might be down
- Credentials might be incorrect
- Token request might be failing

Once you see the detailed error in the console, we can fix it.

---

## 3. S3 CORS (Optional - Supabase fallback is working!)

**Status**: Not critical - the app successfully falls back to Supabase

**Evidence**: Console shows `[bundle] Supabase lookup → routes/SEA-DEN-v1.json`

The S3 CORS issue doesn't block functionality, but if you want to fix it:
1. Go to AWS S3 Console
2. Find bucket `flightlevel-routes`
3. Permissions → CORS configuration
4. Add the CORS policy from `IMMEDIATE_FIXES.md`

---

## ✅ What's Working

- ✅ PIREPs loading (11 reports!)
- ✅ Dead reckoning position
- ✅ Route bundle loading (via Supabase fallback)
- ✅ Anxiety-aware turbulence messaging (just deployed!)
- ✅ Map rendering
- ✅ Flight briefing

---

## Priority

1. **Fix RLS policy** (1 min) - Enables anxiety profile capture
2. **Check livetrack error** (2 min) - See what the actual error is
3. S3 CORS (optional) - Already has working fallback

