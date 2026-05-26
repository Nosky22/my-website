// Scheduled function: runs every 15 minutes to lock round squads past their kickoff deadline.
// Also accepts HTTP POST from the admin UI to trigger an immediate lock for a specific round.
//
// Required env vars:
//   SUPABASE_URL              — e.g. https://vtgeweowikddwrmrbhkx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — secret, never exposed to browser

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

// ── REST helpers ──────────────────────────────────────────────────────────────

function baseHeaders() {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
}

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: baseHeaders() })
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function sbPost(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${table} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function sbPatch(table, filter, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: baseHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${table} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function sbDelete(table, filter) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
    headers: baseHeaders(),
  })
  if (!res.ok) throw new Error(`DELETE ${table} → ${res.status}: ${await res.text()}`)
}

// ── Auth check ────────────────────────────────────────────────────────────────

// Returns the admin's profile UUID if the JWT belongs to an admin, else null.
async function verifyAdmin(jwt) {
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${jwt}` },
    })
    if (!userRes.ok) return null
    const user = await userRes.json()
    const profiles = await sbGet(`profiles?id=eq.${user.id}&select=is_admin`)
    return profiles[0]?.is_admin === true ? user.id : null
  } catch {
    return null
  }
}

// ── Core locking logic ────────────────────────────────────────────────────────

// Locks squads for a single round of a season.
// Returns { alreadyLocked, locked, copied, empty } or { alreadyLocked, error }.
// actorId: profile UUID for audit log. Pass null for system-triggered runs (skips audit log).
async function lockRound(seasonId, roundNumber, now, actorId) {
  // Managers for this season come from draft_order (admin-set source of truth).
  const draftOrder = await sbGet(`draft_order?season_id=eq.${seasonId}&select=profile_id`)
  const allManagers = [...new Set(draftOrder.map(d => d.profile_id))]

  if (allManagers.length === 0) {
    return { alreadyLocked: false, error: 'No managers found in draft_order for this season' }
  }

  const squads = await sbGet(
    `manager_round_squads?season_id=eq.${seasonId}&round_number=eq.${roundNumber}&select=id,profile_id,status`
  )
  const squadByManager = new Map(squads.map(s => [s.profile_id, s]))

  // Nothing to do if every manager already has a locked squad.
  if (allManagers.every(id => squadByManager.get(id)?.status === 'locked')) {
    return { alreadyLocked: true }
  }

  const summary = { alreadyLocked: false, locked: 0, copied: 0, empty: 0 }

  for (const profileId of allManagers) {
    const squad = squadByManager.get(profileId)
    if (squad?.status === 'locked') continue

    if (squad?.status === 'submitted') {
      await sbPatch('manager_round_squads', `id=eq.${squad.id}`, {
        status: 'locked',
        locked_at: now,
      })
      summary.locked++
    } else {
      // draft squad or no squad — discard draft and roll over from previous round
      if (squad?.status === 'draft') {
        await sbDelete('manager_round_squads', `id=eq.${squad.id}`)
      }

      const prevSquads = await sbGet(
        `manager_round_squads?season_id=eq.${seasonId}&profile_id=eq.${profileId}&status=eq.locked&round_number=lt.${roundNumber}&order=round_number.desc&limit=1&select=id,round_number`
      )

      if (prevSquads.length > 0) {
        const prevPlayers = await sbGet(
          `manager_round_squad_players?squad_id=eq.${prevSquads[0].id}&select=player_id,role,is_captain`
        )
        const [newSquad] = await sbPost('manager_round_squads', {
          season_id:    seasonId,
          profile_id:   profileId,
          round_number: roundNumber,
          status:       'locked',
          locked_at:    now,
          submitted_at: now,
        })
        if (prevPlayers.length > 0) {
          await sbPost('manager_round_squad_players', prevPlayers.map(p => ({
            squad_id:   newSquad.id,
            player_id:  p.player_id,
            role:       p.role,
            is_captain: p.is_captain,
          })))
        }
        summary.copied++
      } else {
        // First round, no previous squad — create an empty locked placeholder.
        await sbPost('manager_round_squads', {
          season_id:    seasonId,
          profile_id:   profileId,
          round_number: roundNumber,
          status:       'locked',
          locked_at:    now,
        })
        summary.empty++
      }
    }
  }

  // Audit log — only when a real actor is available (admin-triggered runs).
  if (actorId) {
    try {
      await sbPost('audit_log', {
        actor_id:    actorId,
        action:      'lock_round',
        entity_type: 'round',
        entity_id:   String(roundNumber),
        season_id:   seasonId,
        metadata:    { round_number: roundNumber, ...summary },
      })
    } catch (err) {
      console.error('Failed to write audit log:', err.message)
    }
  }

  return summary
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('lock-squads: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return { statusCode: 500, body: 'Missing env vars' }
  }

  const now = new Date().toISOString()

  // Admin manual trigger: POST with { season_id, round_number } + Authorization header.
  if (event.httpMethod === 'POST' && event.body) {
    let body
    try { body = JSON.parse(event.body) } catch {
      return { statusCode: 400, body: 'Invalid JSON' }
    }
    const { season_id, round_number } = body
    if (!season_id || !round_number) {
      return { statusCode: 400, body: 'Missing season_id or round_number' }
    }

    const jwt = (event.headers.authorization ?? event.headers.Authorization ?? '').replace(/^Bearer /, '')
    const actorId = await verifyAdmin(jwt)
    if (!actorId) return { statusCode: 403, body: 'Admin access required' }

    try {
      const summary = await lockRound(season_id, round_number, now, actorId)
      return { statusCode: 200, body: JSON.stringify(summary) }
    } catch (err) {
      console.error(`lock-squads manual: season ${season_id} round ${round_number}:`, err.message)
      return { statusCode: 500, body: err.message }
    }
  }

  // Scheduled trigger: scan all active seasons for rounds past their deadline.
  try {
    const seasons = await sbGet('seasons?status=eq.active&select=id')
    const results = []

    for (const season of seasons) {
      const matches = await sbGet(
        `matches?season_id=eq.${season.id}&kickoff_at=not.is.null&select=round_number,kickoff_at`
      )

      // Find the earliest kickoff per round.
      const deadlineByRound = new Map()
      for (const m of matches) {
        const cur = deadlineByRound.get(m.round_number)
        if (!cur || m.kickoff_at < cur) deadlineByRound.set(m.round_number, m.kickoff_at)
      }

      for (const [round, deadline] of deadlineByRound) {
        if (deadline >= now) continue
        try {
          const summary = await lockRound(season.id, round, now, null)
          if (summary.alreadyLocked) continue
          console.log(`lock-squads: season ${season.id} round ${round}`, summary)
          results.push({ season_id: season.id, round, ...summary })
        } catch (err) {
          console.error(`lock-squads: season ${season.id} round ${round}:`, err.message)
        }
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, results }) }
  } catch (err) {
    console.error('lock-squads scheduled error:', err.message)
    return { statusCode: 500, body: err.message }
  }
}
