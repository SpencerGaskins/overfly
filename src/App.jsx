import { useState } from 'react'
import FlightEntry from './components/FlightEntry'
import FlightBriefing from './components/FlightBriefing'
import FlightView from './components/FlightView'
import './App.css'

// App states: 'entry' → 'briefing' → 'flight'
export default function App() {
  const [screen, setScreen]           = useState('entry')
  const [flight, setFlight]           = useState(null)
  const [prefetchResult, setPrefetchResult] = useState(null)

  function handleFlightSet(flightData) {
    setFlight(flightData)
    setScreen('briefing')
  }

  function handleBriefingReady(result) {
    setPrefetchResult(result)
    setScreen('flight')
  }

  function handleExit() {
    setScreen('entry')
    setFlight(null)
    setPrefetchResult(null)
  }

  if (screen === 'entry') {
    return <FlightEntry onFlightSet={handleFlightSet} />
  }

  if (screen === 'briefing') {
    return <FlightBriefing flight={flight} onReady={handleBriefingReady} />
  }

  return (
    <FlightView
      flight={flight}
      prefetchResult={prefetchResult}
      onExit={handleExit}
    />
  )
}
