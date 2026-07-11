/**
 * FlightLevel POI Engine
 *
 * Two-layer POI system:
 *   Layer 1 — Curated waypoints (guaranteed, hand-written hooks, pre-resolved)
 *   Layer 2 — Wikipedia POIs (dynamic, randomized, geofenced)
 *
 * Interrupt tiers (highest to lowest):
 *   safety    — turbulence alerts, always from top, never blocked
 *   immediate — priority 1 POIs, break through active conversation
 *   queue     — standard POIs, wait for conversation to end
 */

import { queryWikipediaPOIs, filterPOIs } from './wikipediaPOI'
import { fetchPIREPs, buildTurbulenceHook } from './noaaWeather'

// ── Constants ─────────────────────────────────────────────────────
const WIKI_QUERY_RADIUS_M = 10000
const WIKI_QUERY_LIMIT    = 20
const WIKI_QUERY_DELAY_MS = 150
const VISIBLE_RADIUS_MILES = {
  0:     5,
  8000:  30,
  18000: 80,
  28000: 120,
  35000: 150,
}

// ── Haversine distance ────────────────────────────────────────────
export function distanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
    Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

// ── Visible radius at altitude ────────────────────────────────────
export function visibleRadiusMiles(altitudeFt) {
  const levels = Object.keys(VISIBLE_RADIUS_MILES).map(Number).sort((a,b) => b-a)
  for (const level of levels) {
    if (altitudeFt >= level) return VISIBLE_RADIUS_MILES[level]
  }
  return 5
}

// ── Prefetch: resolve dynamic hooks + Wikipedia POIs ─────────────
export async function prefetchRoutePOIs(curatedWaypoints, routePoints, onProgress) {
  const seen = new Set()
  const wikiPOIs = []

  // Step 1 (10%) — Pre-resolve dynamic hooks on curated waypoints
  const resolvedCurated = await Promise.all(
    curatedWaypoints.map(async wp => {
      if (!wp.hook?.includes('DYNAMIC')) return wp
      try {
        const pireps = await fetchPIREPs(wp.lat, wp.lon, 150, 3)
        const hook = buildTurbulenceHook(pireps, 0)
        console.log(`Pre-resolved ${wp.name}: "${hook.substring(0, 60)}..."`)
        return { ...wp, hook, _pirepResolved: true, _pireps: pireps }
      } catch {
        return { ...wp, hook: buildTurbulenceHook([], 0) }
      }
    })
  )
  if (onProgress) onProgress(10)

  // Step 2 (10-100%) — Wikipedia POIs along route
  // Sample every 3rd point, 5-point cross pattern, 50ms delay
  const sampledPoints = routePoints.filter((_, i) => i % 2 === 0)
  const offsets = [[0,0],[0.3,0],[-0.3,0],[0,0.5],[0,-0.5]]

  // Process in batches of 3 route points in parallel
  const BATCH_SIZE = 3
  for (let b = 0; b < sampledPoints.length; b += BATCH_SIZE) {
    const batch = sampledPoints.slice(b, b + BATCH_SIZE)
    await Promise.all(batch.map(async ([lat, lon]) => {
      for (const [dlat, dlon] of offsets) {
        const pois = await queryWikipediaPOIs(
          lat + dlat, lon + dlon,
          WIKI_QUERY_RADIUS_M,
          WIKI_QUERY_LIMIT
        )
        for (const poi of pois) {
          if (!seen.has(poi.pageid)) {
            seen.add(poi.pageid)
            wikiPOIs.push({ ...poi, source: 'wikipedia', interruptBehavior: 'queue', priority: 3 })
          }
        }
        await new Promise(r => setTimeout(r, 50))
      }
    }))
    if (onProgress) onProgress(10 + Math.round((b + BATCH_SIZE) / sampledPoints.length * 90))
  }

  return { wikiPOIs: filterPOIs(wikiPOIs), resolvedCurated }
}

// ── POI Engine ────────────────────────────────────────────────────
export class POIEngine {
  constructor(curatedWaypoints, wikipediaPOIs, seatSide) {
    this.curated    = curatedWaypoints  // pre-resolved hooks
    this.wikipedia  = wikipediaPOIs
    this.seatSide   = seatSide
    this.triggered  = new Set()
    this.queue      = []
    this.active     = null        // current POI card (bottom)
    this.turbAlert  = null        // current turbulence alert (top)
    this.conversing = false
    this._dismissedTurbAt = null  // { lat, lon } where user dismissed — suppress until past
  }

