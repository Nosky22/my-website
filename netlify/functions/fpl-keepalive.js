// Scheduled keep-alive: runs every 3 days to prevent free-tier Supabase pausing.
// Queries fpl.seasons (service role bypasses RLS) so the connection stays active.
//
// Required env vars (already set for lock-squads):
//   VITE_SUPABASE_URL      — Supabase REST base URL
//   SUPABASE_SERVICE_ROLE_KEY — secret, never exposed to browser

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

exports.handler = async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('fpl-keepalive: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return { statusCode: 500, body: 'Missing env vars' }
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/fpl.seasons?select=id&limit=1`, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(`fpl-keepalive: ping returned ${res.status}: ${text}`)
      return { statusCode: 500, body: `Ping failed: ${res.status}` }
    }

    console.log('fpl-keepalive: ping succeeded')
    return { statusCode: 200, body: 'ok' }
  } catch (err) {
    console.error('fpl-keepalive: network error:', err.message)
    return { statusCode: 500, body: err.message }
  }
}
