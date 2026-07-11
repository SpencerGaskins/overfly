// Netlify serverless function — proxies NOAA PIREP API to bypass CORS
// Deployed at: /.netlify/functions/pirep

import { CORS_HEADERS, handleCORS } from './cors.js'

export async function handler(event) {
  const preflight = handleCORS(event)
  if (preflight) return preflight

  const params = new URLSearchParams(event.queryStringParameters)
  const url = `https://aviationweather.gov/api/data/pirep?${params}`

  try {
    const res = await fetch(url)

    if (res.status === 204) {
      return { statusCode: 200, headers: CORS_HEADERS, body: '[]' }
    }

    if (!res.ok) {
      return { statusCode: res.status, headers: CORS_HEADERS, body: JSON.stringify({ error: res.statusText }) }
    }

    const data = await res.text()
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: data,
    }
  } catch (err) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