  // ── Main update — call on every position change ───────────────
  update(lat, lon, altitudeFt, heading) {
    const newPOIs = []

    // Layer 1: Curated waypoints (hooks already resolved at prefetch)
    //
    // Content Architecture spec distinguishes two fundamentally different POI types:
    //   - Landmark/Unknown Known (Category 3): needs visual confirmation, altitude-gated.
    //     radiusMiles should reflect actual physical visibility/scale of the feature.
    //   - History/Legend (Category 1): "no expiry, always valid" — the story's value does
    //     NOT depend on the passenger seeing anything. A ghost town's outlaw history is
    //     just as compelling whether or not you could ever spot the town itself.
    //     These are NOT altitude/visibility-capped — only requiresVisualConfirmation POIs are.
    const altitudeCeilingMiles = visibleRadiusMiles(altitudeFt)
    for (const wp of this.curated) {
      if (this.triggered.has(wp.id)) continue
      if (wp.heading && wp.heading !== heading) continue
      if (wp.seatSide !== 'both' && wp.seatSide !== this.seatSide) continue

      // Only cap radius by physical visibility if this POI explicitly requires it
      // (landmark-type content). History/legend content uses its own radius uncapped.
      const effectiveRadius = wp.requiresVisualConfirmation
        ? Math.min(wp.radiusMiles, altitudeCeilingMiles)
        : wp.radiusMiles

      const dist = distanceMiles(lat, lon, wp.lat, wp.lon)
      if (dist <= effectiveRadius &&
          altitudeFt >= wp.altitudeWindowFt[0] &&
          altitudeFt <= wp.altitudeWindowFt[1]) {
        newPOIs.push({ ...wp })
      }
    }

    // Layer 2: Wikipedia POIs — only surface those AHEAD of the aircraft
    const visRadius = visibleRadiusMiles(altitudeFt)
    const wikiInRange = this.wikipedia.filter(poi => {
      if (this.triggered.has(poi.pageid)) return false
      const dist = distanceMiles(lat, lon, poi.lat, poi.lon)
      if (dist > visRadius) return false
      // Only surface POIs that are ahead (east of current position for SEA-DEN)
      // Use a small buffer so POIs directly alongside also fire
      if (poi.lon !== undefined && poi.lon < lon - 0.5) return false  // behind — skip
      return true
    })
    if (wikiInRange.length > 0) {
      const pick = wikiInRange[Math.floor(Math.random() * wikiInRange.length)]
      newPOIs.push(pick)
    }

    // Surface or queue
    for (const poi of newPOIs) {
      const id = poi.id || poi.pageid
      if (this.triggered.has(id)) continue
      this.triggered.add(id)
      this._surface(poi)
    }
  }

  // ── Continuous PIREP lookahead — call every 30s ───────────────
  async checkTurbulenceAhead(lat, lon, altitudeFt, routePoints, currentStep, anxietyLevel = 'aware') {
    // Always scan 150nm ahead to reliably detect turbulence
    // But only SURFACE the alert when within the profile's notify window
    // This prevents anxious passengers from having a 10-minute dread window
    const NOTIFY_WINDOW_BY_PROFILE = {
      calm:     100,  // ~10 min — practical heads-up, restroom window
      aware:    75,   // ~7 min — good lead time
      anxious:  40,   // ~4 min — enough to buckle, not enough to spiral
      avoidant: 25,   // ~2.5 min — just before it hits
    }
    const SCAN_NM    = 150
    const NOTIFY_NM  = NOTIFY_WINDOW_BY_PROFILE[anxietyLevel] || 75
    const lookahead = routePoints.slice(currentStep + 1, currentStep + 6)
    if (!lookahead.length) return

    for (const [wlat, wlon] of lookahead) {
      const dist = distanceMiles(lat, lon, wlat, wlon)
      if (dist > SCAN_NM) continue  // beyond scan range — skip
      try {
        const pireps = await fetchPIREPs(wlat, wlon, 150, 2)  // wider radius — sparse route points
        const turbPireps = pireps.filter(p => {
          if (!p.tbInt1 || p.tbInt1 === '' || p.tbInt1 === 'NEG' || p.tbInt1 === 'NONE') return false
          // Filter to PIREPs within ±8,000 ft of current altitude
          // fltLvl is in hundreds of feet (e.g. 350 = FL350 = 35,000 ft)
          if (p.fltLvl != null && altitudeFt > 0) {
            const pirepAltFt = p.fltLvl * 100
            if (Math.abs(pirepAltFt - altitudeFt) > 8000) return false
          }
          return true
        })
        if (turbPireps.length > 0) {
          const intensity = this._classifyFromPireps(turbPireps)
          if (dist <= NOTIFY_NM) {
            // Check if user already dismissed an alert for this zone
            if (this._dismissedTurbAt !== null && this._dismissedTurbAt !== undefined) {
              const prevDist = this._dismissedTurbAt.distanceNm
              if (dist < 5) {
                this._dismissedTurbAt = null  // passed through — reset
              } else if (dist <= prevDist + 30) {
                return  // still approaching same zone — stay quiet
              }
            }
            const hook = buildTurbulenceHook(turbPireps, dist, anxietyLevel)
            this.turbAlert = { intensity, distanceNm: Math.round(dist * 1.15), hook, timestamp: Date.now() }
          }
          return
        }
      } catch { /* silent */ }
    }
    // No turbulence found ahead — clear alert if it's old
    if (this.turbAlert && Date.now() - this.turbAlert.timestamp > 300000) {
      this.turbAlert = null
    }
  }

