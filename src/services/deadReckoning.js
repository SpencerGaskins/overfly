/**
 * FlightLevel — Dead Reckoning Position Service
 *
 * Estimates aircraft position from:
 *   - Flight number (→ route geometry)
 *   - Scheduled departure time
 *   - Elapsed time since departure
 *
 * Used as fallback when OpenSky has no data (flight not yet in ADS-B coverage,
 * or OpenSky rate-limited). Accuracy: ±30–50 miles at cruise — good enough
 * to surface the right POIs and turbulence lookahead.
 *
 * Usage:
 *   const dr = new DeadReckoningService('DL3675', departureTime)
 *   const pos = dr.estimate()
 *   // { lat, lon, altitudeFt, progressFraction, phase, source: 'dead-reckoning' }
 *
 *   // Update with a known fix (e.g. from OpenSky) to re-anchor
 *   dr.anchor(lat, lon, altitudeFt, timestamp)
 */

import { ROUTES, ROUTE_SEA_DEN } from '../data/routes'

// ── Flight profiles ────────────────────────────────────────────────
// Block times and altitude profiles for known routes.
// Block time = gate-to-gate. Airborne time ≈ block - 15 min taxi each end.
const FLIGHT_PROFILES = {
  'DL3675': {
    blockMinutes:    155,   // SEA→DEN ~2h35m scheduled
    airborneMinutes: 125,   // ~2h05m wheels-up to touchdown
    cruiseAltFt:     37000,
    climbMinutes:    25,    // time to reach cruise
    descentMinutes:  30,    // time from TOD to touchdown
  },
  'DL3676': {
    blockMinutes:    175,   // DEN→SEA ~2h55m (headwinds)
    airborneMinutes: 145,
    cruiseAltFt:     37000,
    climbMinutes:    25,
    descentMinutes:  30,
  },
}

// Default profile for unknown flights on the SEA-DEN corridor
const DEFAULT_PROFILE = {
  blockMinutes:    160,
  airborneMinutes: 130,
  cruiseAltFt:     35000,
  climbMinutes:    25,
  descentMinutes:  30,
}

// ── Geometry helpers ───────────────────────────────────────────────

/**
 * Haversine distance in nautical miles between two [lat, lon] points.
 */
