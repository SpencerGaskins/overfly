import { useState, useEffect } from 'react'
import { prefetchRoutePOIs } from '../services/poiEngine'
import { fetchPIREPs, buildTurbulenceHook, classifyTurbulence } from '../services/noaaWeather'
import { fetchDestinationWeather } from '../services/destinationWeather'
import { fetchRouteBundle, corridorId } from '../services/routeBundle'
import { submitAnxietyProfile } from '../services/flyrepService'
import waypointData from '../data/waypoints SEA DEN.json'
import { ROUTE_SEA_DEN } from '../data/routes'
import './FlightBriefing.css'

// ── Anxiety profile options ────────────────────────────────────────

const TURBULENCE_SENSITIVITY = [
  {
    value: 'calm',
    icon: '😌',
    label: 'Doesn\'t bother me',
    sub: 'I barely notice bumps',
  },
  {
    value: 'aware',
    icon: '🙂',
    label: 'Aware but fine',
    sub: 'I notice it, but it\'s okay',
  },
  {
    value: 'anxious',
    icon: '😬',
    label: 'Makes me nervous',
    sub: 'I\'d like a heads-up before it hits',
  },
  {
    value: 'avoidant',
    icon: '😰',
    label: 'Really stresses me out',
    sub: 'I need context and reassurance',
  },
]

const CURIOSITY_STYLE = [
  {
    value: 'storyteller',
    icon: '📖',
    label: 'Tell me the story',
    sub: 'History, drama, human interest',
  },
  {
    value: 'scientist',
    icon: '🔬',
    label: 'Explain the science',
    sub: 'Geology, physics, how things work',
  },
  {
    value: 'explorer',
    icon: '🗺️',
    label: 'What\'s down there?',
    sub: 'Geography, landmarks, what to look for',
  },
  {
    value: 'mixed',
    icon: '✨',
    label: 'Surprise me',
    sub: 'Whatever\'s most interesting',
  },
]

const LOADING_MESSAGES = [
  "Polishing the windows...",
  "Bribing the weather gods...",
  "Consulting the geology...",
  "Waking up the historians...",
  "Scanning for interesting things...",
  "Sacrificing a chicken to the NOAA servers...",
  "Asking Wikipedia nicely...",
  "Calculating what's below you...",
  "Dusting off the atlas...",
  "Checking pilot reports...",
]

