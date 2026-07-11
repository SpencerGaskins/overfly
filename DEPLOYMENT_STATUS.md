# FlightLevel Deployment Status

**Date**: May 16, 2026  
**Deployment**: https://flightlevel-app.netlify.app

## ✅ FIXED: OpenSky Live Tracking (502 Error)

**Problem**: Lambda function was trying to `require('node-fetch')` which wasn't being bundled.

**Solution**: 
- Removed `const fetch = require('node-fetch')` from `livetrack.js`
- Node 20+ has native `fetch` built-in - no external package needed
- Deleted `netlify/functions/package.json` (no longer needed)
- Removed `node-fetch` from root `package.json` dependencies

**Status**: ✅ Deployed to production

**Test**: Visit https://flightlevel-app.netlify.app and try "Live Flight" mode

---

## ⚠️ CRITICAL: Supabase Migration Not Run

**Problem**: Console shows `404 - Could not find the table 'public.anxiety_profiles'`

**Why**: The migration file exists but hasn't been executed in Supabase yet.

**Action Required**:
1. Go to: https://supabase.com/dashboard/project/gaywclgkgwiayh ckqqlx/sql
2. Copy the entire contents of `overfly/supabase/migrations/001_anxiety_profiles.sql`
3. Paste into the SQL Editor
4. Click "Run"

**What it creates**:
- `anxiety_profiles` table (turbulence sensitivity + curiosity style)
- `session_id` columns in `flyreps` and `impressions` tables
- `anxiety_engagement_summary` view for analytics
- RLS policies for anonymous profile submission

**Impact**: Until this runs, the anxiety profile capture in FlightBriefing will fail silently (fire-and-forget).

---

## ⚠️ ISSUE: S3 Route Bundle CORS

**Problem**: Console shows:
```
Access to fetch at 'https://flightlevel-routes.s3.amazonaws.com/routes/SEA-DEN-v1.json' 
from origin 'https://flightlevel-app.netlify.app' has been blocked by CORS policy
```

**Why**: S3 bucket doesn't have CORS configured to allow requests from `flightlevel-app.netlify.app`

**Fallback**: App correctly falls back to Supabase lookup, but that also fails with 406:
```
GET .../rest/v1/routes?select=...&corridor_hash=eq.SEA-DEN 406 (Not Acceptable)
```

**Possible causes**:
1. S3 bucket CORS policy needs to include `flightlevel-app.netlify.app` origin
2. Supabase `routes` table might not exist or has wrong schema
3. The `Accept` header might be causing the 406

**Action Required**:
- Check S3 bucket CORS configuration
- Verify `routes` table exists in Supabase with correct schema
- Consider adding a Netlify function proxy for route bundles if S3 CORS can't be fixed

---

## ⚠️ ISSUE: Guide Function 404

**Problem**: Console shows:
```
POST https://flightlevel-app.netlify.app/.netlify/functions/guide 404 (Not Found)
```

**Why**: Unclear - function was deployed successfully in this deployment

**Possible causes**:
1. Function might not have been deployed in previous deployment
2. Path mismatch in client code
3. Function might be failing to initialize

**Action Required**:
- Check Netlify function logs: https://app.netlify.com/projects/flightlevel-app/logs/functions
- Verify `guide.js` was deployed in the Functions list
- Test the endpoint directly: `curl -X POST https://flightlevel-app.netlify.app/.netlify/functions/guide`

---

## ✅ WORKING: PIREP Proxy

**Status**: Console shows `PIREP response status: 200`

The PIREP proxy is working correctly and bypassing CORS.

---

## 📋 NEXT STEPS

### Immediate (Required for full functionality):
1. **Run Supabase migration** - Anxiety profiles won't save until this is done
2. **Fix S3 CORS or route bundle fallback** - POIs won't load without route data
3. **Debug guide function 404** - AI guide conversations won't work

### Testing (After fixes):
1. Test live tracking with real SEA→DEN flights
2. Verify anxiety profile submission works
3. Test POI loading and guide conversations
4. Confirm PIREP data displays correctly

### Future Improvements:
1. Add error boundaries for failed route bundle loads
2. Add retry logic for guide function calls
3. Consider caching route bundles in localStorage
4. Add telemetry for tracking which features are being used

---

## 🔧 Development Commands

```bash
# Local development with Netlify functions
cd overfly
netlify serve

# Build for production
npm run build

# Deploy to production
netlify deploy --prod

# View function logs
netlify functions:log livetrack
netlify functions:log guide
```

---

## 📊 Current Feature Status

| Feature | Status | Notes |
|---------|--------|-------|
| Dead Reckoning | ✅ Working | Estimates position from flight number + time |
| Anxiety Profile Capture | ⚠️ Partial | UI works, but DB writes fail (migration needed) |
| Live Tracking | ✅ Fixed | Now uses native fetch, should work in production |
| PIREP Display | ✅ Working | Proxy successfully bypasses CORS |
| POI Loading | ⚠️ Broken | S3 CORS issue + Supabase fallback 406 |
| AI Guide | ⚠️ Broken | Function returns 404 |
| Flight Briefing | ✅ Working | Animations and flow work correctly |

