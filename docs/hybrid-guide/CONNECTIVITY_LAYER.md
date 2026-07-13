# Connectivity Layer — IFC-Aware Architecture

## Design Principle

The connectivity layer is **abstracted and configuration-driven**. IFC providers change over time
(Viasat → Starlink rollouts, new providers, airline transitions). The app SHALL never hardcode
provider-specific behavior. It probes actual conditions and adapts.

## IFC Landscape (as of 2026)

| Airline | Provider | Typical Latency | Bandwidth |
|---------|----------|-----------------|-----------|
| Delta | Viasat + Starlink (rolling) | 50-2000ms | 1-50 Mbps shared |
| Alaska | Viasat | 600-2000ms | 1-10 Mbps |
| United | Starlink (rolling) | 50-150ms | 5-50 Mbps |
| Southwest | Viasat | 600-2000ms | 1-10 Mbps |
| American | Viasat + Starlink (rolling) | 50-2000ms | varies |

This table will become outdated. The probe, not the table, drives behavior.

## Connectivity Probe

Run once at app startup, re-run every 5 minutes.

```javascript
// connectivityService.js

const PROBE_ENDPOINT = 'https://flightlevel-app.netlify.app/ping'
const PROBE_TIMEOUT_MS = 3000

export async function probeConnectivity() {
  const start = performance.now()

  try {
    const res = await fetch(PROBE_ENDPOINT, {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const latency = performance.now() - start

    return {
      online: res.ok,
      latencyMs: Math.round(latency),
      tier: classifyLatency(latency),
    }
  } catch {
    return { online: false, latencyMs: null, tier: 'offline' }
  }
}

function classifyLatency(ms) {
  if (ms < 150)  return 'starlink'   // Starlink or ground WiFi
  if (ms < 500)  return 'fast'       // Good IFC or LTE
  if (ms < 1500) return 'viasat'     // Viasat or degraded
  return 'slow'                       // Marginal connection
}
```

## Mode Selection

```
probeConnectivity()
    ↓
tier: 'starlink' | 'fast'     tier: 'viasat' | 'slow'    tier: 'offline'
    ↓                               ↓                           ↓
CLOUD_FIRST mode               HYBRID mode                GEMMA_ONLY mode
Gemma skipped                  Gemma first,               All queries
All calls go to cloud          escalate on low            handled on-device
Haiku → Sonnet → Opus          confidence                 No cloud calls
```

## Mode Definitions

### CLOUD_FIRST (Starlink / fast IFC)
- Skip Gemma entirely — latency is low enough that cloud is always faster
- Full escalation path: Haiku → Sonnet → Opus
- All POI data still pre-loaded locally (no network dependency for triggers)
- Handoff messages still used (buys latency perception)

### HYBRID (Viasat / degraded)
- Gemma handles all queries it can answer with confidence > 0.7
- Cloud Sonnet for escalations only
- Opus available but expect 5-15s response time
- User sees handoff message on escalation
- On-device response target: < 500ms

### GEMMA_ONLY (offline / no IFC)
- All queries handled by Gemma 4 E2B
- No escalation
- POI bundle must be pre-loaded (route bundle from S3, fetched before boarding)
- Offline fallback responses for queries Gemma can't handle
- Turbulence alerts still work (from pre-loaded PIREP data in bundle)

## Implementation

### connectivityService.js

```javascript
export class ConnectivityService {
  constructor() {
    this.tier = 'viasat'   // conservative default until probe completes
    this.latencyMs = null
    this.online = true
    this._listeners = []
  }

  async probe() {
    const result = await probeConnectivity()
    const changed = result.tier !== this.tier
    this.tier = result.tier
    this.latencyMs = result.latencyMs
    this.online = result.online
    if (changed) this._listeners.forEach(fn => fn(result))
    return result
  }

  onChange(fn) {
    this._listeners.push(fn)
    return () => this._listeners = this._listeners.filter(l => l !== fn)
  }

  get mode() {
    if (!this.online)                        return 'GEMMA_ONLY'
    if (this.tier === 'starlink' || this.tier === 'fast') return 'CLOUD_FIRST'
    return 'HYBRID'
  }
}

export const connectivity = new ConnectivityService()
```

### guideService.js integration

```javascript
import { connectivity } from './connectivityService'

async ask(userMessage) {
  const mode = connectivity.mode

  if (mode === 'CLOUD_FIRST') {
    return this._askCloud(userMessage, 'haiku')
  }

  if (mode === 'HYBRID') {
    const gemmaResult = await this._askGemma(userMessage)
    if (gemmaResult.confidence > 0.7) return gemmaResult
    return this._askCloud(userMessage, 'sonnet')
  }

  // GEMMA_ONLY
  return this._askGemma(userMessage)
}
```

## Configuration

Model tier names are configuration-driven. Never hardcoded.

```
# .env
VITE_MODEL_SURFACE=claude-haiku-4-5-20251001
VITE_MODEL_DEPTH_1=claude-sonnet-4-6
VITE_MODEL_DEPTH_2=claude-opus-4-6
VITE_CONNECTIVITY_PROBE_URL=https://flightlevel-app.netlify.app/ping
VITE_CONNECTIVITY_PROBE_INTERVAL_MS=300000
VITE_LATENCY_STARLINK_THRESHOLD_MS=150
VITE_LATENCY_FAST_THRESHOLD_MS=500
VITE_LATENCY_VIASAT_THRESHOLD_MS=1500
```

Swapping any model or threshold requires only an env var change — no code change.

## Future Considerations

- Airlines may expose IFC provider info via their captive portal API
- Starlink terminal detection via MTR/traceroute hop patterns
- Bandwidth test (not just latency) for congested Starlink on full flights
- Per-airline presets as a starting point before probe completes