export default function FlightBriefing({ flight, onReady }) {
  const { flightNumber, seatSide } = flight

  // ── Screen flow: 'profile' → 'loading' → 'briefing' ──────────
  const [screen, setScreen]           = useState('profile')
  const [anxietyProfile, setAnxietyProfile] = useState({
    turbulenceSensitivity: null,
    curiosityStyle: null,
  })
  // Stable session ID for this flight session
  const [sessionId] = useState(() =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  )

  const [progress, setProgress]       = useState(0)
  const [loadingMsg, setLoadingMsg]   = useState(LOADING_MESSAGES[0])
  const [briefing, setBriefing]       = useState(null)
  const [prefetchResult, setPrefetchResult] = useState(null)

  const curatedWaypoints = waypointData.waypoints.filter(wp =>
    wp.heading === 'eastbound' &&
    (wp.seatSide === 'both' || wp.seatSide === seatSide || wp.seatSide === 'A')
  )

  // Cycle loading messages
  useEffect(() => {
    if (briefing) return
    const interval = setInterval(() => {
      setLoadingMsg(LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)])
    }, 2000)
    return () => clearInterval(interval)
  }, [briefing])

  // Run prefetch and build briefing — only starts after profile screen
  // Phase 1: Fast — resolve hooks + PIREPs → show briefing
  // Phase 2: Background — Wikipedia POIs → populate map silently
  useEffect(() => {
    if (screen !== 'loading') return
    async function loadFast() {
      try {
        // ── Try bundle first (fast path — pre-built S3 JSON) ──────
        let resolvedCurated = curatedWaypoints
        let wikiPOIs = []
        let bundleLoaded = false

        try {
          const bundle = await fetchRouteBundle(corridorId('KSEA', 'KDEN'))
          // Bundle has pre-resolved hooks and Wikipedia POIs — use them directly
          resolvedCurated = bundle.waypoints.filter(wp =>
            wp.heading === 'eastbound' &&
            (wp.seatSide === 'both' || wp.seatSide === seatSide || wp.seatSide === 'A')
          )
          wikiPOIs = bundle.wikipedia_pois || []
          bundleLoaded = true
          console.log(`[briefing] Bundle loaded — ${wikiPOIs.length} wiki POIs, no prefetch needed`)
        } catch (bundleErr) {
          // Bundle not available yet (first deploy, or Lambda hasn't run)
          // Fall back to client-side resolution
          console.warn('[briefing] Bundle unavailable, falling back to client-side prefetch:', bundleErr.message)
        }

        // ── If no bundle, resolve hooks client-side ───────────────
        if (!bundleLoaded) {
          resolvedCurated = await Promise.all(
            curatedWaypoints.map(async wp => {
              if (!wp.hook?.includes('DYNAMIC')) return wp
              try {
                const pireps = await fetchPIREPs(wp.lat, wp.lon, 150, 3)
                return { ...wp, hook: buildTurbulenceHook(pireps, 0, anxietyProfile.turbulenceSensitivity), _pirepResolved: true }
              } catch {
                return { ...wp, hook: buildTurbulenceHook([], 0, anxietyProfile.turbulenceSensitivity) }
              }
            })
          )
        }

        // ── Turbulence summary + destination weather (always live) ─
        let turbSummary = []
        try { turbSummary = await buildTurbulenceSummary(anxietyProfile.turbulenceSensitivity) } catch {}

        let destWeather = null
        try { destWeather = await fetchDestinationWeather('KDEN') } catch {}

        // Show briefing immediately
        const highlights = resolvedCurated.filter(wp => wp.priority <= 2).slice(0, 4)
        setBriefing({ turbSummary, highlights, destWeather })
        setPrefetchResult({ wikiPOIs, resolvedCurated, anxietyProfile, sessionId })

        // ── If no bundle, load Wikipedia in background ────────────
        if (!bundleLoaded) {
          loadWikipediaBackground(resolvedCurated)
        }

      } catch (e) {
        console.error('Briefing load failed:', e)
        setBriefing({ turbSummary: [], highlights: [] })
        setPrefetchResult({ wikiPOIs: [], resolvedCurated: curatedWaypoints, anxietyProfile, sessionId })
      }
    }

    async function loadWikipediaBackground(resolvedCurated) {
      try {
        const { wikiPOIs } = await prefetchRoutePOIs(resolvedCurated, ROUTE_SEA_DEN, setProgress)
        // Update prefetch result with Wikipedia POIs
        setPrefetchResult(prev => ({ ...prev, wikiPOIs }))
      } catch (e) {
        console.warn('Wikipedia background load failed:', e)
      }
    }

    loadFast()
  }, [screen])  // fires when screen transitions to 'loading'

  async function buildTurbulenceSummary(anxietyLevel = 'aware') {
    const zones = []
    // Sample key route points for turbulence
    const checkPoints = [
      { name: 'Cascades', lat: 47.20, lon: -119.32, levelFt: 18000 },
      { name: 'Snake River Plain', lat: 43.51, lon: -112.07, levelFt: 33000 },
      { name: 'Laramie Basin', lat: 41.31, lon: -105.59, levelFt: 33000 },
      { name: 'Front Range', lat: 40.20, lon: -105.10, levelFt: 24000 },
    ]
    for (const pt of checkPoints) {
      try {
        const pireps = await fetchPIREPs(pt.lat, pt.lon, 150, 3)
        const turbPireps = pireps.filter(p => p.tbInt1 && p.tbInt1 !== '' && p.tbInt1 !== 'NEG' && p.tbInt1 !== 'NONE')
        if (turbPireps.length > 0) {
          const intensity = classifyTurbulence(turbPireps)
          if (intensity !== 'none') {
            zones.push({ name: pt.name, intensity, count: turbPireps.length, anxietyLevel })
          }
        }
      } catch { /* silent */ }
    }
    return zones
  }


  // Helper: Generate anxiety-aware turbulence description
  function getTurbulenceDescription(intensity, anxietyLevel) {
    const descriptions = {
      light: {
        calm: 'Light turbulence',
        aware: 'Light turbulence',
        anxious: 'Light turbulence — you\'ll barely feel it',
        avoidant: 'Light turbulence — barely noticeable',  // won't be shown, but just in case
      },
      moderate: {
        calm: 'Moderate turbulence',
        aware: 'Moderate turbulence',
        anxious: 'Moderate turbulence — uncomfortable but completely safe',
        avoidant: 'Moderate turbulence',  // won't be shown, but just in case
      },
      severe: {
        calm: 'Significant turbulence',
        aware: 'Significant turbulence',
        anxious: 'Significant turbulence — the crew has done this hundreds of times',
        avoidant: 'Significant turbulence',  // won't be shown, but just in case
      },
    }
    return descriptions[intensity]?.[anxietyLevel] || descriptions[intensity]?.aware || 'Turbulence'
  }

  function handleStart() {
    onReady(prefetchResult)
  }

  function handleProfileContinue() {
    setScreen('loading')
    // Fire-and-forget — non-blocking, non-fatal
    submitAnxietyProfile({
      session_id:              sessionId,
      flight_number:           flightNumber,
      seat_side:               seatSide,
      turbulence_sensitivity:  anxietyProfile.turbulenceSensitivity,
      curiosity_style:         anxietyProfile.curiosityStyle,
    })
  }

  function handleProfileSkip() {
    setAnxietyProfile({ turbulenceSensitivity: 'mixed', curiosityStyle: 'mixed' })
    setScreen('loading')
    // Don't submit a profile for skipped sessions
  }

  const profileComplete =
    anxietyProfile.turbulenceSensitivity !== null &&
    anxietyProfile.curiosityStyle !== null

  const seatLabel = seatSide === 'A' ? 'Left (A/B)' : 'Right (C/D)'
  const seatAdvantage = seatSide === 'A'
    ? 'Rainier, Hanford, and the Snake River Plain'
    : 'Mt. Adams, the Oregon high desert, and the Rockies on climbout'

  return (
    <div className="briefing">
      <div className="briefing-header">
        <div className="briefing-flight">
          <span className="briefing-fn">{flightNumber}</span>
          <span className="briefing-route">SEA → DEN</span>
        </div>
        <div className="briefing-seat">Seat: {seatLabel}</div>
      </div>

      {/* ── Anxiety profile screen ─────────────────────────────── */}
      {screen === 'profile' && (
        <div className="anxiety-screen">
          <div className="anxiety-intro">
            <span className="anxiety-intro-icon">✈</span>
            <h2 className="anxiety-intro-title">Quick setup</h2>
            <p className="anxiety-intro-sub">
              Two questions so the guide knows how to talk to you.
            </p>
          </div>

          {/* Q1: Turbulence sensitivity */}
          <div className="anxiety-question">
            <div className="anxiety-question-label">Question 1 of 2</div>
            <p className="anxiety-question-text">How do you feel about turbulence?</p>
            <div className="anxiety-options">
              {TURBULENCE_SENSITIVITY.map(opt => (
                <button
                  key={opt.value}
                  className={`anxiety-opt${anxietyProfile.turbulenceSensitivity === opt.value ? ' anxiety-opt--selected' : ''}`}
                  onClick={() => setAnxietyProfile(p => ({ ...p, turbulenceSensitivity: opt.value }))}
                >
                  <span className="anxiety-opt-icon">{opt.icon}</span>
                  <span className="anxiety-opt-text">
                    <span className="anxiety-opt-label">{opt.label}</span>
                    <span className="anxiety-opt-sub">{opt.sub}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Q2: Curiosity style */}
          <div className="anxiety-question">
            <div className="anxiety-question-label">Question 2 of 2</div>
            <p className="anxiety-question-text">What kind of guide do you want?</p>
            <div className="anxiety-options">
              {CURIOSITY_STYLE.map(opt => (
                <button
                  key={opt.value}
                  className={`anxiety-opt${anxietyProfile.curiosityStyle === opt.value ? ' anxiety-opt--selected' : ''}`}
                  onClick={() => setAnxietyProfile(p => ({ ...p, curiosityStyle: opt.value }))}
                >
                  <span className="anxiety-opt-icon">{opt.icon}</span>
                  <span className="anxiety-opt-text">
                    <span className="anxiety-opt-label">{opt.label}</span>
                    <span className="anxiety-opt-sub">{opt.sub}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <button
            className="anxiety-continue-btn"
            onClick={handleProfileContinue}
            disabled={!profileComplete}
          >
            Prepare my briefing →
          </button>

          <div className="anxiety-skip">
            <button className="anxiety-skip-btn" onClick={handleProfileSkip}>
              Skip — just show me the map
            </button>
          </div>
        </div>
      )}

      {/* ── Loading screen ─────────────────────────────────────── */}
      {screen === 'loading' && !briefing && (
        <div className="briefing-loading">
          <div className="briefing-spinner">✈</div>
          <p className="briefing-loading-msg">Preparing your flight briefing...</p>
        </div>
      )}

      {/* ── Briefing screen ────────────────────────────────────── */}
      {screen === 'loading' && briefing && (
        <div className="briefing-content">
          <h2 className="briefing-title">✈ Flight Briefing</h2>

          {/* Seat advantage */}
          <div className="briefing-card">
            <div className="briefing-card-label">YOUR VIEW TODAY</div>
            <p className="briefing-card-text">
              {seatLabel} seat gets {seatAdvantage} on this route.
            </p>
          </div>

          {/* Destination weather */}
          {briefing.destWeather?.summary && (
            <div className={`briefing-card briefing-dest-${briefing.destWeather.summary.severity}`}>
              <div className="briefing-card-label">DESTINATION WEATHER</div>
              <p className="briefing-card-text">{briefing.destWeather.summary.hook}</p>
            </div>
          )}

          {/* Turbulence summary — filtered by anxiety profile */}
          {(() => {
            const sensitivity = anxietyProfile.turbulenceSensitivity

            // avoidant: never show zone details, but acknowledge bumps if they exist
            if (sensitivity === 'avoidant') {
              if (briefing.turbSummary.length === 0) return null
              return (
                <div className="briefing-card">
                  <div className="briefing-card-label">TURBULENCE OUTLOOK</div>
                  <p className="briefing-card-text briefing-smooth">
                    There are some reports of bumps along the route. We'll let you know when we're getting close — nothing to worry about right now.
                  </p>
                </div>
              )
            }

            // anxious: only show severe zones — suppress moderate/light to avoid pre-flight dread
            const visibleZones = sensitivity === 'anxious'
              ? briefing.turbSummary.filter(z => z.intensity === 'severe')
              : briefing.turbSummary

            // anxious with no severe zones — soft acknowledgment if bumps exist
            if (sensitivity === 'anxious' && visibleZones.length === 0) {
              const hasBumps = briefing.turbSummary.length > 0
              return (
                <div className="briefing-card">
                  <div className="briefing-card-label">TURBULENCE OUTLOOK</div>
                  <p className="briefing-card-text briefing-smooth">
                    {hasBumps
                      ? "There are some reports of bumps along the route. We'll give you a heads up when we're getting close — nothing you need to think about now."
                      : '✓ Smooth air expected on this route. The crew will let you know if anything changes.'
                    }
                  </p>
                </div>
              )
            }

            // calm / aware: show all zones with full detail
            return (
              <div className="briefing-card">
                <div className="briefing-card-label">TURBULENCE OUTLOOK</div>
                {visibleZones.length === 0 ? (
                  <p className="briefing-card-text briefing-smooth">
                    ✓ Smooth air reported along the route. No significant turbulence in recent pilot reports.
                  </p>
                ) : (
                  visibleZones.map((zone, i) => (
                    <div key={i} className={`briefing-turb briefing-turb-${zone.intensity}`}>
                      <span className="briefing-turb-zone">{zone.name}</span>
                      <span className="briefing-turb-intensity">
                        {getTurbulenceDescription(zone.intensity, sensitivity)}
                        <span className="briefing-turb-count"> · {zone.count} pilot report{zone.count > 1 ? 's' : ''}</span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            )
          })()}

          {/* Highlights */}
          {briefing.highlights.length > 0 && (
            <div className="briefing-card">
              <div className="briefing-card-label">WHAT TO LOOK FOR</div>
              {briefing.highlights.map((wp, i) => (
                <div key={i} className="briefing-highlight">
                  <span className="briefing-highlight-name">{wp.name}</span>
                  <p className="briefing-highlight-hook">
                    {wp.hook.split('.')[0]}.
                  </p>
                </div>
              ))}
            </div>
          )}

          <button className="briefing-start-btn" onClick={handleStart}>
            Start flight →
          </button>
        </div>
      )}
    </div>
  )
}
