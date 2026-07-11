// Shared CORS headers for all Netlify functions
// Allows cross-origin requests from localhost:5173 in dev and any origin in prod

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version',
}

// Call this at the top of every handler to handle preflight
export function handleCORS(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' }
  }
  return null
}
