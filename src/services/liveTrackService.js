/**
 * FlightLevel — Live Track Service
 *
 * Queries the OpenSky Network (via Netlify proxy) for real airborne
 * flights in the SEA→DEN corridor, then polls the selected flight's
 * position every 15 seconds.
 *
 * Usage:
 *   const tracker = new LiveTrackService('SEA-DEN')
 *
 *   // Get list of flights currently in corridor
 *   const flights = await tracker.getCorridorFlights()
 *   // flights: [{ icao24, callsign, lat, lon, altitudeFt, speedKt, heading }]
 *
 *   // Start following a specific flight
 *   tracker.follow(icao24, (position) => {
 *     // position: { lat, lon, altitudeFt, speedKt, heading, source: 'opensky' }
 *   })
 *
 *   tracker.stop()
 */

const IS_DEV = typeof window !== 'undefined' && window.location.port === '5173'
const LIVETRACK_ENDPOINT = IS_DEV
  ? 'http://localhost:8888/.netlify/functions/livetrack'
  : '/.netlify/functions/livetrack'
const POLL_INTERVAL_MS   = 15000  // 15s — OpenSky updates every 10s, we poll every 15s

export class LiveTrackService {
  constructor(corridor = 'SEA-DEN') {
    this.corridor     = corridor
    this.icao24       = null
    this.pollTimer    = null
    this.onPosition   = null
    this.lastPosition = null
    this.staleness    = 0
    this.flownPath    = []   // [[lat, lon], ...] breadcrumb trail since departure
  }

  /**
   * Fetch all airborne flights in the corridor.
   */
  async getCorridorFlights() {
    const res = await fetch(
      `${LIVETRACK_ENDPOINT}?action=corridor&corridor=${this.corridor}`
    )
    if (!res.ok) throw new Error(`Corridor query failed: ${res.status}`)
    const data = await res.json()
    return data.flights || []
  }

  /**
   * Start following a specific aircraft.
   * Fetches the live track (breadcrumb trail) immediately, then polls
   * current state every 15 seconds.
   */
  async follow(icao24, onPosition) {
    this.stop()
    this.icao24     = icao24
    this.onPosition = onPosition
    this.staleness  = 0
    this.flownPath  = []

    // Fetch breadcrumb trail first (shows path flown since departure)
    try {
      const trackRes = await fetch(
        `${LIVETRACK_ENDPOINT}?action=track&icao24=${icao24}`
      )
      if (trackRes.ok) {
        const track = await trackRes.json()
        this.flownPath = track.path.map(p => [p.lat, p.lon])
      }
    } catch (err) {
      console.warn('[livetrack] Track fetch failed:', err.message)
    }

    // Immediate position poll
    await this._poll()

    // Then poll on interval
    this.pollTimer = setInterval(() => this._poll(), POLL_INTERVAL_MS)
  }

  /**
   * Get the flown path as [[lat, lon], ...] for map display.
   */
  getFlownPath() {
    return this.flownPath
  }

  /**
   * Stop following.
   */
  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.icao24     = null
    this.onPosition = null
  }

  /**
   * True if currently following a flight.
   */
  get isFollowing() {
    return this.pollTimer !== null
  }

  /**
   * Seconds since last successful position update.
   */
  get staleSince() {
    return this.staleness
  }

  // ── Internal ──────────────────────────────────────────────────
  async _poll() {
    if (!this.icao24 || !this.onPosition) return

    try {
      const res = await fetch(
        `${LIVETRACK_ENDPOINT}?action=flight&icao24=${this.icao24}`
      )

      if (res.status === 404) {
        // Flight landed or out of coverage
        this.staleness += POLL_INTERVAL_MS / 1000
        console.warn(`[livetrack] ${this.icao24} not found — may have landed`)
        this.onPosition({
          ...this.lastPosition,
          stale: true,
          staleSince: this.staleness,
          source: 'opensky-stale',
        })
        return
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const flight = await res.json()
      this.staleness = 0

      const position = {
        lat:        flight.lat,
        lon:        flight.lon,
        altitudeFt: flight.altitudeFt,
        speedKt:    flight.speedKt,
        heading:    flight.heading,
        callsign:   flight.callsign,
        icao24:     flight.icao24,
        onGround:   flight.onGround,
        stale:      false,
        source:     'opensky',
        updatedAt:  Date.now(),
      }

      this.lastPosition = position
      this.onPosition(position)

    } catch (err) {
      this.staleness += POLL_INTERVAL_MS / 1000
      console.warn('[livetrack] Poll failed:', err.message)
      if (this.lastPosition) {
        this.onPosition({
          ...this.lastPosition,
          stale: true,
          staleSince: this.staleness,
          source: 'opensky-stale',
        })
      }
    }
  }
}

/**
 * Format a flight for display in the flight picker.
 * e.g. "DAL3675 · 33,400 ft · 487 kt"
 */
export function formatFlightLabel(flight) {
  const callsign = flight.callsign || flight.icao24
  const alt      = flight.altitudeFt ? `${flight.altitudeFt.toLocaleString()} ft` : ''
  const spd      = flight.speedKt    ? `${flight.speedKt} kt` : ''
  return [callsign, alt, spd].filter(Boolean).join(' · ')
}
