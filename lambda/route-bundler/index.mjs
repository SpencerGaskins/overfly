/**
 * FlightLevel — Nightly Route Bundle Assembler
 * AWS Lambda (Node 20, ESM)
 *
 * Triggered by EventBridge Scheduler at 04:00 UTC daily.
 *
 * For each corridor in CORRIDORS:
 *   1. Fetch Wikipedia POIs along the route (server-side, no CORS)
 *   2. Pre-resolve any DYNAMIC hooks against live NOAA PIREP data
 *   3. Assemble a route bundle JSON
 *   4. Write to S3: routes/{CORRIDOR}-v{N}.json
 *   5. Upsert the routes table in Supabase with the new s3_key
 *
 * Bundle schema:
 * {
 *   corridor:       "SEA-DEN",
 *   version:        3,
 *   built_at:       "2026-04-30T04:00:00Z",
 *   route:          [[lat,lon], ...],
 *   waypoints:      [...],          // curated, hooks resolved
 *   wikipedia_pois: [...],          // filtered, with extracts
 *   meta: {
 *     waypoint_count: 13,
 *     wiki_count:     87,
 *     pirep_resolved: 2,
 *   }
 * }
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { createClient } from '@supabase/supabase-js'
import { CORRIDORS } from './corridors.mjs'
import {
  queryWikipediaBBox,
  getWikipediaSummary,
  filterPOIs,
} from './wikipedia.mjs'
import { fetchPIREPs, buildTurbulenceHook } from './noaa.mjs'

// ── AWS / Supabase clients ────────────────────────────────────────
const s3 = new S3Client({ region: process.env.S3_REGION || 'us-east-2' })
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service role key — server-side only
)

const S3_BUCKET = process.env.S3_BUCKET || 'flightlevel-routes'

// ── Lambda handler ────────────────────────────────────────────────
export const handler = async (event) => {
  console.log('[bundler] Starting nightly route bundle run', new Date().toISOString())

  const results = []

  for (const corridor of CORRIDORS) {
    try {
      console.log(`[bundler] Processing corridor: ${corridor.id}`)
      const bundle = await buildBundle(corridor)
      const s3Key  = await writeToS3(corridor, bundle)
      await upsertSupabase(corridor, bundle, s3Key)
      results.push({ corridor: corridor.id, status: 'ok', s3Key, wikiCount: bundle.meta.wiki_count })
      console.log(`[bundler] ✓ ${corridor.id} — ${bundle.meta.wiki_count} wiki POIs, key: ${s3Key}`)
    } catch (err) {
      console.error(`[bundler] ✗ ${corridor.id} failed:`, err)
      results.push({ corridor: corridor.id, status: 'error', error: err.message })
    }
  }

  console.log('[bundler] Run complete:', JSON.stringify(results))
  return { statusCode: 200, body: JSON.stringify(results) }
}

// ── Build a single corridor bundle ───────────────────────────────
async function buildBundle(corridor) {
  const builtAt = new Date().toISOString()

  // Step 1 — Resolve DYNAMIC hooks on curated waypoints
  const resolvedWaypoints = await resolveWaypointHooks(corridor.waypoints)

  // Step 2 — Fetch Wikipedia POIs along the route
  const wikiPOIs = await fetchWikipediaPOIs(corridor.route, corridor.id)

  return {
    corridor:       corridor.id,
    version:        corridor.version,
    built_at:       builtAt,
    route:          corridor.route,
    waypoints:      resolvedWaypoints,
    wikipedia_pois: wikiPOIs,
    meta: {
      waypoint_count:  resolvedWaypoints.length,
      wiki_count:      wikiPOIs.length,
      pirep_resolved:  resolvedWaypoints.filter(w => w._pirepResolved).length,
    },
  }
}

// ── Resolve DYNAMIC hooks against live PIREP data ─────────────────
async function resolveWaypointHooks(waypoints) {
  return Promise.all(waypoints.map(async wp => {
    if (!wp.hook?.includes('DYNAMIC')) return wp
    try {
      const pireps = await fetchPIREPs(wp.lat, wp.lon, 150, 3)
      const hook   = buildTurbulenceHook(pireps, 0)
      console.log(`  [pirep] Resolved ${wp.name}: "${hook.substring(0, 60)}..."`)
      return { ...wp, hook, _pirepResolved: true }
    } catch (err) {
      console.warn(`  [pirep] Failed to resolve ${wp.name}:`, err.message)
      return { ...wp, hook: buildTurbulenceHook([], 0), _pirepResolved: false }
    }
  }))
}

// ── Fetch Wikipedia POIs along the route ─────────────────────────
async function fetchWikipediaPOIs(routePoints, corridorId) {
  const seen    = new Set()
  const rawPOIs = []

  // Divide route into bounding box segments — 3 points per segment
  // Wikipedia bbox query covers a wider area than radius queries
  const SEGMENT_SIZE = 3
  for (let i = 0; i < routePoints.length - 1; i += SEGMENT_SIZE) {
    const segment = routePoints.slice(i, i + SEGMENT_SIZE + 1)
    const lats = segment.map(p => p[0])
    const lons = segment.map(p => p[1])
    const bbox = {
      latMin: Math.min(...lats) - 0.8,
      latMax: Math.max(...lats) + 0.8,
      lonMin: Math.min(...lons) - 0.8,
      lonMax: Math.max(...lons) + 0.8,
    }

    try {
      const pois = await queryWikipediaBBox(bbox.latMin, bbox.lonMin, bbox.latMax, bbox.lonMax, 50)
      for (const poi of pois) {
        if (!seen.has(poi.pageid)) {
          seen.add(poi.pageid)
          rawPOIs.push({ ...poi, source: 'wikipedia', corridors: [corridorId] })
        }
      }
    } catch (err) {
      console.warn(`  [wiki] Segment ${i} failed:`, err.message)
    }

    // Polite delay — Wikipedia rate limit
    await delay(200)
  }

  // Filter out useless POIs
  const filtered = filterPOIs(rawPOIs)
  console.log(`  [wiki] ${rawPOIs.length} raw → ${filtered.length} after filter`)

  // Enrich with extracts (batch, 3 at a time)
  const enriched = await enrichWithExtracts(filtered)

  // Upsert into Supabase wikipedia_pois cache
  await cacheWikipediaPOIs(enriched)

  return enriched
}

// ── Enrich POIs with Wikipedia extracts ──────────────────────────
async function enrichWithExtracts(pois) {
  const BATCH = 3
  const results = []

  for (let i = 0; i < pois.length; i += BATCH) {
    const batch = pois.slice(i, i + BATCH)
    const enriched = await Promise.all(batch.map(async poi => {
      try {
        const summary = await getWikipediaSummary(poi.pageid)
        return {
          ...poi,
          extract:       summary.extract || null,
          thumbnail_url: summary.thumbnail || null,
        }
      } catch {
        return poi  // keep without extract rather than drop
      }
    }))
    results.push(...enriched)
    await delay(150)
  }

  return results
}

// ── Cache Wikipedia POIs in Supabase ─────────────────────────────
async function cacheWikipediaPOIs(pois) {
  if (!pois.length) return

  // Upsert in batches of 50 (Supabase row limit per request)
  const BATCH = 50
  for (let i = 0; i < pois.length; i += BATCH) {
    const batch = pois.slice(i, i + BATCH).map(poi => ({
      pageid:        poi.pageid,
      title:         poi.title,
      lat:           poi.lat,
      lon:           poi.lon,
      extract:       poi.extract || null,
      thumbnail_url: poi.thumbnail_url || null,
      corridors:     poi.corridors || [],
      last_updated:  new Date().toISOString(),
    }))

    const { error } = await supabase
      .from('wikipedia_pois')
      .upsert(batch, { onConflict: 'pageid' })

    if (error) {
      console.warn(`  [supabase] wikipedia_pois upsert batch ${i} failed:`, error.message)
    }
  }
}

// ── Write bundle to S3 ────────────────────────────────────────────
async function writeToS3(corridor, bundle) {
  const s3Key = `routes/${corridor.id}-v${corridor.version}.json`

  await s3.send(new PutObjectCommand({
    Bucket:      S3_BUCKET,
    Key:         s3Key,
    Body:        JSON.stringify(bundle),
    ContentType: 'application/json',
    CacheControl: 'public, max-age=43200',  // 12h CDN cache
  }))

  return s3Key
}

// ── Upsert Supabase routes table ──────────────────────────────────
async function upsertSupabase(corridor, bundle, s3Key) {
  const { error } = await supabase
    .from('routes')
    .upsert({
      corridor_hash:  corridor.id,
      origin:         corridor.origin,
      destination:    corridor.destination,
      s3_key:         s3Key,
      bundle_version: corridor.version,
      last_built:     bundle.built_at,
      route_geometry: bundle.route,
    }, { onConflict: 'corridor_hash' })

  if (error) {
    throw new Error(`Supabase upsert failed: ${error.message}`)
  }
}

// ── Utility ───────────────────────────────────────────────────────
function delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}
