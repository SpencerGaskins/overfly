# POI Triggering System: Cone of Interest

## Overview

Every POI in the TOON bundle is georeferenced with precise `lat,lon` coordinates. As the aircraft moves along the route, a **cone of interest** (radius around each POI) determines when to trigger the guide with contextual information.

---

## Georeferencing in TOON Format

```toon
pois[142]{id,title,lat,lon,dist_nm,priority,side,heading,state,category,type,season,facts_json}:
  south-pass	South Pass	42.4667	-108.8000	8	1	both	eastbound	WY	history	landmark	year-round	{"elevation_ft":7412,"oregon_trail":true,"california_trail":true,"mormon_trail":true,"gold_discovered":"1842","emigrants_crossed":400000}
```

**Georeferencing fields**:
- `lat`: 42.4667 (latitude in decimal degrees)
- `lon`: -108.8000 (longitude in decimal degrees)
- `dist_nm`: 8 (distance from route centerline in nautical miles)

---

## Cone of Interest Calculation

### Trigger Radius

Each POI has a **trigger radius** based on priority and type:

| Priority | Type | Trigger Radius | Example |
|----------|------|----------------|---------|
| 1 (must-see) | Large feature | 25 nm | Yellowstone, Grand Teton |
| 1 (must-see) | Point feature | 15 nm | Devils Tower, Balanced Rock |
| 2 (recommended) | Any | 10 nm | Museums, state parks |
| 3 (optional) | Any | 5 nm | Local attractions |

**Formula**:
```javascript
function getTriggerRadius(poi) {
  if (poi.priority === 1) {
    return poi.type.includes('national-park') ? 25 : 15
  } else if (poi.priority === 2) {
    return 10
  } else {
    return 5
  }
}
```

### Distance Calculation

```javascript
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3440.065 // Earth radius in nautical miles
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon2)
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
            Math.sin(dLon/2) * Math.sin(dLon/2)
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c // Distance in nautical miles
}
```

### Trigger Logic

```javascript
function checkPOITrigger(aircraftPosition, poi) {
  const distance = haversineDistance(
    aircraftPosition.lat,
    aircraftPosition.lon,
    poi.lat,
    poi.lon
  )
  
  const triggerRadius = getTriggerRadius(poi)
  
  // Check if within cone of interest
  if (distance <= triggerRadius) {
    // Check seat side visibility
    const bearing = calculateBearing(aircraftPosition, poi)
    const relativeBearing = bearing - aircraftPosition.heading
    
    if (poi.side === 'both') {
      return true
    } else if (poi.side === 'A' && relativeBearing > 270 || relativeBearing < 90) {
      return true // Left side (A seats)
    } else if (poi.side === 'F' && relativeBearing > 90 && relativeBearing < 270) {
      return true // Right side (F seats)
    }
  }
  
  return false
}
```

---

## Triggering Flow

```
Aircraft Position Update (every 5 seconds)
         ↓
Calculate distance to all POIs in bundle
         ↓
Filter POIs within trigger radius
         ↓
Check seat side visibility
         ↓
Rank by priority + distance
         ↓
Select active POI (closest, highest priority)
         ↓
Generate guide prompt with POI context
         ↓
Display notification: "Out your window..."
```

---

## Example: South Pass Trigger

### POI Data (TOON)

```toon
pois[1]{id,title,lat,lon,dist_nm,priority,side,heading,state,category,type,season,facts_json}:
  south-pass	South Pass	42.4667	-108.8000	8	1	both	eastbound	WY	history	landmark	year-round	{"elevation_ft":7412,"oregon_trail":true,"california_trail":true,"mormon_trail":true,"gold_discovered":"1842","emigrants_crossed":400000}

summaries[1]{id,text}:
  south-pass	South Pass was the key gateway through the Rocky Mountains for westward emigrants. At just 7,412 feet elevation, it gave an erroneous sense of ease—the gentle grade masked the harsh journey ahead. Over 400,000 emigrants crossed here on the Oregon, California, and Mormon Trails between 1840-1870.

llm_context[1]{id,guidance}:
  south-pass	Emphasize the deceptive ease of the pass and its critical role in westward expansion. Mention the three major trails converging here. Highlight the 400,000 emigrants who crossed. Contrast the gentle grade with the harsh realities of the journey beyond.
```

