// Netlify proxy for NWS Weather Alerts API
// Handles geo+json content type that browsers can't fetch directly
// Deployed at: /.netlify/functions/weather

import { CORS_HEADERS, handleCORS } from './cors.js'

export async function handler(event) {
  const preflight = handleCORS(event)
  if (preflight) return preflight

  const { lat, lon } = event.queryStringParameters || {}

  if (!lat || !lon) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'lat and lon required' }) }
  }

  try {
    const res = await fetch(
      `https://api.weather.gov/alerts/active?point=${lat},${lon}&status=actual&message_type=alert`,
      { headers: { 'Accept': 'application/geo+json', 'User-Agent': 'FlightLevel/1.0' } }
    )

    if (!res.ok) {
      return { statusCode: res.status, headers: CORS_HEADERS, body: JSON.stringify({ error: res.statusText }) }
    }

    const data = await res.json()
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  } catch (err) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
