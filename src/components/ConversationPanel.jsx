import { useState, useEffect, useRef } from 'react'
import { GuideSession, buildOpeningPrompt } from '../services/guideService'
import './ConversationPanel.css'

/**
 * ConversationPanel
 *
 * Full-screen conversation overlay with the AI guide.
 * Opens when passenger taps "Tell me about this →" on a POI card.
 *
 * Props:
 *   poi        — active POI { title, name, extract, lat, lon }
 *   position   — { lat, lon, altitudeFt, heading }
 *   corridor   — e.g. 'SEA-DEN'
 *   onClose    — called when passenger dismisses the panel
 */
export default function ConversationPanel({ poi, position, corridor, onClose }) {
  const [messages, setMessages]   = useState([])   // [{ role, content, id }]
  const [input, setInput]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)

  const sessionRef  = useRef(null)
  const bottomRef   = useRef(null)
  const inputRef    = useRef(null)

  // Initialize session and fire opening message
  useEffect(() => {
    sessionRef.current = new GuideSession({ poi, position, corridor })

    async function openConversation() {
      setLoading(true)
      setError(null)
      const prompt = buildOpeningPrompt(poi)
      const reply  = await sessionRef.current.ask(prompt)
      setMessages([
        { role: 'user',      content: prompt, id: 'open-user' },
        { role: 'assistant', content: reply,  id: 'open-reply' },
      ])
      setLoading(false)
    }

    openConversation()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Focus input after opening message arrives
  useEffect(() => {
    if (!loading && messages.length > 0) {
      inputRef.current?.focus()
    }
  }, [loading])

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setError(null)

    const userMsg = { role: 'user', content: text, id: `u-${Date.now()}` }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    // Update position context in case aircraft has moved
    sessionRef.current.updateContext({ position })

    const reply = await sessionRef.current.ask(text)
    setMessages(prev => [...prev, { role: 'assistant', content: reply, id: `a-${Date.now()}` }])
    setLoading(false)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const poiName = poi?.title || poi?.name || 'this area'

  return (
    <div className="conv-panel">
      {/* Header */}
      <div className="conv-header">
        <div className="conv-header-info">
          <span className="conv-header-label">GUIDE</span>
          <span className="conv-header-poi">{poiName}</span>
        </div>
        <button className="conv-close" onClick={onClose} aria-label="Close conversation">✕</button>
      </div>

      {/* Message thread */}
      <div className="conv-messages" role="log" aria-live="polite">
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`conv-msg conv-msg--${msg.role}`}
          >
            {msg.role === 'assistant' && (
              <span className="conv-msg-label">✈</span>
            )}
            <p className="conv-msg-text">{msg.content}</p>
          </div>
        ))}

        {loading && (
          <div className="conv-msg conv-msg--assistant conv-msg--loading">
            <span className="conv-msg-label">✈</span>
            <p className="conv-msg-text">
              <span className="conv-typing">
                <span />
                <span />
                <span />
              </span>
            </p>
          </div>
        )}

        {error && (
          <div className="conv-error">{error}</div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Suggested follow-ups — shown after first reply */}
      {messages.length >= 2 && !loading && (
        <div className="conv-suggestions">
          {getSuggestions(poi).map((s, i) => (
            <button
              key={i}
              className="conv-suggestion"
              onClick={() => { setInput(s); inputRef.current?.focus() }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="conv-input-row">
        <input
          ref={inputRef}
          className="conv-input"
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything..."
          disabled={loading}
          maxLength={200}
          aria-label="Ask the guide"
        />
        <button
          className="conv-send"
          onClick={handleSend}
          disabled={!input.trim() || loading}
          aria-label="Send"
        >
          →
        </button>
      </div>
    </div>
  )
}

// ── Contextual follow-up suggestions ─────────────────────────────
function getSuggestions(poi) {
  if (!poi) return ['What else is nearby?', 'How old is this?', 'Tell me more.']

  const title = (poi.title || poi.name || '').toLowerCase()

  if (/volcano|mountain|peak|crater/i.test(title)) {
    return ['When did it last erupt?', 'How tall is it?', 'Can you see it from here?']
  }
  if (/river|lake|dam|canyon/i.test(title)) {
    return ['How was it formed?', 'What lives here?', 'Any history here?']
  }
  if (/nuclear|hanford|reactor/i.test(title)) {
    return ['Is it still active?', 'How much did it produce?', 'What happened here?']
  }
  if (/pass|range|basin/i.test(title)) {
    return ['Why is it turbulent here?', 'What\'s the geology?', 'Who crossed here first?']
  }
  if (/fort|battle|war|history/i.test(title)) {
    return ['What happened here?', 'Who won?', 'What\'s left today?']
  }

  return ['Tell me more.', 'What\'s the history?', 'What else is nearby?']
}
