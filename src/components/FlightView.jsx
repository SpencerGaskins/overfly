import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import waypointData from '../data/waypoints SEA DEN.json'
import { filterPOIs } from '../services/wikipediaPOI'
import { POIEngine, prefetchRoutePOIs, distanceMiles } from '../services/poiEngine'
import { ROUTE_SEA_DEN } from '../data/routes'
import { submitFlyrep } from '../services/flyrepService'
import { LiveTrackService } from '../services/liveTrackService'
import { DeadReckoningService } from '../services/deadReckoning'
import ConversationPanel from './ConversationPanel'
import LiveFlightPicker from './LiveFlightPicker'
import './FlightView.css'

// Route imported from shared routes.js

// Fix Leaflet default icon issue with Vite
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// Icons
const aircraftIcon = L.divIcon({
  className: '',
  html: `<div style="font-size:24px;transform:rotate(90deg);filter:drop-shadow(0 0 4px #7eb8f7)">✈</div>`,
  iconSize: [28, 28], iconAnchor: [14, 14],
})

const waypointIcon = (priority) => L.divIcon({
  className: '',
  html: `<div style="
    width:10px;height:10px;border-radius:50%;
    background:${priority === 1 ? '#f87171' : priority === 2 ? '#fbbf24' : '#6b7a99'};
    border:2px solid rgba(255,255,255,0.3);
    box-shadow:0 0 6px ${priority === 1 ? '#f87171' : '#fbbf24'}
  "></div>`,
  iconSize: [10, 10], iconAnchor: [5, 5],
})

const wikiIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:7px;height:7px;border-radius:50%;
    background:#a78bfa;opacity:0.7;
    border:1px solid rgba(255,255,255,0.2);
  "></div>`,
  iconSize: [7, 7], iconAnchor: [3, 3],
})

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
function MapFollower({ position }) {
  const map = useMap()
  useEffect(() => {
    if (position) map.panTo(position, { animate: true, duration: 1 })
  }, [position, map])
  return null
}

