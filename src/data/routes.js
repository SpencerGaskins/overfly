// Shared route definitions
// Based on real filed route: MONTN2 SEA NORMY J90 MWH IDA MJANE FLATI5

export const ROUTE_SEA_DEN = [
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
]

export const ROUTES = {
  'DL3675': { origin: 'KSEA', destination: 'KDEN', points: ROUTE_SEA_DEN },
  'DL3676': { origin: 'KDEN', destination: 'KSEA', points: [...ROUTE_SEA_DEN].reverse() },
}