### Aircraft Approaching

```
Aircraft Position:
  lat: 42.5000
  lon: -108.7500
  altitude: 35000 ft
  heading: 90° (due east)
  
Distance to South Pass:
  haversineDistance(42.5000, -108.7500, 42.4667, -108.8000)
  = 3.2 nm
  
Trigger Radius:
  priority: 1 (must-see)
  type: landmark
  radius: 15 nm
  
Status: WITHIN CONE OF INTEREST ✅

Seat Side Check:
  bearing to POI: 225° (southwest)
  relative bearing: 225° - 90° = 135°
  poi.side: both
  
Status: VISIBLE FROM BOTH SIDES ✅

Action: TRIGGER GUIDE
```

### Guide Notification

**Mobile App UI**:
```
┌─────────────────────────────────────┐
│  📍 Out Your Window                 │
│                                     │
│  South Pass                         │
│  8 nm to your left                  │
│                                     │
│  [Ask Guide] [Dismiss]              │
└─────────────────────────────────────┘
```

**User taps "Ask Guide"**:

### Gemma Prompt (Auto-Generated)

```
You are an adventurous and curious guide for FlightLevel passengers.

POI: South Pass
Location: 42.4667, -108.8000
State: Wyoming
Category: history
Type: landmark
Season: year-round

Facts:
  elevation_ft: 7412
  oregon_trail: true
  california_trail: true
  mormon_trail: true
  gold_discovered: 1842
  emigrants_crossed: 400000

Summary: South Pass was the key gateway through the Rocky Mountains for westward emigrants. At just 7,412 feet elevation, it gave an erroneous sense of ease—the gentle grade masked the harsh journey ahead. Over 400,000 emigrants crossed here on the Oregon, California, and Mormon Trails between 1840-1870.

Context: Emphasize the deceptive ease of the pass and its critical role in westward expansion. Mention the three major trails converging here. Highlight the 400,000 emigrants who crossed. Contrast the gentle grade with the harsh realities of the journey beyond.

Aircraft position: 42.5000, -108.7500
Altitude: 35000 ft
Distance to POI: 3.2 nm (southwest)

Question: Tell me about what I'm seeing out my window.

Answer with curiosity and wonder (under 120 words).
```

### Gemma Response (On-Device)

> "Out your window to the southwest, that gentle saddle in the mountains is South Pass—the gateway that changed American history! At just 7,412 feet, it gave westward emigrants an erroneous sense of ease. The grade was so gentle that wagons could roll through without much trouble, but that deceptive simplicity masked the brutal journey ahead. Over 400,000 people crossed here between 1840 and 1870 on the Oregon, California, and Mormon Trails—all three converged at this exact spot. Gold was discovered here in 1842, adding to the rush. From 35,000 feet up, you can see why they chose this route—it's the lowest, widest gap in the Rockies for hundreds of miles!"

**Confidence**: 0.92 (high - rich historical context, specific facts)

---

## Trigger Optimization

### Prevent Spam

**Cooldown period**: Once a POI is triggered, don't trigger again for 10 minutes
```javascript
const triggeredPOIs = new Map() // id -> timestamp

function shouldTrigger(poi) {
  const lastTriggered = triggeredPOIs.get(poi.id)
  if (lastTriggered && Date.now() - lastTriggered < 600000) {
    return false // 10 minute cooldown
  }
  return true
}
```

### Priority Queue

**Multiple POIs in range**: Show highest priority first
```javascript
function selectActivePOI(poiList, aircraftPosition) {
  const inRange = poiList
    .filter(poi => checkPOITrigger(aircraftPosition, poi))
    .filter(poi => shouldTrigger(poi))
    .map(poi => ({
      ...poi,
      distance: haversineDistance(
        aircraftPosition.lat,
        aircraftPosition.lon,
        poi.lat,
        poi.lon
      )
    }))
    .sort((a, b) => {
      // Sort by priority first, then distance
      if (a.priority !== b.priority) {
        return a.priority - b.priority
      }
      return a.distance - b.distance
    })
  
  return inRange[0] // Return closest, highest priority
}
```

