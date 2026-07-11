/**
 * NOAA Aviation Weather helpers — server-side (Lambda)
 * Direct fetch, no CORS proxy needed.
 */

const NOAA_BASE = 'https://aviationweather.gov/api/data'

// ── Fetch PIREPs near a coordinate ────────────────────────────────
export async function fetchPIREPs(lat, lon, radiusNm = 150, ageHours = 3) {
  const deg  = radiusNm / 60
  const bbox = [
    (lat - deg).toFixed(2),
    (lon - deg).toFixed(2),
    (lat + deg).toFixed(2),
    (lon + deg).toFixed(2),
  ].join(',')

  const params = new URLSearchParams({ format: 'json', age: ageHours, bbox })
  const res = await fetch(`${NOAA_BASE}/pirep?${params}`, {
    headers: { 'User-Agent': 'FlightLevel/1.0' },
  })

  if (res.status === 204) return []
  if (!res.ok) throw new Error(`NOAA PIREP HTTP ${res.status}`)
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

// ── Classify turbulence intensity from PIREP array ────────────────
export function classifyTurbulence(pireps) {
  if (!pireps.length) return 'none'
  const max = Math.max(...pireps
    .filter(p => p.tbInt1 || p.tbInt2)
    .map(p => {
      const t = (p.tbInt1 || p.tbInt2 || '').toUpperCase()
      if (t.includes('SEV') || t.includes('EXTM')) return 3
      if (t.includes('MOD')) return 2
      if (t.includes('LGT') || t.includes('SMTH')) return 1
      return 0
    })
  )
  if (max >= 3) return 'severe'
  if (max >= 2) return 'moderate'
  if (max >= 1) return 'light'
  return 'none'
}

// ── Build a turbulence hook string ────────────────────────────────
export function buildTurbulenceHook(pireps, distanceNm) {
  const intensity = classifyTurbulence(pireps)
  const dist = Math.round(distanceNm)

  const hooks = {
    none:     `You're in smooth air right now through the Laramie Basin — one of the most reliably turbulent corridors in commercial aviation on other days. Mountain wave off the Medicine Bow Range. Today the atmosphere is cooperating.`,
    light:    `Heads up — pilots ahead are reporting light turbulence in roughly ${dist} miles over the Laramie Basin. You'll barely feel it, but the seatbelt sign may come on. The crew knows exactly what this is.`,
    moderate: `Something worth knowing — moderate turbulence ahead in roughly ${dist} miles. Pilots who just flew through are confirming it. The aircraft handles this routinely. Good moment to make sure your seatbelt is loosely fastened.`,
    severe:   `The crew is aware of significant turbulence ahead over the Laramie Basin. This is the most reliably rough corridor in the western US — mountain wave off the Medicine Bow Range. The aircraft is built for this. Seatbelt on, tray table up.`,
  }

  return hooks[intensity] || hooks.none
}
