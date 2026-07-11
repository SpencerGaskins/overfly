/**
 * Destination weather alerts via NWS API
 * Translates NWS alert language into passenger-friendly context
 */

// Airport coordinates
const AIRPORT_COORDS = {
  KDEN: { lat: 39.86, lon: -104.67, name: 'Denver' },
  KSEA: { lat: 47.45, lon: -122.31, name: 'Seattle' },
  KLAX: { lat: 33.94, lon: -118.41, name: 'Los Angeles' },
  KJFK: { lat: 40.64, lon: -73.78, name: 'New York' },
  KORD: { lat: 41.98, lon: -87.91, name: 'Chicago' },
  KSFO: { lat: 37.62, lon: -122.38, name: 'San Francisco' },
}

// NWS event → passenger-friendly translation
const EVENT_TRANSLATIONS = {
  'Winter Storm Warning': {
    severity: 'moderate',
    hook: (city) => `Snow in ${city} today. DEN's crews can clear a runway in under 15 minutes — they've won the national award for snow removal four times. Expect a scenic approach.`,
    generic: (city, event) => `${city} has a ${event} in effect. The crew is aware and the airport is prepared.`,
  },
  'Winter Weather Advisory': {
    severity: 'low',
    hook: (city) => `Light snow possible in ${city}. Standard winter operations — no significant impact expected.`,
  },
  'Blizzard Warning': {
    severity: 'high',
    hook: (city) => `Significant winter storm at ${city}. Your crew has been briefed. Expect possible delays and a bumpy approach — the aircraft handles this routinely.`,
  },
  'Wind Advisory': {
    severity: 'low',
    hook: (city) => `Gusty winds at ${city} today. You may feel a firm touchdown — that's the crosswind correction. Completely normal.`,
  },
  'High Wind Warning': {
    severity: 'moderate',
    hook: (city) => `Strong winds at ${city}. Expect a firm landing and possible turbulence on approach. The crew trains for exactly this.`,
  },
  'Thunderstorm Warning': {
    severity: 'high',
    hook: (city) => `Thunderstorm activity near ${city}. Your crew will navigate around it — modern aircraft radar makes this routine.`,
  },
  'Fog Advisory': {
    severity: 'low',
    hook: (city) => `Low visibility at ${city}. The crew will use instrument approaches — the same procedure used thousands of times daily worldwide.`,
  },
  'Dense Fog Advisory': {
    severity: 'moderate',
    hook: (city) => `Dense fog at ${city}. Instrument approach in effect — the aircraft's systems are designed for exactly this. You may not see the runway until seconds before touchdown. That's normal.`,
  },
}

const IS_DEV = typeof window !== 'undefined' && window.location.port === '5173'
const FUNCTIONS_BASE = IS_DEV ? 'http://localhost:8888' : ''

export async function fetchDestinationWeather(icao) {
  const airport = AIRPORT_COORDS[icao]
  if (!airport) return null

  try {
    const res = await fetch(
      `${FUNCTIONS_BASE}/.netlify/functions/weather?lat=${airport.lat}&lon=${airport.lon}`
    )
    if (!res.ok) return null
    const data = await res.json()

    const alerts = data?.features || []
    if (!alerts.length) return { alerts: [], summary: null }

    // Find most significant alert
    const relevant = alerts
      .map(f => f.properties)
      .filter(p => p.status === 'Actual')
      .sort((a, b) => {
        const severity = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 }
        return (severity[b.severity] || 0) - (severity[a.severity] || 0)
      })

    if (!relevant.length) return { alerts: [], summary: null }

    const top = relevant[0]
    const translation = EVENT_TRANSLATIONS[top.event]

    return {
      alerts: relevant.slice(0, 3).map(a => a.event),
      summary: {
        event: top.event,
        severity: translation?.severity || 'low',
        hook: translation?.hook
          ? translation.hook(airport.name)
          : `${airport.name}: ${top.event} in effect. The crew is aware.`,
        headline: top.headline,
      }
    }
  } catch (err) {
    console.warn('Destination weather fetch failed:', err)
    return null
  }
}
