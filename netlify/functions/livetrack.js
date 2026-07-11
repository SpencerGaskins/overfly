/**
 * Netlify serverless function — OpenSky Network proxy
 * Deployed at: /.netlify/functions/livetrack
 *
 * Keeps OpenSky credentials server-side.
 * Handles OAuth2 token management and bounding box queries.
 *
 * Actions:
 *
 *   action=corridor&corridor=SEA-DEN
 *     Returns all airborne flights in the SEA→DEN corridor bounding box.
 *     Filters to large aircraft (category 4+) heading roughly eastbound.
 *     Returns: [{ icao24, callsign, lat, lon, altitudeFt, speedKt, heading, onGround }]
 *
 *   action=flight&icao24=abc123
 *     Returns current state vector for a specific aircraft.
 *     Returns: { icao24, callsign, lat, lon, altitudeFt, speedKt, heading, onGround }
 */

// Node 20+ has native fetch - no need for node-fetch

import { CORS_HEADERS, handleCORS } from './cors.js'

const OPENSKY_BASE  = 'https://opensky-network.org/api'
const TOKEN_URL     = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'

// SEA→DEN corridor bounding box — generous padding to catch all routes
const CORRIDORS = {
  'SEA-DEN': { lamin: 39.0, lomin: -123.5, lamax: 48.5, lomax: -104.0 },
  'DEN-SEA': { lamin: 39.0, lomin: -123.5, lamax: 48.5, lomax: -104.0 },
}

// SEA→DEN route centerline waypoints (matches client-side ROUTE_SEA_DEN)
const ROUTE_SEA_DEN = [
  [47.45, -122.31],
  [47.43, -121.72],
  [47.20, -119.32],
  [46.50, -117.50],
  [45.50, -116.00],
  [44.20, -114.00],
  [43.51, -112.07],
  [42.80, -110.50],
  [41.38, -108.34],
  [41.20, -107.00],
  [41.10, -106.00],
  [41.31, -105.59],
  [40.65, -105.20],
  [40.20, -105.00],
  [39.86, -104.67],
]

// Haversine distance in nautical miles between two lat/lon points
function distanceNm(lat1, lon1, lat2, lon2) {
  const R = 3440.06  // Earth radius in nm
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
    Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

// Minimum distance from a point to the SEA-DEN route centerline
function minDistanceToRoute(lat, lon, route) {
  let minDist = Infinity
  for (const [wlat, wlon] of route) {
    const d = distanceNm(lat, lon, wlat, wlon)
    if (d < minDist) minDist = d
  }
  return minDist
}

// Carrier prefixes that operate SEA↔DEN routes
const SEA_DEN_CARRIERS = new Set(['DAL','ASA','UAL','SWA','SKW','QXE','AAL'])

// Convert IATA flight number to ICAO callsign format for OpenSky matching
// e.g. "AS 535" → "ASA535", "UA 757" → "UAL757", "DL 1358" → "DAL1358"
const IATA_TO_ICAO = {
  'AS': 'ASA',  // Alaska
  'DL': 'DAL',  // Delta
  'UA': 'UAL',  // United
  'WN': 'SWA',  // Southwest
  'AA': 'AAL',  // American
  'F9': 'FFT',  // Frontier
  'OO': 'SKW',  // SkyWest
  'QX': 'QXE',  // Horizon
}

function flightNumToCallsign(flightNum) {
  if (!flightNum) return null
  const parts = flightNum.trim().split(' ')
  if (parts.length !== 2) return null
  const [iata, num] = parts
  const icao = IATA_TO_ICAO[iata]
  return icao ? `${icao}${num}` : null
}

// Token cache — reuse until 5 min before expiry
let cachedToken = null
let tokenExpiresAt = 0

async function getToken() {
  const now = Date.now()
  if (cachedToken && now < tokenExpiresAt - 300000) return cachedToken

  const clientId     = process.env.OPENSKY_CLIENT_ID
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('OpenSky credentials not configured')
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
    }),
  })

  if (!res.ok) throw new Error(`OpenSky auth failed: ${res.status}`)

  const data = await res.json()
  cachedToken    = data.access_token
  tokenExpiresAt = now + (data.expires_in * 1000)
  return cachedToken
}

