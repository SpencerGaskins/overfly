# FlightLevel — Live Position Layer

## The Problem

The simulation step button is a demo tool. In production, the aircraft moves
continuously and the app needs to know where it is without the passenger doing
anything. Position and altitude drive everything: which POIs surface, when
turbulence alerts fire, what the guide knows about the view.

GPS alone is unreliable in a metal tube at altitude. The solution is a
**cascading position stack** — four sources tried in priority order, each
more reliable but less accurate than the one above it.

---

## Position Stack (priority order)

### Tier 1 — Cabin WiFi Portal (free, best data)
When the passenger connects to cabin WiFi, the IFE system exposes a local
endpoint with live flight data. No internet purchase required — just connecting
to the cabin network is enough.

**Known endpoints by carrier:**

| Carrier | WiFi Provider | Endpoint | Notes |
|---------|--------------|----------|-------|
| United  | Gogo/Viasat  | `http://unitedwifi.com/portal/api/v1/flightInfo` | lat, lon, alt, speed, heading |
| Delta   | Gogo/Viasat  | `https://wifi.inflightinternet.com/abp/v2/statusTray` | lat, lon, alt, speed |
| American | Viasat      | `http://www.aainflight.com/api/v1/flightData` | lat, lon, alt |
| Southwest | Row44      | `http://getconnected.southwestwifi.com/current.json` | lat, lon, alt |
| Alaska  | Gogo         | `http://gogoinflight.com/abp/ws/absServices/statusTray` | lat, lon, alt |

All return JSON. All are undocumented and unsupported — treat as best-effort.
Poll every 30 seconds. Fail silently and fall through to Tier 2.

**Response shape (United example):**
```json
{
  "latitude": 46.55,
  "longitude": -119.53,
  "altitude": 33000,
  "groundspeed": 487,
  "heading": 112,
  "flightNumber": "UA1234",
  "origin": "KSEA",
  "destination": "KDEN"
}
```

**Implementation note:** These are HTTP (not HTTPS) endpoints on a local
network. Browsers block mixed content by default. Requires either:
- A Netlify function proxy that the client calls, which then hits the local
  endpoint — won't work (Netlify is on the internet, not the cabin LAN)
- Direct fetch from the client with `http://` — works if the app is served
  over HTTP, blocked if served over HTTPS
- **Best approach:** detect cabin WiFi by attempting the fetch client-side.
  If the app is on HTTPS, use a service worker to proxy the local HTTP call.

---

### Tier 2 — FR24 API (paid, reliable, requires internet WiFi)
Flightradar24's official API. Requires the passenger to have purchased cabin
WiFi internet access (not just the free portal).

**Endpoint:** `GET https://fr24api.flightradar24.com/api/live/flight-positions/light`

**Query:** by flight number (callsign)

**Cost:** 6 credits per flight returned. At 30s polling for a 4hr flight:
480 queries × 6 credits = 2,880 credits. Explorer tier ($9/mo) = 30,000
credits = ~10 full flights/month. Acceptable for demo, needs higher tier
for production.

**Response:**
```json
{
  "data": [{
    "fr24_id": "...",
    "callsign": "DL3675",
    "lat": 46.55,
    "lon": -119.53,
    "alt": 33000,
    "gspeed": 487,
    "track": 112
  }]
}
```

**Key advantage over FlightAware:** FR24 has a sandbox environment for
development — no credits consumed during testing.

---

### Tier 3 — Browser Geolocation (free, no WiFi needed)
`navigator.geolocation.watchPosition()` — works on airplane mode if the
device has GPS lock. Accuracy varies: window seat with clear sky view gets
10-50m accuracy. Middle seat may not get a fix at all.

**Use as:** validator/corrector against dead reckoning, not primary source.
If GPS position differs from dead reckoning by >50 miles, trust GPS.
If GPS position differs by <50 miles, blend (GPS is probably drifting).

**Altitude:** `position.coords.altitude` is available but unreliable on
most phones. Ignore it — use the flight profile model instead.

---

### Tier 4 — Dead Reckoning (free, always available)
Estimate position from:
1. Flight number → scheduled departure time (from FR24 or FlightAware lookup
   at app start, cached)
2. Elapsed time since wheels-up (user confirms "we just took off" or app
   estimates from scheduled departure)
3. Route geometry (already in `routes.js`)
4. Typical groundspeed for aircraft type (~480kt for 737/A320)

