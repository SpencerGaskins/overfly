/**
 * Wikipedia helpers for the Lambda bundler.
 *
 * Routes through the Netlify function proxy instead of hitting Wikipedia
 * directly — consistent with the client, avoids Lambda IP rate-limiting,
 * and gets proper User-Agent handling on the Netlify side.
 *
 * Falls back to direct Wikipedia calls if NETLIFY_WIKI_URL is not set
 * (useful for local testing of the bundler).
 */

const NETLIFY_WIKI_URL = process.env.NETLIFY_WIKI_URL ||
  'https://flightlevel-app.netlify.app/.netlify/functions/wikipedia'

const WIKI_API    = 'https://en.wikipedia.org/w/api.php'
const USER_AGENT  = 'FlightLevel/1.0 (https://flightlevel-app.netlify.app)'

// ── Bbox geosearch via Netlify proxy ──────────────────────────────
export async function queryWikipediaBBox(latMin, lonMin, latMax, lonMax, limit = 50) {
  const params = new URLSearchParams({ action: 'bbox', latMin, lonMin, latMax, lonMax, limit })
  const url    = `${NETLIFY_WIKI_URL}?${params}`

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    console.warn(`  [wiki] bbox query failed HTTP ${res.status} — falling back to direct`)
    return queryWikipediaBBoxDirect(latMin, lonMin, latMax, lonMax, limit)
  }
  return res.json()
}

// ── Extract enrichment via Netlify proxy ──────────────────────────
export async function getWikipediaExtracts(pageIds) {
  if (!pageIds?.length) return {}

  const ids    = pageIds.slice(0, 50).join(',')
  const params = new URLSearchParams({ action: 'extracts', pageids: ids })
  const url    = `${NETLIFY_WIKI_URL}?${params}`

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    console.warn(`  [wiki] extracts query failed HTTP ${res.status}`)
    return {}
  }
  const data = await res.json()
  // Drop stubs — extract under 100 chars has nothing worth surfacing
  return Object.fromEntries(
    Object.entries(data).filter(([, v]) => v?.extract && v.extract.length >= 100)
  )
}

/**
 * Get a summary for a single page ID.
 * Alias used by index.mjs enrichWithExtracts.
 */
export async function getWikipediaSummary(pageId) {
  const extracts = await getWikipediaExtracts([String(pageId)])
  const entry = extracts[String(pageId)]
  return {
    extract:   entry?.extract   || null,
    thumbnail: entry?.thumbnail || null,
  }
}

// ── Direct fallback (used if Netlify proxy is unavailable) ────────
async function queryWikipediaBBoxDirect(latMin, lonMin, latMax, lonMax, limit) {
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
  })
  const res  = await fetch(`${WIKI_API}?${params}`, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) return []
  const data = await res.json()
  return filterPOIs(data?.query?.geosearch || [])
}

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
]

export function filterPOIs(pois) {
  return pois.filter(poi => !EXCLUDE_PATTERNS.some(p => p.test(poi.title)))
}