// Parse a raw OpenSky state vector array into a clean object
function parseState(s) {
  if (!s || s[5] == null || s[6] == null) return null
  const altM = s[13] ?? s[7]  // prefer geometric altitude, fall back to baro
  return {
    icao24:     s[0],
    callsign:   (s[1] || '').trim() || null,
    lat:        s[6],
    lon:        s[5],
    altitudeFt: altM != null ? Math.round(altM * 3.28084) : null,
    speedKt:    s[9]  != null ? Math.round(s[9] * 1.94384) : null,
    heading:    s[10] != null ? Math.round(s[10]) : null,
    onGround:   s[8] === true,
    verticalRate: s[11],  // m/s — positive = climbing
    lastContact: s[4],
  }
}

// ── Corridor query — AeroDataBox for confirmed O/D, OpenSky for live position ────
async function handleCorridor({ corridor = 'SEA-DEN' }) {
  const bbox = CORRIDORS[corridor]
  if (!bbox) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: `Unknown corridor: ${corridor}` }) }
  }

  const aeroKey = process.env.AERODATABOX_API_KEY
  if (!aeroKey) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'AeroDataBox API key not configured' }) }
  }

  // Step 1: Get confirmed SEA→DEN and DEN→SEA flights from AeroDataBox
  const now = new Date()
  const from = new Date(now.getTime() - 8 * 60 * 60 * 1000)  // 8 hours ago — catch any flight that departed today
  const to   = new Date(now.getTime() + 2 * 60 * 60 * 1000)  // 2 hours ahead
  const fmt  = d => d.toISOString().slice(0, 16)

  const isEastbound = corridor === 'SEA-DEN'
  const depIcao = isEastbound ? 'KSEA' : 'KDEN'
  const arrIcao = isEastbound ? 'KDEN' : 'KSEA'

  let confirmedFlights = []
  try {
    const aeroUrl = `https://aerodatabox.p.rapidapi.com/flights/airports/icao/${depIcao}/${fmt(from)}/${fmt(to)}?withLeg=true&withCancelled=false&withLocation=true&direction=Departure`
    const aeroRes = await fetch(aeroUrl, {
      headers: {
        'x-rapidapi-host': 'aerodatabox.p.rapidapi.com',
        'x-rapidapi-key':  aeroKey,
      }
    })

    if (aeroRes.ok) {
      const aeroData = await aeroRes.json()
      const departures = aeroData.departures || []

      // Filter to flights arriving at our destination that have departed
      const nowMs = Date.now()
      confirmedFlights = departures
        .filter(f => {
          if (f.arrival?.airport?.icao !== arrIcao) return false
          // Must have some identifier for tracking
          if (!f.aircraft?.modeS && !f.callSign) return false
          // Must have departed already
          const depUtc = f.departure?.revisedTime?.utc || f.departure?.runwayTime?.utc || f.departure?.scheduledTime?.utc
          if (!depUtc) return false
          const depMs = new Date(depUtc.replace(' ', 'T') + (depUtc.includes('Z') ? '' : 'Z')).getTime()
          return depMs < nowMs
        })
        .map(f => ({
          icao24:    f.aircraft?.modeS?.toLowerCase() || null,
          callsign:  f.callSign || flightNumToCallsign(f.number) || null,
          flightNum: f.number,
          airline:   f.airline?.name,
          direction: isEastbound ? 'SEA→DEN' : 'DEN→SEA',
          lat:       f.location?.lat || null,
          lon:       f.location?.lon || null,
          altitudeFt: null,
        }))

      console.log(`[livetrack] AeroDataBox: ${confirmedFlights.length} confirmed ${corridor} flights`)
    }
  } catch (err) {
    console.warn('[livetrack] AeroDataBox query failed:', err.message)
  }

  // If no confirmed flights from AeroDataBox, fall back gracefully
  if (confirmedFlights.length === 0) {
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ flights: [], timestamp: Date.now() }),
    }
  }

  // Step 2: Enrich with live position from OpenSky
  try {
    const token  = await getToken()
    const osParams = new URLSearchParams({
      lamin: bbox.lamin, lomin: bbox.lomin,
      lamax: bbox.lamax, lomax: bbox.lomax,
    })
    const osRes  = await fetch(`${OPENSKY_BASE}/states/all?${osParams}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (osRes.ok) {
      const osData = await osRes.json()
      const stateMap = new Map(
        (osData.states || [])
          .map(parseState)
          .filter(Boolean)
          .flatMap(s => {
            const entries = []
            if (s.icao24) entries.push([s.icao24, s])
            if (s.callsign) entries.push([s.callsign.trim().toUpperCase(), s])
            return entries
          })
      )

      // Merge OpenSky position into confirmed flights
      confirmedFlights = confirmedFlights.map(f => {
        // Try icao24 first, then callsign
        const live = (f.icao24 && stateMap.get(f.icao24)) ||
                     (f.callsign && stateMap.get(f.callsign.toUpperCase()))
        if (!live) return f
        return {
          ...f,
          icao24:    f.icao24 || live.icao24,  // fill in icao24 if we didn't have it
          lat:       live.lat,
          lon:       live.lon,
          altitudeFt: live.altitudeFt,
          speedKt:   live.speedKt,
          heading:   live.heading,
          onGround:  live.onGround,
        }
      }).filter(f => f.lat && !f.onGround)
    }
  } catch (err) {
    console.warn('[livetrack] OpenSky enrichment failed:', err.message)
  }

  console.log(`[livetrack] ${corridor}: ${confirmedFlights.length} flights with live position`)

  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=10' },
    body: JSON.stringify({ flights: confirmedFlights, timestamp: Date.now() }),
  }
}

// ── Single flight state ───────────────────────────────────────────
async function handleFlight({ icao24 }) {
  if (!icao24) {
    return { statusCode: 400, body: JSON.stringify({ error: 'icao24 required' }) }
  }

  const token = await getToken()
  const params = new URLSearchParams({ icao24: icao24.toLowerCase() })

  const res = await fetch(`${OPENSKY_BASE}/states/all?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    return { statusCode: res.status, body: JSON.stringify({ error: `OpenSky returned ${res.status}` }) }
  }

  const data   = await res.json()
  const states = data.states || []
  const flight = states.length > 0 ? parseState(states[0]) : null

  if (!flight) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Flight not found or not airborne' }) }
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=10',
    },
    body: JSON.stringify(flight),
  }
}

