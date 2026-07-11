/**
 * Wikipedia POI service
 *
 * ⚠️ ARCHITECTURE RULE: Wikipedia is a LOCATION DISCOVERY SOURCE ONLY.
 * We use it to find that a notable place exists at a given lat/lon (title + coordinates).
 * We do NOT use Wikipedia article text/extracts as guide content — ever. The AI guide
 * (Claude/Haiku/Gemma) generates all narrative content itself, steered by our own system
 * prompt, using only the POI title + coordinates as a starting point. This avoids
 * Wikipedia's editorial bias and tone bleeding into the guide's voice.
 *
 * Do not reintroduce extract/summary text into any guide-facing context. If you need
 * richer POI metadata, write a curated seed instead (see Content Architecture spec).
 *
 * In production: routes through /.netlify/functions/wikipedia
 *   — proper User-Agent, no CORS issues, server-side rate limiting
 *
 * In dev (localhost): hits Wikipedia directly with origin:* fallback
 *   — may be slow or rate-limited, but functional for development
 */

const WIKI_API    = 'https://en.wikipedia.org/w/api.php'
const IS_DEV      = window.location.port === '5173'
const WIKI_PROXY  = IS_DEV ? 'http://localhost:8888/.netlify/functions/wikipedia' : '/.netlify/functions/wikipedia'

const IS_PROD = !IS_DEV

// ── Bbox geosearch ────────────────────────────────────────────────
/**
 * Query Wikipedia for geotagged articles within a bounding box.
 * Preferred over radius queries — covers more terrain per request.
 */
export async function queryWikipediaBBox(latMin, lonMin, latMax, lonMax, limit = 50) {
  if (IS_PROD) {
    const params = new URLSearchParams({ action: 'bbox', latMin, lonMin, latMax, lonMax, limit })
    const res = await fetch(`${WIKI_PROXY}?${params}`)
    if (!res.ok) return []
    return res.json()
  }

  // Dev fallback — direct Wikipedia call
  const centerLat = (latMin + latMax) / 2
  const centerLon = (lonMin + lonMax) / 2
  const latDeg    = (latMax - latMin) / 2
  const lonDeg    = (lonMax - lonMin) / 2
  const radiusM   = Math.min(
    Math.round(Math.sqrt(latDeg * latDeg + lonDeg * lonDeg) * 111320),
    10000
  )
  const params = new URLSearchParams({
    action:   'query',
    list:     'geosearch',
    gscoord:  `${centerLat}|${centerLon}`,
    gsradius: radiusM,
    gslimit:  Math.min(limit, 500),
    format:   'json',
    origin:   '*',
  })
  const res = await fetch(`${WIKI_API}?${params}`)
  const data = await res.json()
  return filterPOIs(data?.query?.geosearch || [])
}

/**
 * Query Wikipedia for geotagged articles near a coordinate (radius).
 * Used for the real-time POI engine during flight simulation.
 */
export async function queryWikipediaPOIs(lat, lon, radiusMeters = 10000, limit = 20) {
  // Convert radius to a tight bbox — more reliable than gsradius
  const deg = (Math.min(radiusMeters, 10000) / 111320)
  return queryWikipediaBBox(lat - deg, lon - deg, lat + deg, lon + deg, limit)
}

// ── Extract enrichment — REMOVED BY DESIGN ────────────────────────
// getWikipediaExtracts()/getWikipediaSummary() were removed 2026-07-05.
// Do not reintroduce Wikipedia article text into any guide-facing context.
// See the architecture note at the top of this file. The guide generates its
// own content from POI title + coordinates, steered by our system prompt —
// never from Wikipedia extracts.

// ── POI filter ────────────────────────────────────────────────────
const EXCLUDE_PATTERNS = [
  // Political / administrative
  /district/i, /precinct/i, /legislative/i, /electoral/i,
  /city council/i, /county commission/i, /\d+th congressional/i, /\d+th district/i,

  // Education
  /school/i, /elementary/i, /high school/i, /middle school/i, /university/i, /college/i,

  // Religion
  /church/i, /parish/i, /diocese/i, /cathedral/i, /mosque/i, /synagogue/i, /temple/i,

  // Death / memorials
  /cemetery/i, /memorial park/i, /burial/i, /mausoleum/i, /graveyard/i,

  // Aviation incidents — never surface on a plane
  /flight \d+/i, /air crash/i, /air disaster/i, /plane crash/i,
  /aircraft accident/i, /aviation accident/i, /midair/i,

  // Violence / tragedy
  /shooting/i, /massacre/i, /mass shooting/i, /gunman/i,
  /bombing/i, /terrorist/i, /terrorism/i, /attack on/i,
  /murder/i, /homicide/i, /assassination/i,
  /accident/i, /crash/i, /collision/i, /disaster/i, /tragedy/i,
  /death toll/i, /fatalities/i, /victims/i,

  // Sports clubs (low interest from altitude)
  /\bfc\b/i, /soccer club/i, /football club/i,

  // Businesses — not visible or interesting from 35,000 ft
  /bar and grill/i, /restaurant/i, /\bcafe\b/i, /\bdiner\b/i, /\bpub\b/i,
  /hotel/i, /motel/i, /inn\b/i, /lodge\b/i, /resort\b/i,
  /shopping/i, /mall\b/i, /plaza\b/i, /\bstore\b/i, /\bshop\b/i,
  /gas station/i, /pharmacy/i, /\bclinic\b/i, /\bhospital\b/i,
]

export function filterPOIs(pois) {
  return pois.filter(poi => !EXCLUDE_PATTERNS.some(p => p.test(poi.title)))
}

/**
 * Query POIs along a route by sampling points.
 * Used as fallback when no pre-built bundle is available.
 */
export async function queryRouteWikipediaPOIs(routePoints, sampleEveryNPoints = 1) {
  const seen    = new Set()
  const results = []

  // Use bbox queries covering segments of the route — more efficient
  const SEGMENT = 3
  for (let i = 0; i < routePoints.length - 1; i += SEGMENT) {
    const segment = routePoints.slice(i, i + SEGMENT + 1)
    const lats = segment.map(p => p[0])
    const lons = segment.map(p => p[1])
    const pois = await queryWikipediaBBox(
      Math.min(...lats) - 0.5, Math.min(...lons) - 0.5,
      Math.max(...lats) + 0.5, Math.max(...lons) + 0.5,
      50
    )
    for (const poi of pois) {
      if (!seen.has(poi.pageid)) {
        seen.add(poi.pageid)
        results.push(poi)
      }
    }
    await new Promise(r => setTimeout(r, 100))
  }

  return results
}
