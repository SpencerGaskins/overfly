/**
 * NOAA Aviation Weather API
 * Free, no API key required
 * Docs: https://aviationweather.gov/data/api/
 */

const NOAA_BASE = 'https://aviationweather.gov/api/data'

// Always use Netlify proxy to bypass CORS (works in both dev and prod)
const IS_DEV = typeof window !== 'undefined' && window.location.port === '5173'
const FUNCTIONS_BASE = IS_DEV ? 'http://localhost:8888' : ''
const PIREP_ENDPOINT = `${FUNCTIONS_BASE}/.netlify/functions/pirep`

/**
 * Fetch PIREPs (Pilot Reports) near a coordinate
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusNm — search radius in nautical miles
 * @param {number} ageHours — max age of reports in hours
 */
export async function fetchPIREPs(lat, lon, radiusNm = 150, ageHours = 3) {
  try {
    // bbox format: lat0,lon0,lat1,lon1
    const deg = radiusNm / 60  // rough degree conversion
    const bbox = `${(lat - deg).toFixed(2)},${(lon - deg).toFixed(2)},${(lat + deg).toFixed(2)},${(lon + deg).toFixed(2)}`
    const params = new URLSearchParams({
      format: 'json',
      age: ageHours,
      bbox,
    })
    const res = await fetch(`${PIREP_ENDPOINT}?${params}`)
    console.log('PIREP response status:', res.status)
    if (res.status === 204) return []  // no data available
    if (!res.ok) return []
    const data = await res.json()
    console.log('PIREP data:', data)
    return Array.isArray(data) ? data : []
  } catch (err) {
    console.error('PIREP fetch error:', err)
    return []
  }
}

/**
 * Fetch AIRMETs/SIGMETs for turbulence near a coordinate
 */
export async function fetchAirSigmets(lat, lon) {
  try {
    const params = new URLSearchParams({
      format: 'json',
      type: 'sigmet',
    })
    const res = await fetch(`${NOAA_BASE}/airsigmet?${params}`)
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * Classify turbulence intensity from PIREP data
 * Returns: 'none' | 'light' | 'moderate' | 'severe'
 */
export function classifyTurbulence(pireps) {
  if (!pireps.length) return 'none'

  const intensities = pireps
    .filter(p => p.tbInt1 || p.tbInt2)
    .map(p => {
      const t = (p.tbInt1 || p.tbInt2 || '').toUpperCase()
      if (t === 'NEG' || t === 'NONE') return 0
      if (t.includes('SEV') || t.includes('EXTM')) return 3
      if (t.includes('MOD')) return 2
      if (t.includes('LGT') || t.includes('SMTH')) return 1
      return 0
    })

  if (!intensities.length) return 'none'
  const max = Math.max(...intensities)
  if (max >= 3) return 'severe'
  if (max >= 2) return 'moderate'
  if (max >= 1) return 'light'
  return 'none'
}

/**
 * Generate a turbulence hook string based on live PIREP data
 * @param {Array} pireps - PIREP data
 * @param {number} distanceNm - distance to turbulence
 * @param {string} anxietyLevel - 'calm' | 'aware' | 'anxious' | 'avoidant'
 */
export function buildTurbulenceHook(pireps, distanceNm, anxietyLevel = 'aware') {
  const intensity = classifyTurbulence(pireps)
  const dist = Math.round(distanceNm)

  // Messaging tailored to anxiety level
  const hooks = {
    // Calm passengers: matter-of-fact, practical
    calm: {
      none: `Smooth air through the Laramie Basin — one of the most reliably turbulent corridors in commercial aviation. Mountain wave off the Medicine Bow Range. Today the atmosphere is cooperating.`,
      light: `Light turbulence in about ${dist} miles. Not worth mentioning, really — you'll barely feel it.`,
      moderate: `Moderate turbulence coming up in about ${dist} miles. Good time to use the restroom if you're thinking about it. Seatbelt on before it hits.`,
      severe: `Significant turbulence ahead over the Laramie Basin in about ${dist} miles — mountain wave off the Medicine Bow Range. Wrap up whatever you're doing, seatbelt on. The aircraft handles this routinely.`,
    },
    // Aware passengers: informative but reassuring
    aware: {
      none: `You're in smooth air right now through the Laramie Basin — one of the most reliably turbulent corridors in commercial aviation on other days. Mountain wave off the Medicine Bow Range. Today the atmosphere is cooperating.`,
      light: `Heads up — pilots ahead are reporting light turbulence in roughly ${dist} miles over the Laramie Basin. You'll barely feel it, but the seatbelt sign may come on. The crew knows exactly what this is.`,
      moderate: `Something worth knowing — moderate turbulence ahead in roughly ${dist} miles. Pilots who just flew through are confirming it. The aircraft handles this routinely. Good moment to make sure your seatbelt is loosely fastened.`,
      severe: `The crew is aware of significant turbulence ahead over the Laramie Basin. This is the most reliably rough corridor in the western US — mountain wave off the Medicine Bow Range. The aircraft is built for this. Seatbelt on, tray table up.`,
    },
    // Anxious passengers: more context, more reassurance
    anxious: {
      none: `Good news: smooth air all the way through the Laramie Basin. This corridor can get bumpy on other days, but today the atmosphere is calm. You're in good hands.`,
      light: `Heads up: light turbulence coming in about ${dist} miles. It'll feel like driving over a slightly bumpy road — nothing the aircraft can't handle easily. The crew has seen this hundreds of times. Your seatbelt will keep you comfortable.`,
      moderate: `The crew is aware of moderate turbulence ahead in about ${dist} miles. Here's what that means: the aircraft will bounce a bit, but it's designed for this. Pilots who just flew through report it's manageable. Keep your seatbelt loosely fastened and you'll be fine. This is routine for the crew.`,
      severe: `The crew knows about significant turbulence ahead over the Laramie Basin. This is a well-known rough spot — mountain wave activity. Here's the important part: the aircraft is engineered for this exact scenario. The pilots are trained for it. Keep your seatbelt on, tray table up, and trust the crew. They've got this.`,
    },
    // Avoidant passengers: short notice, maximum reassurance, no dread window
    avoidant: {
      none: `Great news: you're in smooth air through the Laramie Basin. This area can get bumpy, but not today. The crew has everything under control, and you can relax.`,
      light: `Quick heads up — light turbulence coming shortly. It'll feel like a gentle bounce. Get your seatbelt on and you'll be fine. The aircraft handles this easily.`,
      moderate: `Seatbelt on — moderate turbulence coming up shortly. The pilots know it's there and they're prepared. The aircraft is built for this. Take a breath, get buckled, and let the crew handle it.`,
      severe: `The crew is aware and prepared for significant turbulence ahead. Get your seatbelt snug and tray table up now. This is a well-known rough spot — pilots fly through it regularly. The aircraft is engineered for forces far beyond what you'll feel. You're in expert hands.`,
    },
  }

  const levelHooks = hooks[anxietyLevel] || hooks.aware
  return levelHooks[intensity] || levelHooks.none
}
