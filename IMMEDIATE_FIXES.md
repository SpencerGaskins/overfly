# 🚨 IMMEDIATE FIXES NEEDED

Based on the latest console errors, here's what needs to be fixed RIGHT NOW:

---

## 1. ✅ OpenSky Credentials in Netlify (CRITICAL)

**Error**: `/.netlify/functions/livetrack 500`

**Cause**: The OpenSky credentials are in your local `.env` file but NOT in Netlify's environment variables.

**Fix**:
1. Go to: https://app.netlify.com/sites/flightlevel-app/settings/env
2. Add these two environment variables:
   - `OPENSKY_CLIENT_ID` = `sgaskins@gmail.com-api-client`
   - `OPENSKY_CLIENT_SECRET` = `6kYNWymqUBgPer8TWUQGAikMfxgqDGto`
3. Click "Save"
4. Redeploy (or it will auto-redeploy)

**Test**: After adding, the livetrack function should work.

---

## 2. ✅ Run Supabase Migration (CRITICAL)

**Error**: `404 - Could not find the table 'public.anxiety_profiles'`

**Fix**:
1. Go to: https://supabase.com/dashboard/project/gaywclgkgwiayh ckqqlx/sql
2. Paste this SQL and click "Run":

```sql
-- Anxiety profiles table
CREATE TABLE IF NOT EXISTS anxiety_profiles (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id              TEXT NOT NULL,
  user_id                 UUID,
  flight_number           TEXT,
  corridor_hash           TEXT,
  seat_side               TEXT,
  turbulence_sensitivity  TEXT NOT NULL
    CHECK (turbulence_sensitivity IN ('calm', 'aware', 'anxious', 'avoidant')),
  curiosity_style         TEXT NOT NULL
    CHECK (curiosity_style IN ('storyteller', 'scientist', 'explorer', 'mixed')),
  flyrep_count            INTEGER DEFAULT 0,
  poi_interactions        INTEGER DEFAULT 0,
  conversation_count      INTEGER DEFAULT 0,
  ground_check_count      INTEGER DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anxiety_profiles_session
  ON anxiety_profiles (session_id);
CREATE INDEX IF NOT EXISTS idx_anxiety_profiles_flight
  ON anxiety_profiles (flight_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anxiety_profiles_sensitivity
  ON anxiety_profiles (turbulence_sensitivity, created_at DESC);

ALTER TABLE flyreps
  ADD COLUMN IF NOT EXISTS session_id TEXT,
  ADD COLUMN IF NOT EXISTS anxiety_profile_id UUID REFERENCES anxiety_profiles(id);

CREATE INDEX IF NOT EXISTS idx_flyreps_session
  ON flyreps (session_id);

ALTER TABLE impressions
  ADD COLUMN IF NOT EXISTS session_id TEXT,
  ADD COLUMN IF NOT EXISTS anxiety_profile_id UUID REFERENCES anxiety_profiles(id);

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

ALTER TABLE anxiety_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "insert_own_profile" ON anxiety_profiles
  FOR INSERT
  WITH CHECK (true);
```

---

## 3. ✅ Create Routes Table in Supabase (CRITICAL)

**Error**: `406 - Cannot coerce the result to a single JSON object`

**Cause**: The `routes` table doesn't exist in Supabase.

**Fix**: In the same SQL editor, run this:

```sql
-- Routes table for bundle metadata
CREATE TABLE IF NOT EXISTS routes (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  corridor_hash     TEXT NOT NULL UNIQUE,
  s3_key            TEXT NOT NULL,
  bundle_version    INTEGER NOT NULL,
  last_built        TIMESTAMPTZ DEFAULT NOW(),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_public_read" ON routes
  FOR SELECT
  USING (true);

-- Insert SEA-DEN route metadata
INSERT INTO routes (corridor_hash, s3_key, bundle_version)
VALUES ('SEA-DEN', 'routes/SEA-DEN-v1.json', 1)
ON CONFLICT (corridor_hash) DO NOTHING;

INSERT INTO routes (corridor_hash, s3_key, bundle_version)
VALUES ('DEN-SEA', 'routes/DEN-SEA-v1.json', 1)
ON CONFLICT (corridor_hash) DO NOTHING;
```

---

## 4. ⚠️ S3 CORS (Can Wait)

**Error**: `Access-Control-Allow-Origin header is present on the requested resource`

**Impact**: Route bundles will fall back to Supabase (which will work after fix #3).

**Fix** (when you have time):
1. Go to AWS S3 Console
2. Find bucket `flightlevel-routes`
3. Permissions → CORS configuration
4. Add:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedOrigins": [
      "https://flightlevel-app.netlify.app",
      "http://localhost:5173",
      "http://localhost:8888"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

---

## ✅ What's Working

- PIREP data (11 reports loaded!)
- Dead reckoning (showing position at 46.301, -117.202)
- Map rendering
- Flight briefing UI

---

## Priority Order

1. **Add OpenSky credentials to Netlify** (2 min) → Fixes live tracking
2. **Run anxiety_profiles migration** (1 min) → Fixes profile capture
3. **Create routes table** (1 min) → Fixes POI loading

**Total: 4 minutes to get everything working!**

