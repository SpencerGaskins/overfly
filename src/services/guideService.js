/**
 * FlightLevel Guide Service
 *
 * Client-side interface to the AI guide Netlify function.
 * Manages conversation history and context injection.
 *
 * Usage:
 *   const guide = new GuideSession({ poi, position, corridor })
 *   const reply = await guide.ask("What happened here?")
 *   guide.reset()
 */

const IS_DEV = window.location.port === '5173'
const GUIDE_ENDPOINT = IS_DEV
  ? 'http://localhost:8888/.netlify/functions/guide'
  : '/.netlify/functions/guide'

// Fallback responses when the guide is unavailable (offline / no WiFi)
const OFFLINE_RESPONSES = [
  "I'm having trouble reaching the ground right now — we must be out of range. The story's still there below you though.",
  "Signal's weak up here. Try again in a moment.",
  "Can't check with the ground right now. We'll pick this up when the connection comes back.",
]

export class GuideSession {
  /**
   * @param {object} context
   * @param {object} context.poi       — active POI { title, extract, lat, lon }
   * @param {object} context.position  — { lat, lon, altitudeFt, heading }
   * @param {string} context.corridor  — e.g. 'SEA-DEN'
   */
  constructor(context = {}) {
    this.context  = context
    this.messages = []  // [{ role: 'user'|'assistant', content: string }]
  }

  /**
   * Update flight context (position changes during conversation).
   */
  updateContext(context) {
    this.context = { ...this.context, ...context }
  }

  /**
   * Send a message and get a reply.
   * @param {string} userMessage
   * @returns {Promise<string>} — assistant reply text
   */
  async ask(userMessage) {
    this.messages.push({ role: 'user', content: userMessage })

    try {
      const res = await fetch(GUIDE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: this.messages,
          context:  this.context,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const data = await res.json()
      const reply = data.content || ''

      this.messages.push({ role: 'assistant', content: reply })
      return reply

    } catch (err) {
      console.warn('[guide] Request failed:', err.message)
      // Remove the user message we just added so they can retry
      this.messages.pop()
      const fallback = OFFLINE_RESPONSES[Math.floor(Math.random() * OFFLINE_RESPONSES.length)]
      return fallback
    }
  }

  /**
   * Start a new conversation about the same POI.
   * Keeps context, clears message history.
   */
  reset() {
    this.messages = []
  }

  /**
   * Get the full conversation history.
   */
  getHistory() {
    return [...this.messages]
  }

  /**
   * True if there's an active conversation (at least one exchange).
   */
  get isActive() {
    return this.messages.length > 0
  }
}

/**
 * Build the opening message for a POI.
 * Used when the passenger taps "Tell me about this →"
 */
export function buildOpeningPrompt(poi) {
  if (!poi) return 'Tell me about what\'s below right now.'
  return `Tell me about ${poi.title || poi.name}.`
}
