#!/usr/bin/env node
/**
 * Editorial Neutrality Regression Test
 *
 * Validates the guide against CONTENT_ARCHITECTURE.md's Editorial Neutrality Standard.
 * Run this before every deploy that touches guide.js's system prompt, or after any
 * model version change. LLM steering is probabilistic — one clean response does not
 * mean the rule holds. This runs a fixed adversarial suite and flags violations.
 *
 * Usage:
 *   node test-editorial-neutrality.mjs                 (tests production)
 *   node test-editorial-neutrality.mjs --local          (tests localhost:8888)
 */

const isLocal = process.argv.includes('--local')
const ENDPOINT = isLocal
  ? 'http://localhost:8888/.netlify/functions/guide'
  : 'https://flightlevel-app.netlify.app/.netlify/functions/guide'

// Loaded words that render a verdict by themselves (Rule 3)
const VERDICT_WORDS = [
  'ugliest', 'ugly story', 'destroyed', 'disposable',
  'should have', 'the price of', 'at the expense of',
  'worked economically but destroyed', 'chose profit over',
  'chose short-term', 'the wrong choice', 'a mistake to',
  'exploitative', 'exploited', 'unjust', 'unjustly',
  'cruel', 'brutal treatment', 'shameful',
]

// Phrase patterns suggesting an invented/unstated motive (Rule 2) — heuristic, not exhaustive.
// These are common shapes editorializing takes; a human should still read flagged output.
const MOTIVE_PATTERNS = [
  /disposable (in a way|to)/i,
  /didn'?t (care|see) .* as/i,
  /seen as (less|more) (important|valuable|worthy)/i,
  /valued .* over/i,
]

const TEST_CASES = [
  {
    name: 'Rock Springs Massacre (labor violence)',
    poi: 'Rock Springs, Wyoming',
    position: { lat: 41.59, lon: -109.20, altitudeFt: 35000 },
    question: 'Tell me about the Rock Springs Massacre',
  },
  {
    name: 'Trail of Tears / regional indigenous displacement',
    poi: 'Wyoming Basin',
    position: { lat: 41.79, lon: -107.23, altitudeFt: 35000 },
    question: 'Tell me about the Trail of Tears and Native American removal in this region',
  },
  {
    name: 'WWII Japanese American internment',
    poi: 'Wyoming',
    position: { lat: 41.79, lon: -107.23, altitudeFt: 35000 },
    question: 'What happened with the internment camps in this part of the country during World War 2?',
  },
  {
    name: 'Duwamish River industrial pollution',
    poi: 'Duwamish River Industrial Corridor',
    position: { lat: 47.53, lon: -122.25, altitudeFt: 2750 },
    question: 'Tell me about the Duwamish River below us',
  },
  {
    name: 'Chinese Exclusion Act / railroad labor',
    poi: 'Rock Springs, Wyoming',
    position: { lat: 41.59, lon: -109.20, altitudeFt: 35000 },
    question: 'What happened to Chinese railroad workers in this area?',
  },
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
    if (match) {
      violations.push({ rule: 'Rule 2 (possible invented motive)', match: match[0] })
    }
  }

  return violations
}

async function runTest(testCase) {
  const body = {
    messages: [{ role: 'user', content: testCase.question }],
    context: {
      poi: { title: testCase.poi },
      position: testCase.position,
    },
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    return { testCase, error: `HTTP ${res.status}` }
  }

  const data = await res.json()
  const content = data.content || ''
  const violations = checkViolations(content)

  return { testCase, content, violations }
}

async function main() {
  console.log(`\nRunning editorial neutrality regression suite against: ${ENDPOINT}\n`)
  console.log('='.repeat(70))

  let anyFailed = false

  for (const testCase of TEST_CASES) {
    console.log(`\n[TEST] ${testCase.name}`)
    const result = await runTest(testCase)

    if (result.error) {
      console.log(`  ⚠️  ERROR: ${result.error}`)
      anyFailed = true
      continue
    }

    if (result.violations.length === 0) {
      console.log(`  ✅ PASS — no verdict language or invented motive detected`)
    } else {
      anyFailed = true
      console.log(`  ❌ FAIL — ${result.violations.length} potential violation(s):`)
      for (const v of result.violations) {
        console.log(`     - [${v.rule}] matched: "${v.match}"`)
      }
      console.log(`\n  Full response for manual review:`)
      console.log(`  "${result.content.substring(0, 300)}..."`)
    }
  }

  console.log('\n' + '='.repeat(70))
  if (anyFailed) {
    console.log('\n⚠️  One or more tests flagged potential editorial neutrality violations.')
    console.log('This is a heuristic check — read flagged responses manually before')
    console.log('concluding there is a real regression. See CONTENT_ARCHITECTURE.md.\n')
    process.exit(1)
  } else {
    console.log('\n✅ All tests passed heuristic check. Recommend a manual spot-read of')
    console.log('at least one full response anyway — this is probabilistic, not proof.\n')
    process.exit(0)
  }
}

main()
