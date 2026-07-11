/**
 * FlightLevel — Route Bundle Fetcher
 *
 * Fetches a pre-built route bundle from S3 instead of doing
 * client-side Wikipedia prefetch + PIREP resolution.
 *
 * Bundle URL pattern:
 *   https://flightlevel-routes.s3.amazonaws.com/routes/{CORRIDOR}-v{N}.json
 *
 * Falls back to the Supabase routes table to discover the current
 * s3_key if the hardcoded version is stale.
 *
 * Usage:
 *   const bundle = await fetchRouteBundle('SEA-DEN')
 *   // bundle.waypoints  — curated POIs, hooks pre-resolved
 *   // bundle.wikipedia_pois — enriched Wikipedia POIs
 *   // bundle.route      — [[lat,lon], ...]
 */

import { supabase } from './supabase'

const S3_BASE = 'https://flightlevel-routes.s3.amazonaws.com'

// Hardcoded current versions — updated when bundler bumps version
const CURRENT_VERSIONS = {
  'SEA-DEN': 1,
  'DEN-SEA': 1,
}

/**
 * Fetch a route bundle for a corridor.
 * Tries S3 directly first (fast path), falls back to Supabase
 * lookup if the hardcoded version 404s.
 *
 * @param {string} corridorId — e.g. 'SEA-DEN'
 * @returns {Promise<RouteBundle>}
 */
export async function fetchRouteBundle(corridorId) {
  const version = CURRENT_VERSIONS[corridorId] ?? 1
  const s3Key   = `routes/${corridorId}-v${version}.json`
  const url     = `${S3_BASE}/${s3Key}`

  // Fast path — direct S3 fetch
  try {
    const res = await fetch(url)
    if (res.ok) {
      const bundle = await res.json()
      console.log(`[bundle] Loaded ${corridorId} v${version} — ${bundle.meta?.wiki_count} wiki POIs`)
      return bundle
    }
    // 404 means version is stale — fall through to Supabase lookup
    if (res.status !== 404) {
      throw new Error(`S3 fetch failed: HTTP ${res.status}`)
    }
  } catch (err) {
    console.warn('[bundle] S3 fast path failed, trying Supabase lookup:', err.message)
  }

  // Fallback — look up current s3_key from Supabase routes table
  return fetchBundleViaSupabase(corridorId)
}

/**
 * Look up the current bundle s3_key from Supabase, then fetch from S3.
 * Used when the hardcoded version is stale.
 */
async function fetchBundleViaSupabase(corridorId) {
  const { data, error } = await supabase
    .from('routes')
    .select('s3_key, bundle_version, last_built')
    .eq('corridor_hash', corridorId)
    .single()

  if (error || !data) {
    throw new Error(`No route bundle found for ${corridorId}: ${error?.message}`)
  }

  const url = `${S3_BASE}/${data.s3_key}`
  console.log(`[bundle] Supabase lookup → ${data.s3_key} (built ${data.last_built})`)

  const res = await fetch(url)
  if (!res.ok) throw new Error(`S3 fetch failed after Supabase lookup: HTTP ${res.status}`)

  return res.json()
}

/**
 * Derive corridor ID from origin/destination ICAO codes.
 * Strips the leading K from US airports.
 *
 * @param {string} origin      — e.g. 'KSEA' or 'SEA'
 * @param {string} destination — e.g. 'KDEN' or 'DEN'
 * @returns {string}           — e.g. 'SEA-DEN'
 */
export function corridorId(origin, destination) {
  const strip = (icao) => icao.replace(/^K/, '').toUpperCase()
  return `${strip(origin)}-${strip(destination)}`
}
