import { useState, useEffect } from 'react'
import { LiveTrackService, formatFlightLabel } from '../services/liveTrackService'
import './LiveFlightPicker.css'

/**
 * LiveFlightPicker
 *
 * Shows a list of real airborne SEA→DEN flights from OpenSky.
 * Passenger (or presenter) picks one to follow live.
 *
 * Props:
 *   corridor   — e.g. 'SEA-DEN'
 *   onSelect   — called with { icao24, callsign, initialPosition }
 *   onDismiss  — called when user cancels
 */
export default function LiveFlightPicker({ corridor = 'SEA-DEN', onSelect, onDismiss }) {
  const [flights, setFlights]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [selecting, setSelecting] = useState(null)

  useEffect(() => {
    const tracker = new LiveTrackService(corridor)
    const fetch = corridor === 'BOTH'
      ? Promise.all([
          new LiveTrackService('SEA-DEN').getCorridorFlights(),
          new LiveTrackService('DEN-SEA').getCorridorFlights(),
        ]).then(([a, b]) => [...a, ...b])
      : tracker.getCorridorFlights()

    fetch
      .then(f => {
        setFlights(f)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [corridor])

  async function handleSelect(flight) {
    setSelecting(flight.icao24)
    onSelect({
      icao24:          flight.icao24,
      callsign:        flight.callsign,
      initialPosition: {
        lat:        flight.lat,
        lon:        flight.lon,
        altitudeFt: flight.altitudeFt,
        speedKt:    flight.speedKt,
        heading:    flight.heading,
        source:     'opensky',
      },
    })
  }

  return (
    <div className="lfp-overlay">
      <div className="lfp-panel">
        <div className="lfp-header">
          <div>
            <div className="lfp-title">Live Flights</div>
            <div className="lfp-subtitle">SEA ↔ DEN · Airborne now</div>
          </div>
          <button className="lfp-close" onClick={onDismiss}>✕</button>
        </div>

        {loading && (
          <div className="lfp-loading">
            <div className="lfp-spinner">✈</div>
            <p>Scanning corridor...</p>
          </div>
        )}

        {error && (
          <div className="lfp-error">
            <p>Couldn't reach OpenSky — {error}</p>
            <p className="lfp-error-hint">Check that OPENSKY credentials are set.</p>
          </div>
        )}

        {!loading && !error && flights.length === 0 && (
          <div className="lfp-empty">
            <p>No flights in corridor right now.</p>
            <p className="lfp-error-hint">SEA↔DEN flights typically depart 6-10am and 4-8pm local. Try again during those windows, or use simulation mode.</p>
          </div>
        )}

        {!loading && flights.length > 0 && (
          <div className="lfp-list">
            {flights.map(flight => (
              <button
                key={flight.icao24}
                className={`lfp-flight${selecting === flight.icao24 ? ' lfp-flight--selecting' : ''}`}
                onClick={() => handleSelect(flight)}
                disabled={!!selecting}
              >
                <div className="lfp-flight-callsign">
                  {flight.callsign || flight.icao24}
                  {flight.direction && (
                    <span className="lfp-flight-dir"> · {flight.direction}</span>
                  )}
                </div>
                <div className="lfp-flight-stats">
                  {flight.altitudeFt && (
                    <span>{flight.altitudeFt.toLocaleString()} ft</span>
                  )}
                  {flight.speedKt && (
                    <span>{flight.speedKt} kt</span>
                  )}
                  {flight.heading && (
                    <span>{flight.heading}°</span>
                  )}
                </div>
                <div className="lfp-flight-pos">
                  {flight.lat?.toFixed(2)}°N  {Math.abs(flight.lon?.toFixed(2))}°W
                </div>
                {selecting === flight.icao24 && (
                  <span className="lfp-flight-loading">Locking on...</span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="lfp-footer">
          <span>Live ADS-B via OpenSky Network</span>
          <button className="lfp-sim-btn" onClick={onDismiss}>
            Use simulation instead
          </button>
        </div>
      </div>
    </div>
  )
}