### Approach vs Departure

**Approaching**: Trigger at outer radius (15 nm)
**Departing**: Don't trigger (already passed)

```javascript
function isApproaching(aircraftPosition, poi, previousPosition) {
  const currentDistance = haversineDistance(
    aircraftPosition.lat,
    aircraftPosition.lon,
    poi.lat,
    poi.lon
  )
  
  const previousDistance = haversineDistance(
    previousPosition.lat,
    previousPosition.lon,
    poi.lat,
    poi.lon
  )
  
  return currentDistance < previousDistance // Getting closer
}
```

---

## Seat Side Visibility

### Bearing Calculation

```javascript
function calculateBearing(from, to) {
  const dLon = toRadians(to.lon - from.lon)
  const lat1 = toRadians(from.lat)
  const lat2 = toRadians(to.lat)
  
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  
  const bearing = toDegrees(Math.atan2(y, x))
  return (bearing + 360) % 360 // Normalize to 0-360
}
```

### Relative Bearing

```javascript
function getRelativeBearing(aircraftHeading, bearingToPOI) {
  let relative = bearingToPOI - aircraftHeading
  if (relative < 0) relative += 360
  return relative
}

function getSeatSide(relativeBearing) {
  if (relativeBearing >= 270 || relativeBearing < 90) {
    return 'A' // Left side (port)
  } else {
    return 'F' // Right side (starboard)
  }
}
```

### Visual Indicator

**Mobile App UI** shows directional arrow:
```
┌─────────────────────────────────────┐
│  📍 Out Your Window                 │
│                                     │
│  ← South Pass                       │
│  8 nm to your left                  │
│                                     │
│  [Ask Guide] [Dismiss]              │
└─────────────────────────────────────┘
```

---

## Performance Considerations

### Efficient POI Filtering

**Don't check all 142 POIs every update**:

1. **Pre-filter by route segment**:
   ```javascript
   const nearbyPOIs = pois.filter(poi => 
     poi.dist_nm <= 50 // Within corridor width
   )
   ```

2. **Spatial indexing** (optional):
   - Divide route into 50nm segments
   - Pre-assign POIs to segments
   - Only check POIs in current + adjacent segments

3. **Update frequency**:
   - Position updates: Every 5 seconds
   - POI checks: Every 10 seconds (sufficient)

### Battery Impact

**Minimize GPS polling**:
- Use system location services (already running)
- Don't request high-accuracy mode
- Batch POI checks

---

## Testing Scenarios

### Scenario 1: Yellowstone Approach

```
Aircraft: 44.5000, -110.7000, heading 90°
POI: Yellowstone (44.4280, -110.5885)
Distance: 8.2 nm
Trigger radius: 25 nm (priority 1, national park)
Status: TRIGGER ✅

Notification: "Out your window to your right, Yellowstone National Park..."
```

### Scenario 2: Multiple POIs in Range

```
Aircraft: 43.6000, -110.8000, heading 90°

POIs in range:
1. Grand Teton NP (15 nm, priority 1) ← SELECT THIS
2. Jackson Hole Resort (22 nm, priority 1)
3. National Elk Refuge (18 nm, priority 2)

Selection: Grand Teton (closest, same priority)
```

### Scenario 3: Wrong Seat Side

```
Aircraft: 42.5000, -108.7500, heading 90°
POI: Devils Tower (44.5902, -104.7147, side: F)
Bearing to POI: 75° (northeast)
Relative bearing: 75° - 90° = 345° (normalized: 345°)
Seat side: A (left)
POI requires: F (right)
Status: DON'T TRIGGER ❌
```

---

## Summary

**Cone of Interest System**:
- ✅ All POIs georeferenced with lat/lon
- ✅ Dynamic trigger radius (5-25 nm based on priority)
- ✅ Seat side visibility checking
- ✅ Priority-based selection
- ✅ Cooldown to prevent spam
- ✅ Approach detection (don't trigger when departing)
- ✅ Efficient spatial filtering

**Result**: Contextual, timely guide notifications that enhance the passenger experience without being intrusive.

**Example**: "Out your window, South Pass gave an erroneous sense of ease to westward travelers..."
