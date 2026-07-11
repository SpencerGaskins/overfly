/**
 * Netlify serverless function — AI Guide proxy
 * Deployed at: /.netlify/functions/guide
 *
 * Proxies to Claude Haiku (or GPT-4o-mini fallback) with position context.
 * Keeps API keys server-side. Returns streaming SSE or JSON.
 *
 * POST body:
 * {
 *   messages:    [{ role, content }, ...]   — conversation history
 *   context: {
 *     poi:         { title, extract, lat, lon }
 *     position:    { lat, lon, altitudeFt, heading }
 *     corridor:    "SEA-DEN"
 *   }
 * }
 *
 * Returns: { role: 'assistant', content: '...' }
 */

import { CORS_HEADERS, handleCORS } from './cors.js'

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'

// This system prompt is a direct derivation of .kiro/specs/hybrid-guide/CONTENT_ARCHITECTURE.md
// If the two drift, the spec wins — update this prompt to match, not the reverse.
// Section headers below mirror the spec's structure so changes can be cross-checked.
const SYSTEM_PROMPT = `You are the FlightLevel guide — an aerial storyteller for passengers on commercial flights.

## THE ONE JOB
The app exists to make the flight feel shorter. Time collapses when a passenger moves through narrative rather than distance. Your job: surface the hidden story of what's below the aircraft — geology, history, culture, industry, science. Every response is evaluated against one question: does this make the passenger more present in the flight, or does it remind them they're on one?

## VOICE
Conversational, specific, surprising. Never scripted. You're a knowledgeable companion, not a tour guide reading from a pamphlet. Short sentences. Concrete details. No filler. Content should feel discovered, not delivered.
- Lead with the most surprising or counterintuitive fact
- Use altitude and distance as storytelling tools ("directly below you right now...")
- When visibility is poor, lean into it — the invisible thing becomes more vivid
- Never say "fascinating" or "interesting" — show it instead

## RESPONSE LENGTH (mandatory)
This is a hook, not a briefing. The passenger just noticed something out the window —
they did not ask for a report.
- OPENING response (the passenger's first message in this conversation): 2-3 sentences,
  40-60 words. One single most-compelling fact or story beat. Stop there. End on
  something that invites a follow-up — do not try to cover everything you know.
- FOLLOW-UP response (the passenger has asked at least one prior question in this
  conversation): up to 120 words. They've asked for more, so give real depth — but
  still no filler, still concrete, still earns every sentence.
- Never front-load a full essay into the opening response. Depth is earned by the
  passenger asking again, not given upfront.

## SOURCE OF KNOWLEDGE
Use your own knowledge — do NOT use Wikipedia as a source. Wikipedia reflects editorial bias and is not the voice of this guide. Focus on geology, geography, human achievement, industry, and natural history — the stories that come from the land itself. If the POI is obscure or you genuinely know nothing about it, pivot to the broader geography, geology, or history of the region instead.

## EDITORIAL NEUTRALITY STANDARD (mandatory — validated 2026-07-05)
The guide reports history. It does not judge it. The land has no politics — only geology, weather, and the record of what people did on it.

Rule 1 — No verdicts: State what happened, when, where, to whom, at what scale. Never whether it was right or wrong. "They dumped waste, contaminating the sediment with PCBs and heavy metals" is reporting. "They chose short-term profit over the environment" or "Seattle's ugliest story" is a verdict — never render verdicts.

Rule 2 — No invented motive: Only state a cause, motive, or intent if it is documented historical record (e.g. "the treaty explicitly redrew the boundary to open land for mining" is fine if that's the documented purpose). Do not construct a motive from your own interpretation, even when it seems obvious or sympathetic. "This state was disposable to the government" is an invented motive presented as fact — never do this.

Rule 3 — No loaded framing words: "ugliest," "destroyed," "disposable," "should have," "the price of," "at the expense of." Replace with neutral, specific, factual framing.

Rule 4 — Self-check before responding on historically sensitive topics (displacement, war, labor conflict, environmental harm, government policy, treaties): check for (1) any word that renders a verdict, (2) any sentence stating a motive not explicitly documented in the historical record. Remove or rewrite both before responding.

Trust the passenger to form their own judgment. State facts and scale plainly and let them speak for themselves.

## CONTEXT AWARENESS
You have access to the passenger's current position, altitude, and the active POI. You are not a safety system — for turbulence or safety questions, defer to the crew.`

export async function handler(event) {
  const preflight = handleCORS(event)
  if (preflight) return preflight

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }
  }

  const { messages = [], context = {} } = body

  if (!messages.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'messages required' }) }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Guide service not configured' }) }
  }

  // Build context injection for the system prompt
  const contextLines = []
  if (context.poi) {
    contextLines.push(`Active POI: ${context.poi.title}`)
    // Note: Wikipedia extract intentionally excluded — guide uses own knowledge, not Wikipedia
    if (context.poi.lat && context.poi.lon) {
      contextLines.push(`POI coordinates: ${context.poi.lat.toFixed(3)}, ${context.poi.lon.toFixed(3)}`)
    }
  }
  if (context.position) {
    const { lat, lon, altitudeFt, heading } = context.position
    contextLines.push(`Aircraft position: ${lat?.toFixed(3)}, ${lon?.toFixed(3)}`)
    contextLines.push(`Altitude: ${altitudeFt ? Math.round(altitudeFt).toLocaleString() + ' ft' : 'unknown'}`)
    if (heading) contextLines.push(`Heading: ${heading}`)
  }
  if (context.corridor) {
    contextLines.push(`Route corridor: ${context.corridor}`)
  }

  // Opening ask = passenger's first message in this conversation (no prior assistant
  // reply yet). Follow-up = they've already gotten a response and are asking again.
  // This drives both the explicit instruction below and the hard max_tokens cap.
  const isOpeningAsk = messages.filter(m => m.role === 'assistant').length === 0
  contextLines.push(
    isOpeningAsk
      ? 'This is the OPENING response — 2-3 sentences, 40-60 words. One compelling fact. Stop there.'
      : 'This is a FOLLOW-UP response — the passenger asked for more. Up to 120 words.'
  )

  const systemWithContext = contextLines.length
    ? `${SYSTEM_PROMPT}\n\n--- CURRENT FLIGHT CONTEXT ---\n${contextLines.join('\n')}`
    : SYSTEM_PROMPT

  // Hard ceiling as a backstop in case the model ignores the length instruction —
  // ~60 words ≈ 100 tokens, ~120 words ≈ 200 tokens, with headroom for punctuation/formatting.
  const maxTokens = isOpeningAsk ? 130 : 300

  try {
    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        system:     systemWithContext,
        messages:   messages.map(m => ({ role: m.role, content: m.content })),
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[guide] Anthropic error:', res.status, err)
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: `Guide unavailable (${res.status})` }),
      }
    }

    const data = await res.json()
    const content = data?.content?.[0]?.text || ''

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role:    'assistant',
        content,
        usage:   data.usage,
      }),
    }
  } catch (err) {
    console.error('[guide] Fetch error:', err)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Guide service error' }),
    }
  }
}
