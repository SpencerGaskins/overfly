# 🚨 CRITICAL FIXES NEEDED

## ✅ COMPLETED: OpenSky Live Tracking Fixed

The 502 error is now resolved. The livetrack function has been updated to use Node 20's native `fetch` instead of `node-fetch`. This has been deployed to production.

**Test it**: Go to https://flightlevel-app.netlify.app and select "Live Flight" mode.

---

## 🔴 URGENT: Run Supabase Migration

### Problem
The anxiety profile capture is failing with:
```
POST .../anxiety_profiles 404 (Not Found)
Could not find the table 'public.anxiety_profiles' in the schema cache
```

### Solution
You need to run the SQL migration in your Supabase dashboard.

### Steps:
1. Open: https://supabase.com/dashboard/project/gaywclgkgwiayh ckqqlx/sql
2. Copy the SQL below and paste it into the SQL Editor
3. Click "Run"

### SQL to Run:
```sql
-- Migration 001: Anxiety profiles
-- Captures passenger turbulence sensitivity and curiosity style at briefing time.

-- ── Anxiety profiles ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anxiety_profiles (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Session identity (anonymous by default)
  session_id              TEXT NOT NULL,
  user_id                 UUID,

  -- Flight context
  flight_number           TEXT,
  corridor_hash           TEXT,
  seat_side               TEXT,

  -- Profile answers
  turbulence_sensitivity  TEXT NOT NULL
    CHECK (turbulence_sensitivity IN ('calm', 'aware', 'anxious', 'avoidant')),
  curiosity_style         TEXT NOT NULL
    CHECK (curiosity_style IN ('storyteller', 'scientist', 'explorer', 'mixed')),

  -- Behavioral outcomes (populated during/after flight)
  flyrep_count            INTEGER DEFAULT 0,
  poi_interactions        INTEGER DEFAULT 0,
  conversation_count      INTEGER DEFAULT 0,
  ground_check_count      INTEGER DEFAULT 0,

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
ALTER TABLE anxiety_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "insert_own_profile" ON anxiety_profiles
  FOR INSERT
  WITH CHECK (true);
```

---

## 🔴 URGENT: Fix S3 CORS or Create Route Proxy

### Problem
Route bundles can't be loaded from S3:
```
Access to fetch at 'https://flightlevel-routes.s3.amazonaws.com/routes/SEA-DEN-v1.json' 
from origin 'https://flightlevel-app.netlify.app' has been blocked by CORS policy
```

The Supabase fallback also fails with 406.

### Impact
- POIs won't load on the map
- Flight briefing will be empty
- No Wikipedia enrichment

### Solution Option 1: Fix S3 CORS (Recommended)

Add this CORS configuration to your S3 bucket `flightlevel-routes`:

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

**Steps**:
1. Go to AWS S3 Console
2. Find bucket `flightlevel-routes`
3. Go to Permissions → CORS configuration
4. Paste the JSON above
5. Save

### Solution Option 2: Create Netlify Proxy Function

If you don't have access to S3 CORS settings, I can create a Netlify function to proxy the route bundles.

---

## 🟡 INVESTIGATE: Guide Function 404

### Problem
```
POST https://flightlevel-app.netlify.app/.netlify/functions/guide 404 (Not Found)
```

### Possible Causes
1. Function didn't deploy (but logs show it did)
2. Path mismatch in client code
3. Function initialization error

### Next Steps
1. Check function logs: https://app.netlify.com/projects/flightlevel-app/logs/functions
2. Test directly:
   ```bash
   curl -X POST https://flightlevel-app.netlify.app/.netlify/functions/guide \
     -H "Content-Type: application/json" \
     -d '{"messages":[{"role":"user","content":"test"}]}'
   ```
3. Verify `ANTHROPIC_API_KEY` is set in Netlify environment variables

---

## 🟡 INVESTIGATE: Supabase Routes Table 406

### Problem
```
GET .../rest/v1/routes?select=s3_key,bundle_version,last_built&corridor_hash=eq.SEA-DEN 406 (Not Acceptable)
```

### Possible Causes
1. `routes` table doesn't exist in Supabase
2. Table schema doesn't match the query
3. RLS policy blocking the query
4. Accept header issue

### Next Steps
1. Check if `routes` table exists in Supabase
2. If not, create it:
   ```sql
   CREATE TABLE routes (
     id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
     corridor_hash TEXT NOT NULL UNIQUE,
     s3_key TEXT NOT NULL,
     bundle_version INTEGER NOT NULL,
     last_built TIMESTAMPTZ DEFAULT NOW()
   );
   
   ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
   
   CREATE POLICY "allow_public_read" ON routes
     FOR SELECT
     USING (true);
   ```
3. Insert SEA-DEN route:
   ```sql
   INSERT INTO routes (corridor_hash, s3_key, bundle_version)
   VALUES ('SEA-DEN', 'routes/SEA-DEN-v1.json', 1)
   ON CONFLICT (corridor_hash) DO NOTHING;
   ```

---

## 📋 Priority Order

1. **Run anxiety_profiles migration** (5 minutes) - Enables profile capture
2. **Fix S3 CORS** (10 minutes) - Enables POI loading
3. **Create routes table** (5 minutes) - Enables Supabase fallback
4. **Debug guide function** (15 minutes) - Enables AI conversations

Total time: ~35 minutes to full functionality

---

## ✅ What's Already Working

- Dead reckoning position estimation
- Anxiety profile UI and flow
- PIREP proxy (turbulence data)
- Live tracking (after this deployment)
- Flight briefing animations
- Map rendering

