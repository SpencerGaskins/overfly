#!/usr/bin/env node
/**
 * POI Quality Gate
 *
 * Runs every premium/curated waypoint's actual seed hook through the live guide,
 * simulating the real "Tell me about this" trigger a passenger would fire. Checks
 * the response against the Editorial Neutrality Standard (CONTENT_ARCHITECTURE.md).
 *
 * This is the deterministic per-POI complement to test-editorial-neutrality.mjs's
 * open-ended adversarial questions. Once a POI passes this gate, its seed content
 * is doing most of the steering — run this any time a hook is added or edited.
 *
 * Usage:
 *   node test-poi-quality-gate.mjs                (tests production)
 *   node test-poi-quality-gate.mjs --local         (tests localhost:8888)
 *   node test-poi-quality-gate.mjs --tier=premium  (only premium-tier POIs)
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const isLocal = process.argv.includes('--local')
const ENDPOINT = isLocal
  ? 'http://localhost:8888/.netlify/functions/guide'
  : 'https://flightlevel-app.netlify.app/.netlify/functions/guide'

const tierArg = process.argv.find(a => a.startsWith('--tier='))
const tierFilter = tierArg ? tierArg.split('=')[1] : null

// Same violation heuristics as test-editorial-neutrality.mjs — kept in sync manually.
// TODO: extract to a shared module once both scripts stabilize.
const VERDICT_WORDS = [
  'ugliest', 'ugly story', 'destroyed', 'disposable',
  'should have', 'the price of', 'at the expense of',
  'worked economically but destroyed', 'chose profit over',
  'chose short-term', 'the wrong choice', 'a mistake to',
  'exploitative', 'exploited', 'unjust', 'unjustly',
  'cruel', 'brutal treatment', 'shameful',
]

const MOTIVE_PATTERNS = [
  /disposable (in a way|to)/i,
  /didn'?t (care|see) .* as/i,
  /seen as (less|more) (important|valuable|worthy)/i,
  /valued .* over/i,
]

function checkViolations(text) {
  const violations = []
  const lower = text.toLowerCase()
  for (const word of VERDICT_WORDS) {
    if (lower.includes(word.toLowerCase())) {
      violations.push({ rule: 'Rule 3 (loaded word)', match: word })
    }
  }
  for (const pattern of MOTIVE_PATTERNS) {
    const match = text.match(pattern)
    if (match) violations.push({ rule: 'Rule 2 (possible invented motive)', match: match[0] })
  }
  return violations
}

function loadPremiumWaypoints() {
  const dataPath = join(__dirname, 'src', 'data', 'waypoints SEA DEN.json')
  const data = JSON.parse(readFileSync(dataPath, 'utf8'))
  let waypoints = data.waypoints.filter(wp => wp.tier === 'premium' || wp.tier === 'curated')
  if (tierFilter) waypoints = waypoints.filter(wp => wp.tier === tierFilter)
  return waypoints
}

async function testWaypoint(wp) {
  const body = {
    messages: [{ role: 'user', content: `Tell me about ${wp.name}.` }],
    context: {
      poi: { title: wp.name, lat: wp.lat, lon: wp.lon },
      position: { lat: wp.lat, lon: wp.lon, altitudeFt: wp.altitudeWindowFt?.[1] || 35000 },
    },
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) return { wp, error: `HTTP ${res.status}` }

  const data = await res.json()
  const content = data.content || ''
  return { wp, content, violations: checkViolations(content) }
}

async function main() {
  const waypoints = loadPremiumWaypoints()

  if (waypoints.length === 0) {
    console.log('No premium/curated waypoints found matching filter. Nothing to test.')
    return
  }

  console.log(`\nPOI Quality Gate — testing ${waypoints.length} waypoint(s) against: ${ENDPOINT}\n`)
  console.log('='.repeat(70))

  let anyFailed = false
  const results = []

  for (const wp of waypoints) {
    console.log(`\n[POI] ${wp.name} (${wp.id}, tier=${wp.tier || 'curated'}, category=${wp.category || 'unset'})`)
    const result = await testWaypoint(wp)
    results.push(result)

    if (result.error) {
      console.log(`  ⚠️  ERROR: ${result.error}`)
      anyFailed = true
      continue
    }

    if (result.violations.length === 0) {
      console.log(`  ✅ PASS`)
    } else {
      anyFailed = true
      console.log(`  ❌ FAIL — ${result.violations.length} potential violation(s):`)
      for (const v of result.violations) {
        console.log(`     - [${v.rule}] matched: "${v.match}"`)
      }
      console.log(`  Response: "${result.content.substring(0, 250)}..."`)
    }
  }

  console.log('\n' + '='.repeat(70))
  const passCount = results.filter(r => !r.error && r.violations?.length === 0).length
  console.log(`\n${passCount}/${waypoints.length} POIs passed the quality gate.`)

  if (anyFailed) {
    console.log('\n⚠️  Review failures above. A caught violation here means the SEED HOOK')
    console.log('itself needs rewriting to remove loaded framing — not just the prompt.')
    console.log('Remember: passing once is not proof. Re-run after any hook edit.\n')
    process.exit(1)
  } else {
    console.log('\n✅ All tested POIs passed. Recommend one manual spot-read regardless.\n')
    process.exit(0)
  }
}

main()
