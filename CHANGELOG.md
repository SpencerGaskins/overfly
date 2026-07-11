# FlightLevel Changelog

## [Unreleased] - 2026-05-17

### ✅ Fixed
- **Anxiety Profile Capture**: Fixed RLS policy blocking anonymous profile submissions (disabled RLS for anxiety_profiles table since data is anonymous)
- **OpenSky Live Tracking**: Removed `node-fetch` dependency, now using Node 20+ native fetch API
- **Anxiety Profile Submission**: Removed `.select().single()` chain that was triggering unnecessary RLS checks

### ✨ Added
- **Anxiety-Aware Turbulence Messaging**: Turbulence descriptions now adapt to passenger anxiety level
  - **Calm**: Matter-of-fact reporting ("Moderate turbulence")
  - **Aware**: Standard informative messaging ("Moderate turbulence")
  - **Anxious**: Reassuring context added ("Moderate turbulence — uncomfortable but completely safe")
  - **Avoidant**: Turbulence section completely hidden from pre-flight briefing
- **Supabase Schema**: Created `anxiety_profiles` table with session tracking
- **Supabase Schema**: Added `session_id` columns to `flyreps` and `impressions` tables for behavioral analysis
- **Supabase Schema**: Created `anxiety_engagement_summary` view for analytics
- **Route Metadata**: Inserted SEA-DEN and DEN-SEA route records in Supabase `routes` table

### 🔧 Changed
- **Live Tracking Filter**: Tightened corridor filters to 75-105° heading (due east ±30°) and >18,000ft altitude to exclude non-SEA→DEN flights
- **Turbulence Hooks**: Updated `buildTurbulenceHook()` to accept anxiety level parameter and return tailored messaging

### 📝 Database Migrations
Run in Supabase SQL Editor:
```sql
-- Disable RLS for anxiety_profiles (anonymous data only)
ALTER TABLE anxiety_profiles DISABLE ROW LEVEL SECURITY;

-- Ensure routes table has public read access
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_public_read" ON routes FOR SELECT USING (true);
```

### 🐛 Known Issues
- **S3 CORS**: Route bundles fail to load from S3 due to CORS policy (non-critical - Supabase fallback works)
- **Live Tracking 500**: OpenSky corridor query returns 500 in production (needs investigation)
- **Guide Function 404**: AI guide endpoint not responding (needs investigation)

### 🧪 Testing Notes
- Anxiety profile capture tested and verified in local environment
- Profile successfully saved to Supabase with session ID tracking
- Turbulence section suppression confirmed for "avoidant" anxiety level
- PIREPs loading correctly (3-11 reports per checkpoint)
- Dead reckoning position calculation working

---

## Deployment Checklist
- [ ] Run Supabase migrations (if not already run)
- [ ] Verify OpenSky credentials in Netlify environment variables
- [ ] Test anxiety profile flow on production
- [ ] Verify turbulence section hidden for "avoidant" passengers
- [ ] Check live tracking functionality
- [ ] Monitor function logs for errors