function distanceNm(a, b) {
  const R = 3440.065  // Earth radius in NM
  const dLat = (b[0] - a[0]) * Math.PI / 180
  const dLon = (b[1] - a[1]) * Math.PI / 180
  const lat1 = a[0] * Math.PI / 180
  const lat2 = b[0] * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

/**
 * Build cumulative distance array for a route.
 * Returns [0, d01, d01+d12, ...] in NM.
 */
function buildCumulativeDistances(route) {
  const cum = [0]
  for (let i = 1; i < route.length; i++) {
    cum.push(cum[i - 1] + distanceNm(route[i - 1], route[i]))
  }
  return cum
}

/**
 * Interpolate a [lat, lon] position at a given fraction (0–1) along a route.
 */
function interpolateRoute(route, fraction) {
  if (fraction <= 0) return route[0]
  if (fraction >= 1) return route[route.length - 1]

  const cum = buildCumulativeDistances(route)
  const totalNm = cum[cum.length - 1]
  const targetNm = fraction * totalNm

  for (let i = 1; i < cum.length; i++) {
    if (cum[i] >= targetNm) {
      const segFraction = (targetNm - cum[i - 1]) / (cum[i] - cum[i - 1])
      const a = route[i - 1]
      const b = route[i]
      return [
        a[0] + (b[0] - a[0]) * segFraction,
        a[1] + (b[1] - a[1]) * segFraction,
      ]
    }
  }
  return route[route.length - 1]
}

/**
 * Estimate altitude given elapsed airborne minutes and flight profile.
 * Simple trapezoidal climb/cruise/descent model.
 */
function estimateAltitude(elapsedAirborneMin, profile) {
  const { cruiseAltFt, climbMinutes, descentMinutes, airborneMinutes } = profile
  const todMinute = airborneMinutes - descentMinutes  // top of descent

  if (elapsedAirborneMin <= 0) return 0
  if (elapsedAirborneMin <= climbMinutes) {
    // Climbing — linear from 0 to cruise
    return Math.round((elapsedAirborneMin / climbMinutes) * cruiseAltFt)
  }
  if (elapsedAirborneMin <= todMinute) {
    // Cruise
    return cruiseAltFt
  }
  if (elapsedAirborneMin <= airborneMinutes) {
    // Descending — linear from cruise to 0
    const descentElapsed = elapsedAirborneMin - todMinute
    return Math.round((1 - descentElapsed / descentMinutes) * cruiseAltFt)
  }
  return 0  // landed
}

/**
 * Determine flight phase from elapsed airborne time.
 */
function flightPhase(elapsedAirborneMin, profile) {
  const { climbMinutes, descentMinutes, airborneMinutes } = profile
  if (elapsedAirborneMin <= 0)                                    return 'preflight'
  if (elapsedAirborneMin <= climbMinutes)                         return 'climb'
  if (elapsedAirborneMin <= airborneMinutes - descentMinutes)     return 'cruise'
  if (elapsedAirborneMin <= airborneMinutes)                      return 'descent'
  return 'landed'
}

// ── DeadReckoningService ───────────────────────────────────────────

export class DeadReckoningService {
  /**
   * @param {string} flightNumber  - e.g. 'DL3675'
   * @param {Date|number|null} departureTime - scheduled departure (Date or ms timestamp).
   *   If null, uses "now minus 30 minutes" as a rough guess.
   * @param {number[][]} [routeOverride] - custom route geometry (optional)
   */
  constructor(flightNumber, departureTime = null, routeOverride = null) {
    this.flightNumber = flightNumber.toUpperCase()
    this.profile      = FLIGHT_PROFILES[this.flightNumber] || DEFAULT_PROFILE

    // Route geometry
    const knownRoute = ROUTES[this.flightNumber]
    this.route = routeOverride || (knownRoute ? knownRoute.points : ROUTE_SEA_DEN)

    // Departure time — gate push, not wheels-up
    const taxiMinutes = 15
    if (departureTime) {
      const depMs = departureTime instanceof Date ? departureTime.getTime() : departureTime
      this.wheelsUpMs = depMs + taxiMinutes * 60000
    } else {
      // No departure time — assume we're ~30 min into the flight
      this.wheelsUpMs = Date.now() - 30 * 60000
    }

    // Anchor — a known position fix to correct accumulated error
    this._anchor = null  // { lat, lon, altitudeFt, progressFraction, timestamp }
  }

  /**
   * Estimate current position.
   * @returns {{ lat, lon, altitudeFt, progressFraction, phase, elapsedMin, source }}
   */
  estimate(atTime = Date.now()) {
    const elapsedAirborneMin = (atTime - this.wheelsUpMs) / 60000

    let progressFraction
    if (this._anchor) {
      // Re-anchor: compute progress from anchor point + elapsed time since anchor
      const elapsedSinceAnchorMin = (atTime - this._anchor.timestamp) / 60000
      const totalAirborneMin = this.profile.airborneMinutes
      const additionalProgress = elapsedSinceAnchorMin / totalAirborneMin
      progressFraction = Math.min(1, this._anchor.progressFraction + additionalProgress)
    } else {
      progressFraction = Math.min(1, Math.max(0,
        elapsedAirborneMin / this.profile.airborneMinutes
      ))
    }

    const [lat, lon] = interpolateRoute(this.route, progressFraction)
    const altitudeFt = estimateAltitude(elapsedAirborneMin, this.profile)
    const phase      = flightPhase(elapsedAirborneMin, this.profile)

    return {
      lat,
      lon,
      altitudeFt,
      progressFraction,
      phase,
      elapsedMin:  Math.round(elapsedAirborneMin),
      source:      this._anchor ? 'dead-reckoning-anchored' : 'dead-reckoning',
    }
  }

  /**
   * Anchor to a known position fix (e.g. from a single OpenSky hit).
   * Subsequent estimates will extrapolate from this fix rather than departure time.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {number} altitudeFt
   * @param {number} [timestamp] - ms timestamp of the fix (defaults to now)
   */
  anchor(lat, lon, altitudeFt, timestamp = Date.now()) {
    // Find the closest point on the route to derive progress fraction
    const cum = buildCumulativeDistances(this.route)
    const totalNm = cum[cum.length - 1]

    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < this.route.length; i++) {
      const d = distanceNm([lat, lon], this.route[i])
      if (d < bestDist) { bestDist = d; bestIdx = i }
    }

    // Interpolate within the nearest segment for finer resolution
    let progressFraction = cum[bestIdx] / totalNm
    if (bestIdx < this.route.length - 1) {
      const segDist = distanceNm([lat, lon], this.route[bestIdx + 1])
      const segLen  = distanceNm(this.route[bestIdx], this.route[bestIdx + 1])
      if (segLen > 0) {
        const segProgress = Math.max(0, 1 - segDist / segLen)
        progressFraction = (cum[bestIdx] + segProgress * (cum[bestIdx + 1] - cum[bestIdx])) / totalNm
      }
    }

    this._anchor = { lat, lon, altitudeFt, progressFraction, timestamp }
    console.log(`[dead-reckoning] Anchored at ${lat.toFixed(3)}, ${lon.toFixed(3)} — ${Math.round(progressFraction * 100)}% along route`)
  }

  /**
   * True if the flight has likely landed (elapsed > airborne time + 15 min buffer).
   */
  get isLanded() {
    const elapsed = (Date.now() - this.wheelsUpMs) / 60000
    return elapsed > this.profile.airborneMinutes + 15
  }

  /**
   * Estimated minutes remaining to destination.
   */
  get minutesRemaining() {
    const elapsed = (Date.now() - this.wheelsUpMs) / 60000
    return Math.max(0, Math.round(this.profile.airborneMinutes - elapsed))
  }

  /**
   * Total route distance in nautical miles.
   */
  get totalDistanceNm() {
    return Math.round(buildCumulativeDistances(this.route).at(-1))
  }
}

/**
 * Quick one-shot estimate — no instance needed.
 * Useful for initial position before starting live tracking.
 *
 * @param {string} flightNumber
 * @param {Date|number|null} departureTime
 * @returns {{ lat, lon, altitudeFt, progressFraction, phase, source }}
 */
export function estimatePosition(flightNumber, departureTime = null) {
  return new DeadReckoningService(flightNumber, departureTime).estimate()
}