**Algorithm:**
```
distanceTraveled = elapsedMinutes × (groundspeedKt / 60) × 1.15  // nm to miles
positionOnRoute = interpolate(routePoints, distanceTraveled / totalRouteDistance)
```

**Altitude model** (SEA→DEN example):
```
0-20 min:    climbing, 0 → 35,000 ft (linear)
20-200 min:  cruise, 35,000 ft
200-230 min: descending, 35,000 → 5,000 ft (linear)
230+ min:    approach/landing
```

Accurate to within ~30 miles for a normal flight. Degrades on holds,
diversions, or significant headwinds. Good enough for POI surfacing.

---

## Implementation Plan

### New service: `src/services/positionService.js`

```js
class PositionService {
  constructor(flightNumber, route, departureTime) { ... }

  // Start polling — tries each tier in order
  async start(onPosition) { ... }

  // Returns { lat, lon, altitudeFt, heading, source, accuracy }
  getPosition() { ... }

  stop() { ... }
}
```

**`source` values:** `'cabin-wifi'` | `'fr24'` | `'gps'` | `'dead-reckoning'`

The UI can show a small indicator of which source is active — useful for
debugging and for the demo ("position from cabin WiFi").

### Changes to existing files

**`FlightEntry.jsx`** — add departure time input:
- "When did you board?" or "Scheduled departure time"
- Pre-fill from FR24 lookup if available
- Used to anchor dead reckoning

**`FlightView.jsx`** — replace simulation controls with live position:
- Remove Step/Auto/Reset buttons (keep for demo mode toggle)
- Subscribe to `PositionService` updates
- Update `position` and `altitudeFt` state from service
- Show position source indicator in header

**`App.jsx`** — pass departure time through to FlightView

### New Netlify function: `netlify/functions/flightinfo.js`

Proxies FR24 API server-side (keeps API key off client):
```
GET /.netlify/functions/flightinfo?flight=DL3675
→ { lat, lon, altitudeFt, heading, groundspeed, source: 'fr24' }
```

Also used at app start to look up scheduled departure time for dead
reckoning anchor.

---

## Departure Time UX

The weakest link in dead reckoning is knowing when wheels-up happened.
Three options:

1. **Ask the user** — "What time did you take off?" Simple, accurate,
   slightly annoying. Show a time picker pre-filled with scheduled departure.

2. **Infer from boarding** — user opens the app at the gate. App notes the
   time. Adds typical taxi + takeoff delay (~20 min) to estimate wheels-up.

3. **FR24 lookup** — query actual departure time from FR24 at app start.
   Costs 1 query (~6 credits). Most accurate. Requires internet at gate.

**Recommended:** Option 3 at app start (gate WiFi), fall back to Option 1
if FR24 unavailable.

---

## Position Source Indicator

Small badge in the flight view header showing current source:

```
[ DL3675  SEA→DEN ]  [ 33,000 ft ]  [ ◉ cabin wifi ]
```

Color coding:
- Green `◉` — cabin WiFi (best)
- Blue `◉` — FR24 (good)  
- Yellow `◉` — GPS (ok)
- Grey `◉` — dead reckoning (estimated)

Tapping the badge shows a tooltip: "Position from cabin WiFi · Updated 12s ago"

---

## Build Order

1. **Dead reckoning** — no external dependencies, works immediately, unblocks
   everything else. Replaces the step simulation for real use.

2. **GPS layer** — `navigator.geolocation.watchPosition()`, 30 lines of code,
   validates dead reckoning.

3. **FR24 integration** — Netlify function proxy, departure time lookup,
   live position polling. Requires FR24 API key.

4. **Cabin WiFi detection** — carrier-specific endpoint probing, service
   worker for HTTP/HTTPS mixed content. Most complex, highest value.

---

## Demo Mode

Keep the Step/Auto/Reset simulation controls behind a "Demo" toggle.
When demoing on the ground, flip to demo mode and step through the route.
When flying, demo mode is off and live position takes over.

The briefing screen already works correctly in both modes — no changes needed.

---

## Cost Model (production)

| Source | Cost per flight | Notes |
|--------|----------------|-------|
| Cabin WiFi portal | $0 | Free, best data, no internet needed |
| FR24 API | ~$0.03 | 480 queries × 6 credits, Explorer tier |
| GPS | $0 | Free, device-native |
| Dead reckoning | $0 | Free, always available |

At scale, cabin WiFi covers ~70% of passengers (most connect to cabin network
even without buying internet). FR24 covers the rest. Blended cost per flight
is well under $0.01.