export default function FlightView({ flight, prefetchResult, onExit }) {
  const { flightNumber, seatSide } = flight

  // Extract anxiety profile passed from briefing
  const anxietyLevel = prefetchResult?.anxietyProfile?.turbulenceSensitivity || 'aware'

  const [position, setPosition]       = useState(ROUTE_SEA_DEN[0])
  const [altitudeFt, setAltitudeFt]   = useState(0)
  const [simStep, setSimStep]         = useState(0)
  const [isSimulating, setIsSimulating] = useState(false)

  const engineRef   = useRef(null)
  const [activePOI, setActivePOI]     = useState(null)
  const [queueLen, setQueueLen]       = useState(0)
  const [wikiPOIs, setWikiPOIs]       = useState([])
  const [turbAlert, setTurbAlert]     = useState(null)
  const [prefetchProgress, setPrefetchProgress] = useState(null)
  const [loadingMsg, setLoadingMsg]   = useState(LOADING_MESSAGES[0])

  // FLYREP state
  const [flyrepOpen, setFlyrepOpen]       = useState(false)
  const [flyrepStatus, setFlyrepStatus]   = useState(null) // null | 'submitting' | 'ok' | 'err'
  const sessionId = prefetchResult?.sessionId || null

  // Conversation state
  const [convOpen, setConvOpen]           = useState(false)
  const [convPOI, setConvPOI]             = useState(null)

  // Live tracking state
  const [showPicker, setShowPicker]       = useState(false)
  const [liveTracking, setLiveTracking]   = useState(false)
  const [liveCallsign, setLiveCallsign]   = useState(null)
  const [liveStale, setLiveStale]         = useState(false)
  const [flownPath, setFlownPath]         = useState([])
  const trackerRef = useRef(null)

  // Dead reckoning — used as position source when not simulating or live tracking
  const drRef = useRef(null)

  const curatedWaypoints = waypointData.waypoints.filter(wp =>
    wp.heading === 'eastbound' &&
    (wp.seatSide === 'both' || wp.seatSide === seatSide || wp.seatSide === 'A')
  )

  // ── Initialize engine from pre-fetched briefing result ────────
  useEffect(() => {
    // Initialize dead reckoning for this flight
    // departureTime unknown at this point — DR will assume ~30 min elapsed
    // (good enough for demo; production would pass scheduled departure from FlightAware)
    drRef.current = new DeadReckoningService(flightNumber)
    const drPos = drRef.current.estimate()
    // Only use DR position if it looks reasonable (not at origin/destination)
    if (drPos.progressFraction > 0.05 && drPos.progressFraction < 0.95) {
      setPosition([drPos.lat, drPos.lon])
      setAltitudeFt(drPos.altitudeFt)
      console.log(`[DR] Initial position: ${drPos.lat.toFixed(3)}, ${drPos.lon.toFixed(3)} — ${drPos.phase} (${Math.round(drPos.progressFraction * 100)}% along route)`)
    }

    if (prefetchResult) {
      const { wikiPOIs: wiki, resolvedCurated } = prefetchResult
      setWikiPOIs(wiki)
      engineRef.current = new POIEngine(resolvedCurated, wiki, seatSide)
    } else {
      // Fallback if arriving without briefing
      setPrefetchProgress(0)
      prefetchRoutePOIs(curatedWaypoints, ROUTE_SEA_DEN, setPrefetchProgress)
        .then(({ wikiPOIs: wiki, resolvedCurated }) => {
          setWikiPOIs(wiki)
          setPrefetchProgress(null)
          engineRef.current = new POIEngine(resolvedCurated, wiki, seatSide)
        })
    }
  }, [])

  // Cycle loading messages (fallback only)
  useEffect(() => {
    if (prefetchProgress === null) return
    const interval = setInterval(() => {
      setLoadingMsg(LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)])
    }, 2000)
    return () => clearInterval(interval)
  }, [prefetchProgress])

  // ── Dead reckoning position updates ──────────────────────────
  // Polls every 30s while not simulating and not live tracking.
  // Moves the aircraft smoothly along the route based on elapsed time.
  useEffect(() => {
    if (isSimulating || liveTracking || !drRef.current) return
    const interval = setInterval(() => {
      const pos = drRef.current.estimate()
      if (pos.progressFraction > 0.01 && pos.progressFraction < 0.99 && !pos.isLanded) {
        setPosition([pos.lat, pos.lon])
        setAltitudeFt(pos.altitudeFt)
      }
    }, 30000)  // every 30s — DR accuracy doesn't warrant faster updates
    return () => clearInterval(interval)
  }, [isSimulating, liveTracking])

  // ── Simulation ─────────────────────────────────────────────────
  function stepForward() {
    setSimStep(s => {
      const next = s + 1
      if (next >= ROUTE_SEA_DEN.length) { setIsSimulating(false); return s }
      const [lat, lon] = ROUTE_SEA_DEN[next]
      setPosition([lat, lon])
      setAltitudeFt(next === 0 ? 0 : next === ROUTE_SEA_DEN.length - 1 ? 5000 : 33000)
      return next
    })
  }

  useEffect(() => {
    if (!isSimulating) return
    const interval = setInterval(stepForward, 8000)
    return () => clearInterval(interval)
  }, [isSimulating])

  // ── Continuous PIREP lookahead every 30s ──────────────────────
  useEffect(() => {
    if (!engineRef.current) return
    const check = async () => {
      await engineRef.current.checkTurbulenceAhead(
        position[0], position[1], altitudeFt, ROUTE_SEA_DEN, simStep, anxietyLevel
      )
      setTurbAlert(engineRef.current.getTurbAlert()
        ? { ...engineRef.current.getTurbAlert() } : null)
    }
    check() // immediate check on every position/step change
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [position, altitudeFt, simStep, anxietyLevel])
  // ── Dynamic POI loading — query Wikipedia around current position ────
  // Fires when aircraft moves >50nm from last query point
  const lastPoiQueryRef = useRef(null)

  useEffect(() => {
    if (!engineRef.current) return

    const [lat, lon] = position
    const lastQuery = lastPoiQueryRef.current

    // Check if we've moved far enough from last query to warrant a new one
    const distFromLastQuery = lastQuery
      ? distanceMiles(lat, lon, lastQuery.lat, lastQuery.lon)
      : Infinity

    if (distFromLastQuery < 50) return  // not far enough yet

    lastPoiQueryRef.current = { lat, lon }

    // Query Wikipedia POIs around current position + 150nm ahead on route
    // Find the next few route points ahead of current position
    const aheadPoints = ROUTE_SEA_DEN.filter(([wlat, wlon]) => {
      // Points ahead = further east (higher lon for SEA-DEN)
      return wlon > lon - 1.0
    }).slice(0, 5)

    const queryPoints = [[lat, lon], ...aheadPoints]

    import('../services/wikipediaPOI').then(({ queryWikipediaBBox, filterPOIs }) => {
      Promise.all(queryPoints.map(([qlat, qlon]) =>
        queryWikipediaBBox(qlat - 1.5, qlon - 1.5, qlat + 1.5, qlon + 1.5, 30)
          .catch(() => [])
      )).then(results => {
        const seen = new Set(wikiPOIs.map(p => p.pageid))
        const newPOIs = []
        for (const batch of results) {
          for (const poi of filterPOIs(batch)) {
            if (!seen.has(poi.pageid)) {
              seen.add(poi.pageid)
              newPOIs.push({ ...poi, source: 'wikipedia', interruptBehavior: 'queue', priority: 3 })
            }
          }
        }
        if (newPOIs.length > 0) {
          setWikiPOIs(prev => {
            const seenIds = new Set(prev.map(p => p.pageid))
            const deduped = newPOIs.filter(p => !seenIds.has(p.pageid))
            if (deduped.length === 0) return prev
            const combined = [...prev, ...deduped]
            if (engineRef.current) engineRef.current.wikipedia = combined
            return combined
          })
          console.log(`[poi] Loaded ${newPOIs.length} new POIs around ${lat.toFixed(2)}, ${lon.toFixed(2)}`)
        }
      })
    })
  }, [position])

  // ── POI engine update on every position change ────────────────
  useEffect(() => {
    if (!engineRef.current) return
    engineRef.current.update(position[0], position[1], altitudeFt, 'eastbound')
    setActivePOI(engineRef.current.getActive() ? { ...engineRef.current.getActive() } : null)
    setQueueLen(engineRef.current.getQueueLength())
    setTurbAlert(engineRef.current.getTurbAlert())
  }, [position, altitudeFt])

  // ── Live tracking ─────────────────────────────────────────────
  async function handleLiveSelect({ icao24, callsign, initialPosition }) {
    setShowPicker(false)
    setIsSimulating(false)

    // Apply initial position immediately from picker data
    setPosition([initialPosition.lat, initialPosition.lon])
    setAltitudeFt(initialPosition.altitudeFt || 33000)
    setLiveCallsign(callsign || icao24)
    setLiveTracking(true)
    setLiveStale(false)

    // Rebuild POI engine with only POIs ahead of starting position
    // Prevents all stale western POIs from firing during live session
    if (engineRef.current && initialPosition.lon) {
      const startLon = initialPosition.lon
      const aheadWiki = wikiPOIs.filter(poi => poi.lon >= startLon - 0.5)
      engineRef.current = new POIEngine(curatedWaypoints, aheadWiki, seatSide)
      setWikiPOIs(aheadWiki)
      console.log(`[live] Engine rebuilt with ${aheadWiki.length} POIs east of ${startLon.toFixed(2)}°`)
    }

    // Stop any existing tracker
    if (trackerRef.current) trackerRef.current.stop()

    // Create tracker and capture ref before async work
    const tracker = new LiveTrackService('SEA-DEN')
    trackerRef.current = tracker

    // Await follow so the initial poll + track fetch complete before interval starts
    await tracker.follow(icao24, (pos) => {
      // Guard: ignore callbacks if this tracker was replaced
      if (trackerRef.current !== tracker) return
      if (pos.onGround) return
      setPosition([pos.lat, pos.lon])
      setAltitudeFt(pos.altitudeFt || 33000)
      setLiveStale(pos.stale || false)
      if (!pos.stale && drRef.current) {
        drRef.current.anchor(pos.lat, pos.lon, pos.altitudeFt || 33000)
      }
      setFlownPath([...tracker.getFlownPath()])
    })

    // Update flown path after track fetch resolves
    setFlownPath([...tracker.getFlownPath()])
  }

  function stopLiveTracking() {
    trackerRef.current?.stop()
    setLiveTracking(false)
    setLiveCallsign(null)
    setLiveStale(false)
    setFlownPath([])
  }

  // Cleanup tracker on unmount
  useEffect(() => {
    return () => trackerRef.current?.stop()
  }, [])

  // ── Conversation handlers ──────────────────────────────────────
  function handlePOIOpen() {
    engineRef.current?.startConversation()
  }

  function handlePOIClose() {
    engineRef.current?.endConversation()
    const next = engineRef.current?.getActive() || null
    setActivePOI(next ? { ...next } : null)
    setQueueLen(engineRef.current?.getQueueLength() || 0)
  }

  // ── FLYREP submission ──────────────────────────────────────────
  async function handleFlyrepSubmit(intensity, rawLabel) {
    setFlyrepOpen(false)
    setFlyrepStatus('submitting')
    const [lat, lon] = position
    const { error } = await submitFlyrep({
      flight_number: flightNumber,
      lat,
      lon,
      altitude_ft: altitudeFt,
      intensity,
      raw_label: rawLabel,
      ongoing: false,
      session_id: sessionId,
    })
    setFlyrepStatus(error ? 'err' : 'ok')
    setTimeout(() => setFlyrepStatus(null), 2500)
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="flight-view">
      {/* Header */}
      <div className="fv-header">
        <div className="fv-flight">
          <span className="fv-fn">{flightNumber}</span>
          <span className="fv-route">SEA → DEN</span>
        </div>
        <div className="fv-stats">
          <span>{Math.round(altitudeFt).toLocaleString()} ft</span>
          <span>Seat: {seatSide === 'A' ? 'Left' : 'Right'}</span>
          {queueLen > 0 && <span className="fv-queue">+{queueLen} queued</span>}
        </div>
        <button className="fv-exit" onClick={onExit}>✕</button>
      </div>

      {/* Prefetch progress bar */}
      {prefetchProgress !== null && (
        <div className="prefetch-bar">
          <div className="prefetch-fill" style={{ width: `${prefetchProgress}%` }} />
          <span className="prefetch-label">{loadingMsg} {prefetchProgress}%</span>
        </div>
      )}

      {/* Map */}
      <div className="fv-map">
        <MapContainer
          center={position}
          zoom={6}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          />
          <MapFollower position={position} />

          <Polyline
            positions={ROUTE_SEA_DEN}
            pathOptions={{ color: '#1e3a5f', weight: 2, dashArray: '6 4' }}
          />

          {/* Flown path — solid bright line showing actual track */}
          {flownPath.length > 1 && (
            <Polyline
              positions={flownPath}
              pathOptions={{ color: '#7eb8f7', weight: 2, opacity: 0.8 }}
            />
          )}

          {/* Wikipedia POIs — subtle dots */}
          {wikiPOIs.map(poi => (
            <Marker key={poi.pageid} position={[poi.lat, poi.lon]} icon={wikiIcon}
              eventHandlers={{ click: () => {
                setConvPOI(poi)
                setConvOpen(true)
                engineRef.current?.startConversation()
              }}}>
              <Popup className="wp-popup">
                <strong>{poi.title}</strong>
                <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: '#a78bfa', cursor: 'pointer' }}>
                  💬 Ask the guide →
                </p>
              </Popup>
            </Marker>
          ))}

          {/* Curated waypoints */}
          {curatedWaypoints.map(wp => (
            <Marker key={wp.id} position={[wp.lat, wp.lon]} icon={waypointIcon(wp.priority)}
              eventHandlers={{ click: () => {
                setConvPOI({ title: wp.name, extract: wp.hook, lat: wp.lat, lon: wp.lon, ...wp })
                setConvOpen(true)
                engineRef.current?.startConversation()
              }}}>
              <Popup className="wp-popup">
                <strong>{wp.name}</strong>
                <p>{wp.hook?.split('.')[0]}.</p>
                <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: '#7eb8f7', cursor: 'pointer' }}>
                  💬 Ask the guide →
                </p>
              </Popup>
            </Marker>
          ))}

          <Marker position={position} icon={aircraftIcon} />
        </MapContainer>
      </div>

      {/* Controls */}
      <div className="fv-controls">
        <button className="sim-btn" onClick={() => setIsSimulating(s => !s)}>
          {isSimulating ? '⏸ Pause' : '▶ Auto'}
        </button>
        <button className="sim-btn" onClick={() => { setIsSimulating(false); stepForward() }}>
          ⏭ Step
        </button>
        <button className="sim-btn" onClick={() => {
          setSimStep(0)
          setPosition(ROUTE_SEA_DEN[0])
          setAltitudeFt(0)
          setIsSimulating(false)
          stopLiveTracking()
          if (engineRef.current) {
            engineRef.current = new POIEngine(curatedWaypoints, wikiPOIs, seatSide)
          }
          setActivePOI(null)
          setQueueLen(0)
        }}>
          ↺ Reset
        </button>
        <button
          className={`sim-btn live-btn${liveTracking ? ' live-btn--active' : ''}`}
          onClick={() => liveTracking ? stopLiveTracking() : setShowPicker(true)}
          title="Follow a live flight"
        >
          {liveTracking ? '● Live' : '◎ Live'}
        </button>
        <button
          className={`sim-btn flyrep-btn${flyrepOpen ? ' flyrep-btn--active' : ''}`}
          onClick={() => setFlyrepOpen(o => !o)}
          title="Report turbulence"
        >
          〰 Report
        </button>
      </div>

      {/* FLYREP intensity picker */}
      {flyrepOpen && (
        <div className="flyrep-picker">
          <p className="flyrep-picker-label">How's the ride?</p>
          <div className="flyrep-options">
            <button className="flyrep-opt flyrep-lgt"
              onClick={() => handleFlyrepSubmit('lgt', 'Barely felt it')}>
              <span className="flyrep-opt-icon">〰️</span>
              <span>Barely felt it</span>
            </button>
            <button className="flyrep-opt flyrep-mod"
              onClick={() => handleFlyrepSubmit('mod', 'Noticeable bumps')}>
              <span className="flyrep-opt-icon">🌊</span>
              <span>Noticeable bumps</span>
            </button>
            <button className="flyrep-opt flyrep-sev"
              onClick={() => handleFlyrepSubmit('sev', 'Rough — hold on')}>
              <span className="flyrep-opt-icon">⚠️</span>
              <span>Rough — hold on</span>
            </button>
          </div>
          <button className="flyrep-cancel" onClick={() => setFlyrepOpen(false)}>Cancel</button>
        </div>
      )}

      {/* FLYREP toast */}
      {flyrepStatus && (
        <div className={`flyrep-toast flyrep-toast--${flyrepStatus}`}>
          {flyrepStatus === 'submitting' && '〰 Sending report…'}
          {flyrepStatus === 'ok'         && '✓ Turbulence reported — thanks'}
          {flyrepStatus === 'err'        && '✕ Couldn\'t send — try again'}
        </div>
      )}

      {/* Turbulence alert — safety tier, slides from top */}
      {turbAlert && (
        <div className={`turb-alert turb-alert-${turbAlert.intensity}`}>
          <div className="turb-alert-icon">
            {turbAlert.intensity === 'severe' ? '⚠️' : '〰️'}
          </div>
          <div className="turb-alert-text">
            <span className="turb-alert-label">
              {turbAlert.intensity === 'severe' ? 'TURBULENCE AHEAD' :
               turbAlert.intensity === 'moderate' ? 'Moderate turbulence ahead' :
               'Light turbulence ahead'}
            </span>
            <p className="turb-alert-hook">{turbAlert.hook}</p>
          </div>
          <button className="turb-alert-close"
            onClick={() => { engineRef.current?.clearTurbAlert(); setTurbAlert(null) }}>
            ✕
          </button>
        </div>
      )}

      {/* Active POI card — content tier, slides from bottom */}
      {activePOI && (
        <div className="wp-card" onPointerDown={handlePOIOpen}>
          <div className="wp-card-header">
            <div>
              <span className="wp-card-name">
                {activePOI.name || activePOI.title}
              </span>
            </div>
            <button className="wp-card-close" onClick={handlePOIClose}>✕</button>
          </div>

          {activePOI.hook && (
            <p className="wp-card-hook">{activePOI.hook}</p>
          )}

          {/* Ask the guide — available on all POIs */}
          <div className="wp-wiki-prompt">
            <button
              className="wp-path-btn wp-ask-btn"
              onClick={() => {
                setConvPOI(activePOI)
                setConvOpen(true)
                engineRef.current?.startConversation()
              }}
            >
              💬 Tell me about this →
            </button>
          </div>

          {activePOI.divergentPaths?.length > 0 && (
            <div className="wp-card-paths">
              <p className="wp-paths-label">Explore further:</p>
              {activePOI.divergentPaths.map((path, i) => (
                <button
                  key={i}
                  className="wp-path-btn"
                  onClick={() => {
                    setConvPOI(activePOI)
                    setConvOpen(true)
                    engineRef.current?.startConversation()
                  }}
                >
                  {path}
                </button>
              ))}
            </div>
          )}

          {queueLen > 0 && (
            <p className="wp-queue-hint">+{queueLen} more coming up</p>
          )}
        </div>
      )}

      {/* Live tracking status bar */}
      {liveTracking && (
        <div className={`live-status${liveStale ? ' live-status--stale' : ''}`}>
          <span className="live-dot">●</span>
          <span>{liveCallsign} · Live ADS-B</span>
          {liveStale && <span className="live-stale-label">· Signal lost</span>}
        </div>
      )}

      {/* Live flight picker */}
      {showPicker && (
        <LiveFlightPicker
          corridor="BOTH"
          onSelect={handleLiveSelect}
          onDismiss={() => setShowPicker(false)}
        />
      )}
      {convOpen && (
        <ConversationPanel
          poi={convPOI}
          position={{ lat: position[0], lon: position[1], altitudeFt, heading: 'eastbound' }}
          corridor="SEA-DEN"
          onClose={() => {
            setConvOpen(false)
            engineRef.current?.endConversation()
            const next = engineRef.current?.getActive() || null
            setActivePOI(next ? { ...next } : null)
            setQueueLen(engineRef.current?.getQueueLength() || 0)
          }}
        />
      )}
    </div>
  )
}
