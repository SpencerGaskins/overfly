/**
 * Corridor definitions for the nightly route bundler.
 *
 * Each corridor entry contains:
 *   id       — matches corridor_hash in Supabase routes table
 *   origin   — ICAO origin
 *   destination — ICAO destination
 *   version  — bump this to force a cache-bust on the client
 *   route    — array of [lat, lon] waypoints (the flight path)
 *   waypoints — curated POI waypoints (from the hand-authored JSON)
 *
 * Adding a new corridor:
 *   1. Add an entry here
 *   2. Create a waypoints JSON file in corridors/
 *   3. The bundler picks it up on the next nightly run
 */

import seaDenWaypoints from './corridors/SEA-DEN.mjs'

export const CORRIDORS = [
  {
    id:          'SEA-DEN',
    origin:      'KSEA',
    destination: 'KDEN',
    version:     1,
    route: [
      [47.45, -122.31],  // KSEA
      [47.43, -121.72],  // NORMY fix
      [47.20, -119.32],  // MWH — Moses Lake VOR
      [46.50, -117.50],  // J90 airway SE
      [45.50, -116.00],  // J90 continuing
      [44.20, -114.00],  // Approaching IDA
      [43.51, -112.07],  // IDA — Idaho Falls VOR
      [42.80, -110.50],  // SW Wyoming
      [41.38, -108.34],  // MJANE fix — Wyoming
      [41.20, -107.00],  // Rawlins area
      [41.10, -106.00],  // Medicine Bow
      [41.31, -105.59],  // Laramie Basin
      [40.65, -105.20],  // Fort Collins
      [40.20, -105.00],  // Front Range descent
      [39.86, -104.67],  // KDEN
    ],
    waypoints: seaDenWaypoints,
  },
]
