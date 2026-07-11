import { useState } from 'react'
import './FlightEntry.css'

// Known routes with pre-loaded waypoint data
const KNOWN_ROUTES = {
  'DL3675': { origin: 'KSEA', destination: 'KDEN', label: 'Seattle → Denver' },
  'DL3676': { origin: 'KDEN', destination: 'KSEA', label: 'Denver → Seattle' },
}

export default function FlightEntry({ onFlightSet }) {
  const [input, setInput] = useState('')
  const [seatSide, setSeatSide] = useState('A')
  const [error, setError] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    const flight = input.trim().toUpperCase()

    if (!flight) {
      setError('Enter a flight number')
      return
    }

    // For now — accept any flight number, use known routes for waypoints
    const route = KNOWN_ROUTES[flight] || null
    onFlightSet({ flightNumber: flight, seatSide, route })
  }

  return (
    <div className="flight-entry">
      <div className="entry-header">
        <div className="logo">✈ FlightLevel</div>
        <p className="tagline">The world below, explained.</p>
      </div>

      <form className="entry-form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="flight">Flight number</label>
          <input
            id="flight"
            type="text"
            placeholder="e.g. DL3675"
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
          {error && <span className="error">{error}</span>}
        </div>

        <div className="field">
          <label>Your seat side</label>
          <div className="seat-toggle">
            <button
              type="button"
              className={seatSide === 'A' ? 'active' : ''}
              onClick={() => setSeatSide('A')}
            >
              ← Left (A/B)
            </button>
            <button
              type="button"
              className={seatSide === 'CD' ? 'active' : ''}
              onClick={() => setSeatSide('CD')}
            >
              Right (C/D) →
            </button>
          </div>
          <p className="seat-hint">
            {seatSide === 'A'
              ? 'Left side — north-facing on eastbound flights'
              : 'Right side — south-facing on eastbound flights'}
          </p>
        </div>

        <button type="submit" className="start-btn">
          Start flight →
        </button>
      </form>

      <div className="known-routes">
        <p>Try a known route:</p>
        {Object.entries(KNOWN_ROUTES).map(([fn, r]) => (
          <button
            key={fn}
            className="route-chip"
            onClick={() => setInput(fn)}
          >
            {fn} — {r.label}
          </button>
        ))}
      </div>
    </div>
  )
}
