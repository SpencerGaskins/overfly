import { supabase } from './supabase'

/**
 * Submit a passenger turbulence report (FLYREP) to Supabase.
 *
 * @param {Object} report
 * @param {string}  report.flight_number  - e.g. "UA1234"
 * @param {number}  report.lat
 * @param {number}  report.lon
 * @param {number}  report.altitude_ft
 * @param {string}  report.intensity      - 'lgt' | 'mod' | 'sev'
 * @param {string}  [report.raw_label]    - human-readable label
 * @param {boolean} [report.ongoing]      - still in turbulence?
 * @param {string}  [report.session_id]   - links to anxiety_profile
 * @returns {Promise<{ data, error }>}
 */
export async function submitFlyrep({
  flight_number,
  lat,
  lon,
  altitude_ft,
  intensity,
  raw_label = null,
  ongoing = false,
  session_id = null,
}) {
  const corridorHash = deriveCorridorHash(lat, lon)

  // NOTE: deliberately no .select() here. flyreps has an INSERT-only RLS
  // policy for anon (write-only from client, analytics reads happen
  // server-side with the service role key — see supabase/migrations/002).
  // Chaining .select() asks PostgREST to return the row via RETURNING,
  // which Postgres evaluates against SELECT-level RLS, not INSERT — so it
  // fails with "new row violates row-level security policy" even though
  // the insert itself is allowed. Caller only needs { error } anyway.
  const { error } = await supabase
    .from('flyreps')
    .insert({
      flight_number,
      lat,
      lon,
      altitude_ft: Math.round(altitude_ft),
      intensity,
      raw_label,
      ongoing,
      corridor_hash: corridorHash,
      session_id,
    })

  if (error) {
    console.error('[FLYREP] Submission failed:', error.message)
  }

  return { data: null, error }
}

/**
 * Submit a passenger anxiety profile to Supabase.
 * Called once per flight session, right after the profile screen.
 *
 * @param {Object} profile
 * @param {string}  profile.session_id
 * @param {string}  profile.flight_number
 * @param {string}  profile.seat_side
 * @param {string}  profile.turbulence_sensitivity  - 'calm'|'aware'|'anxious'|'avoidant'
 * @param {string}  profile.curiosity_style         - 'storyteller'|'scientist'|'explorer'|'mixed'
 * @returns {Promise<{ data, error }>}
 */
export async function submitAnxietyProfile({
  session_id,
  flight_number,
  seat_side,
  turbulence_sensitivity,
  curiosity_style,
}) {
  const corridor_hash = flight_number === 'DL3675' ? 'SEA-DEN'
                      : flight_number === 'DL3676' ? 'DEN-SEA'
                      : null

  const { data, error } = await supabase
    .from('anxiety_profiles')
    .insert({
      session_id,
      flight_number,
      corridor_hash,
      seat_side,
      turbulence_sensitivity,
      curiosity_style,
    })
    .select()

  if (error) {
    // Non-fatal — profile capture is best-effort
    console.warn('[AnxietyProfile] Submission failed:', error.message)
  } else {
    console.log('[AnxietyProfile] Saved:', data?.[0]?.id || data?.id || 'ok')
  }

  return { data, error }
}

/**
 * Derive a rough corridor hash from position.
 * Full implementation will use the route geometry; this is a
 * lat/lon grid bucket sufficient for aggregation queries.
 */
function deriveCorridorHash(lat, lon) {
  // 2-degree grid bucket — e.g. "47N-120W"
  const latBucket = `${Math.abs(Math.round(lat / 2) * 2)}${lat >= 0 ? 'N' : 'S'}`
  const lonBucket = `${Math.abs(Math.round(lon / 2) * 2)}${lon >= 0 ? 'E' : 'W'}`
  return `${latBucket}-${lonBucket}`
}
