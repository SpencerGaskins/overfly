# LADD Compliance — Design

## Requirement (from FAA SWIM Terms of Service)

Any Service Consumer of SWIM data (TFMS, STDDS, etc.) must block aircraft on the FAA's
LADD (Limiting Aircraft Data Displayed) list from being shown in any live or historical
data display. Applies to GA and 14 CFR Part 135 on-demand charter aircraft.

**Note:** FlightLevel's queries are filtered to commercial carriers only (DAL, ASA, UAL,
SWA, SKW, QXE, AAL — see `SEA_DEN_CARRIERS` in `livetrack.js`). GA aircraft never enter
our datastream by design. LADD filtering is a defensive/compliance layer, not something
we expect to actually trigger — but it's a contractual requirement regardless.

## Design

### 1. Monthly LADD sync (scheduled job)

- Source: https://adx.faa.gov → download "IndustryLADD" list
- Published: first Thursday of each month
- Requires: separate ADX account (contact LADD@faa.gov or (202) 267-0346 for access)
- Compliance window: must update within 5 business days of publication

**Implementation:** Netlify scheduled function (cron) runs monthly, downloads the LADD
list, stores it in Supabase table `ladd_exclusions`.

```sql
CREATE TABLE ladd_exclusions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration TEXT,          -- N-number or tail number
    callsign TEXT,              -- if provided
    icao24 TEXT,                -- if provided
    published_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ladd_registration ON ladd_exclusions (registration) WHERE is_active;
CREATE INDEX idx_ladd_callsign ON ladd_exclusions (callsign) WHERE is_active;
CREATE INDEX idx_ladd_icao24 ON ladd_exclusions (icao24) WHERE is_active;
```

### 2. Filter check on every live data query

Any function that surfaces live flight data (TFMS position, STDDS gate/baggage) checks
the aircraft identifier against `ladd_exclusions` before returning it to the client.

```javascript
// laddFilter.js — shared utility for all SWIM-sourced functions
import { supabase } from './supabaseAdmin.js'

let laddCache = null
let laddCacheExpiry = 0
const CACHE_TTL_MS = 60 * 60 * 1000  // 1 hour — LADD list only changes monthly

async function getLaddSet() {
  const now = Date.now()
  if (laddCache && now < laddCacheExpiry) return laddCache

  const { data } = await supabase
    .from('ladd_exclusions')
    .select('registration, callsign, icao24')
    .eq('is_active', true)

  laddCache = new Set()
  for (const row of data || []) {
    if (row.registration) laddCache.add(row.registration.toUpperCase())
    if (row.callsign)     laddCache.add(row.callsign.toUpperCase())
    if (row.icao24)       laddCache.add(row.icao24.toLowerCase())
  }
  laddCacheExpiry = now + CACHE_TTL_MS
  return laddCache
}

export async function isLaddBlocked(flight) {
  const ladd = await getLaddSet()
  return (
    (flight.registration && ladd.has(flight.registration.toUpperCase())) ||
    (flight.callsign && ladd.has(flight.callsign.toUpperCase())) ||
    (flight.icao24 && ladd.has(flight.icao24.toLowerCase()))
  )
}

export async function filterLaddBlocked(flights) {
  const results = []
  for (const f of flights) {
    if (!(await isLaddBlocked(f))) results.push(f)
  }
  return results
}
```

### 3. Historical data protection

Per the terms: *"If the aircraft registration or call sign is later removed from the
LADD list, a Service Consumer is no longer required to limit the data display... Historical
data for the aircraft or call sign must be limited for time listed for LADD."*

This means historical records don't need retroactive purging when an aircraft comes OFF
the list, but any period WHILE it was on the list must remain blocked in historical views.

**Implementation:** `ladd_exclusions` retains inactive rows (soft delete via `is_active = false`
+ `removed_date`). Historical queries check against the LADD state at the time of the flight,
not just the current list.

```sql
ALTER TABLE ladd_exclusions ADD COLUMN removed_date DATE;
```

Historical filter logic: block if flight date falls between `published_date` and
`removed_date` (or now, if still active) for that registration/callsign/icao24.

### 4. Testing

- Since our carrier filter already excludes GA/charter, this code path may rarely activate
- Test with synthetic data: insert a known commercial callsign into `ladd_exclusions`
  temporarily, verify it's excluded from `livetrack.js` corridor results, then remove

## When to build this

Build alongside the TFMS integration (Phase 2/3), not before. No point building LADD
filtering until we actually have TFMS/SCDS access and are consuming SWIM data. Until then,
OpenSky + AeroDataBox are not subject to these terms (they're not FAA SWIM).

## Open item

Need to request ADX portal access to actually download the LADD list — contact
LADD@faa.gov or (202) 267-0346. Do this when Phase 2/3 TFMS work begins, not now.
