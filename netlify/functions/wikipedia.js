/**
 * Netlify serverless function — Wikipedia API proxy
 * Deployed at: /.netlify/functions/wikipedia
 *
 * Handles two actions:
 *
 *   action=bbox
 *     Query geotagged articles within a bounding box.
 *     Params: latMin, lonMin, latMax, lonMax, limit (default 50)
 *     Returns: [{ pageid, title, lat, lon, dist }, ...]
 *
 *   action=extracts
 *     Fetch article extracts + thumbnails for a list of page IDs.
 *     Params: pageids (comma-separated)
 *     Returns: { [pageid]: { title, extract, thumbnail, lat, lon } }
 *
 * Why server-side?
 *   - Wikipedia rate-limits browser requests aggressively (origin: '*' workaround
 *     is unreliable and slow). Server-side requests with a proper User-Agent are
 *     treated as API clients and get consistent responses.
 *   - Eliminates 40+ sequential client-side fetches during flight briefing.
 *   - Lambda bundler can also call this endpoint for nightly builds.
 */

const WIKI_API   = 'https://en.wikipedia.org/w/api.php'
const USER_AGENT = 'FlightLevel/1.0 (https://flightlevel-app.netlify.app)'

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

function filterPOIs(pois) {
  return pois.filter(poi => !EXCLUDE_PATTERNS.some(p => p.test(poi.title)))
}

// ── Bbox geosearch ────────────────────────────────────────────────
// Wikipedia's gsbbox is unreliable (silently returns 0 results for large boxes).
// We decompose the bbox into a center + radius and use gscoord/gsradius instead.
async function handleBbox({ latMin, lonMin, latMax, lonMax, limit = 50 }) {
  if (!latMin || !lonMin || !latMax || !lonMax) {
    return { statusCode: 400, body: JSON.stringify({ error: 'latMin, lonMin, latMax, lonMax required' }) }
  }

  const centerLat = (Number(latMin) + Number(latMax)) / 2
  const centerLon = (Number(lonMin) + Number(lonMax)) / 2

  // Radius = half-diagonal of the bbox in meters, capped at 10 000 m (Wikipedia max)
  const latDeg = (Number(latMax) - Number(latMin)) / 2
  const lonDeg = (Number(lonMax) - Number(lonMin)) / 2
  const radiusM = Math.min(
    Math.round(Math.sqrt(latDeg * latDeg + lonDeg * lonDeg) * 111320),
    10000
  )

  const params = new URLSearchParams({
    action:   'query',
    list:     'geosearch',
    gscoord:  `${centerLat}|${centerLon}`,
    gsradius: radiusM,
    gslimit:  Math.min(Number(limit), 500),
    format:   'json',
  })

  const res = await fetch(`${WIKI_API}?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  })

  if (!res.ok) {
    return { statusCode: res.status, body: JSON.stringify({ error: `Wikipedia returned ${res.status}` }) }
  }

  const data  = await res.json()
  const raw   = data?.query?.geosearch || []
  const pois  = filterPOIs(raw)

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',  // 24h — geo data doesn't change fast
    },
    body: JSON.stringify(pois),
  }
}

// ── Extract enrichment ────────────────────────────────────────────
async function handleExtracts({ pageids }) {
  if (!pageids) {
    return { statusCode: 400, body: JSON.stringify({ error: 'pageids required' }) }
  }

  // Wikipedia allows up to 50 pageids per request
  const ids = String(pageids).split(',').slice(0, 50).join('|')

  const params = new URLSearchParams({
    action:      'query',
    pageids:     ids,
    prop:        'extracts|pageimages|coordinates',
    exintro:     true,
    exsentences: 3,
    explaintext: true,
    piprop:      'thumbnail',
    pithumbsize: 400,
    format:      'json',
  })

  const res = await fetch(`${WIKI_API}?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  })

  if (!res.ok) {
    return { statusCode: res.status, body: JSON.stringify({ error: `Wikipedia returned ${res.status}` }) }
  }

  const data  = await res.json()
  const pages = data?.query?.pages || {}

  // Reshape to { [pageid]: { title, extract, thumbnail, lat, lon } }
  // Drop stub articles — extract under 100 chars is a disambiguation page,
  // redirect, or a place with nothing worth saying ("Edgewick is a CDP in WA.")
  const result = {}
  for (const [id, page] of Object.entries(pages)) {
    const extract = page.extract || null
    if (!extract || extract.length < 100) continue  // skip stubs
    result[id] = {
      title:     page.title,
      extract,
      thumbnail: page.thumbnail?.source || null,
      lat:       page.coordinates?.[0]?.lat || null,
      lon:       page.coordinates?.[0]?.lon || null,
    }
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=604800',  // 7 days — article text is stable
    },
    body: JSON.stringify(result),
  }
}

// ── Handler ───────────────────────────────────────────────────────
export async function handler(event) {
  const { action, ...params } = event.queryStringParameters || {}

  try {
    if (action === 'bbox')     return await handleBbox(params)
    if (action === 'extracts') return await handleExtracts(params)

    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'action must be bbox or extracts' }),
    }
  } catch (err) {
    console.error('[wikipedia] Error:', err)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