  _classifyFromPireps(pireps) {
    const max = Math.max(...pireps.map(p => {
      const t = (p.tbInt1 || '').toUpperCase()
      if (t.includes('SEV') || t.includes('EXTM')) return 3
      if (t.includes('MOD')) return 2
      if (t.includes('LGT')) return 1
      return 0
    }))
    if (max >= 3) return 'severe'
    if (max >= 2) return 'moderate'
    if (max >= 1) return 'light'
    return 'none'
  }

  clearTurbAlert() {
    // Record where the user dismissed so we don't re-surface the same zone
    if (this.turbAlert) {
      this._dismissedTurbAt = { distanceNm: this.turbAlert.distanceNm }
    }
    this.turbAlert = null
    // Ensure field exists even on old instances (hot-reload safe)
    if (this._dismissedTurbAt === undefined) this._dismissedTurbAt = null
  }

  getTurbAlert() {
    return this.turbAlert
  }

  // ── Conversation state ────────────────────────────────────────
  startConversation() {
    this.conversing = true
  }

  endConversation() {
    this.conversing = false
    this.active = null
    this._drainQueue()
  }

  getActive()      { return this.active }
  getQueueLength() { return this.queue.length }

  // ── Internal ──────────────────────────────────────────────────
  // Tier rank — higher number always outranks lower, regardless of order fired
  _tierRank(poi) {
    if (poi.tier === 'premium') return 3
    if (poi.source !== 'wikipedia') return 2   // regular curated waypoint
    return 1                                    // wikipedia
  }

  _surface(poi) {
    // No active POI yet — just take it
    if (!this.active) {
      if (!this.conversing) { this.active = poi; return }
      this.queue.push(poi)
      return
    }

    // Something is already active — apply strict tier precedence:
    // premium > regular curated > wikipedia. Priority 1 always breaks through
    // instantly regardless of tier (safety/highest-priority curated content).
    const incomingRank = this._tierRank(poi)
    const activeRank    = this._tierRank(this.active)

    const shouldReplace =
      poi.priority === 1 ||
      incomingRank > activeRank

    // IMPORTANT: never mutate `this.active` while a conversation is in progress.
    // The conversation modal already took its own snapshot of the POI it's
    // discussing — but endConversation() unconditionally nulls `this.active`
    // and promotes from `this.queue`. If we overwrote `this.active` directly
    // here instead of queueing, a higher-tier POI that arrives mid-conversation
    // gets silently discarded when the conversation ends (it was never queued,
    // so drainQueue has nothing to promote) and it's already marked `triggered`,
    // so it never fires again. This is the root cause of "premium POI never
    // fires" when a lower-tier POI got there first and the user opened it.
    if (this.conversing) {
      if (shouldReplace) {
        this.queue.unshift(poi)  // jump the line — next thing shown when chat closes
      } else {
        this.queue.push(poi)
      }
      return
    }

    if (shouldReplace) {
      this.active = poi
      return
    }
    // lower-tier POI while idle — drop it, don't overwrite
  }

  _drainQueue() {
    if (this.queue.length > 0 && !this.conversing) {
      this.active = this.queue.shift()
    }
  }
}