// ── Live track (breadcrumb trail since departure) ─────────────────
async function handleTrack({ icao24 }) {
  if (!icao24) {
    return { statusCode: 400, body: JSON.stringify({ error: 'icao24 required' }) }
  }

  const token = await getToken()
  const params = new URLSearchParams({ icao24: icao24.toLowerCase(), time: 0 })

  const res = await fetch(`${OPENSKY_BASE}/tracks/all?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (res.status === 404) {
    return { statusCode: 404, body: JSON.stringify({ error: 'No live track found' }) }
  }

  if (!res.ok) {
    return { statusCode: res.status, body: JSON.stringify({ error: `OpenSky returned ${res.status}` }) }
  }

  const data = await res.json()

  // Convert path waypoints to [lat, lon] pairs, filtering nulls
  const path = (data.path || [])
    .filter(p => p[1] != null && p[2] != null && !p[5])  // exclude on-ground points
    .map(p => ({
      lat:        p[1],
      lon:        p[2],
      altitudeFt: p[3] != null ? Math.round(p[3] * 3.28084) : null,
      heading:    p[4],
      timestamp:  p[0],
    }))

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=30',
    },
    body: JSON.stringify({
      icao24:    data.icao24,
      callsign:  data.callsign,
      startTime: data.startTime,
      endTime:   data.endTime,
      path,
    }),
  }
}

// ── Handler ───────────────────────────────────────────────────────
export async function handler(event) {
  const preflight = handleCORS(event)
  if (preflight) return preflight

  const { action, ...params } = event.queryStringParameters || {}

  try {
    if (action === 'corridor') return await handleCorridor(params)
    if (action === 'flight')   return await handleFlight(params)
    if (action === 'track')    return await handleTrack(params)

    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'action must be corridor, flight, or track' }),
    }
  } catch (err) {
    console.error('[livetrack] Error:', err.message, err.stack)
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message, action, params }),
    }
  }
}
