import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function err(code: string, message: string, status: number) {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Assign margin points to the managers who predicted the correct winner.
// Rank by closeness (ascending |predicted_margin - actual_margin|).
// Top 3 get 3/2/1 points; ties share the points for the tied ranks equally.
// Returns a map: profile_id → margin_points (as a decimal number).
function assignMarginPoints(
  correct: Array<{ profile_id: string; predicted_margin: number }>,
  actual_margin: number,
): Map<string, number> {
  const out = new Map<string, number>()
  if (correct.length === 0) return out

  // Compute absolute error for each correct predictor.
  const withError = correct.map(c => ({
    profile_id: c.profile_id,
    error: Math.abs(c.predicted_margin - actual_margin),
  }))
  withError.sort((a, b) => a.error - b.error)

  // Available points for rank 1, 2, 3.
  const RANK_PTS = [3, 2, 1]

  let i = 0
  while (i < withError.length) {
    const currentError = withError[i].error
    // Find all tied at this error value.
    let j = i
    while (j < withError.length && withError[j].error === currentError) j++
    const tieCount = j - i

    // Sum the points available for ranks i..j-1, split equally.
    let ptSum = 0
    for (let k = i; k < j; k++) ptSum += RANK_PTS[k] ?? 0
    const ptEach = tieCount > 0 ? ptSum / tieCount : 0

    for (let k = i; k < j; k++) {
      out.set(withError[k].profile_id, ptEach)
    }
    i = j
  }

  return out
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'POST only', 405)

  // ── Parse body ────────────────────────────────────────────────
  let season_id: number, round_number: number
  try {
    ;({ season_id, round_number } = await req.json())
  } catch {
    return err('INVALID_REQUEST', 'Invalid JSON body', 400)
  }
  if (!season_id || !round_number) {
    return err('INVALID_REQUEST', 'season_id and round_number are required', 400)
  }

  // ── Clients ───────────────────────────────────────────────────
  const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceRoleKey)

  // ── Auth: admin only ──────────────────────────────────────────
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return err('UNAUTHORIZED', 'Missing auth token', 401)

  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return err('UNAUTHORIZED', 'Invalid session', 401)

  const { data: callerProfile } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!callerProfile?.is_admin) return err('FORBIDDEN', 'Admin only', 403)

  // ── Load matches for the round ────────────────────────────────
  const { data: matchRows, error: matchErr } = await admin
    .from('matches')
    .select('id, home_nation, away_nation')
    .eq('season_id', season_id)
    .eq('round_number', round_number)

  if (matchErr) return err('DB_ERROR', matchErr.message, 500)
  if (!matchRows?.length) return err('NO_MATCHES', `No matches for round ${round_number}`, 404)

  const matchIds = matchRows.map((m: { id: number }) => m.id)

  // ── Load predo_results and predo_predictions ──────────────────
  const [resultsRes, predsRes] = await Promise.all([
    admin.from('predo_results').select('match_id, actual_winner, actual_margin').in('match_id', matchIds),
    admin.from('predo_predictions').select('profile_id, match_id, predicted_winner, predicted_margin').in('match_id', matchIds),
  ])

  if (resultsRes.error) return err('DB_ERROR', resultsRes.error.message, 500)
  if (predsRes.error)   return err('DB_ERROR', predsRes.error.message, 500)

  const results  = resultsRes.data ?? []
  const preds    = predsRes.data ?? []

  // Require results for all matches before scoring.
  const resultedIds = new Set(results.map((r: { match_id: number }) => r.match_id))
  const missing = matchIds.filter(id => !resultedIds.has(id))
  if (missing.length > 0) {
    const names = matchRows
      .filter((m: { id: number }) => missing.includes(m.id))
      .map((m: { home_nation: string; away_nation: string }) => `${m.home_nation} vs ${m.away_nation}`)
      .join(', ')
    return err('MISSING_RESULTS', `Results not yet entered for: ${names}`, 409)
  }

  // ── Score ─────────────────────────────────────────────────────
  type ResultRow = { match_id: number; actual_winner: string; actual_margin: number }
  type PredRow   = { profile_id: string; match_id: number; predicted_winner: string; predicted_margin: number }

  // Build result map: match_id → result
  const resultMap = new Map<number, ResultRow>()
  for (const r of results as ResultRow[]) resultMap.set(r.match_id, r)

  // Accumulate per-manager totals: profile_id → { winPts, marginPts }
  const totals = new Map<string, { winPts: number; marginPts: number }>()

  function ensureManager(id: string) {
    if (!totals.has(id)) totals.set(id, { winPts: 0, marginPts: 0 })
    return totals.get(id)!
  }

  for (const match of matchRows as { id: number; home_nation: string; away_nation: string }[]) {
    const result = resultMap.get(match.id)
    if (!result) continue

    const matchPreds = (preds as PredRow[]).filter(p => p.match_id === match.id)

    // Winner points and collect correct predictors for margin scoring.
    const correct: Array<{ profile_id: string; predicted_margin: number }> = []

    for (const pred of matchPreds) {
      const mgr = ensureManager(pred.profile_id)
      const gotIt = pred.predicted_winner === result.actual_winner
      mgr.winPts += gotIt ? 1 : -1
      if (gotIt) correct.push({ profile_id: pred.profile_id, predicted_margin: pred.predicted_margin })
    }

    // Margin points — only among correct predictors.
    const marginMap = assignMarginPoints(correct, result.actual_margin)
    for (const [profileId, pts] of marginMap.entries()) {
      ensureManager(profileId).marginPts += pts
    }
  }

  // ── Upsert predo_scores ───────────────────────────────────────
  const upsertRows = Array.from(totals.entries()).map(([profile_id, t]) => ({
    season_id,
    profile_id,
    round_number,
    winning_team_points: t.winPts,
    margin_points:       t.marginPts,
    total_points:        t.winPts + t.marginPts,
  }))

  if (upsertRows.length > 0) {
    const { error: upsertErr } = await admin
      .from('predo_scores')
      .upsert(upsertRows, { onConflict: 'season_id,profile_id,round_number' })

    if (upsertErr) return err('DB_ERROR', upsertErr.message, 500)
  }

  // Return the round leaderboard sorted by total_points desc.
  const leaderboard = upsertRows
    .sort((a, b) => b.total_points - a.total_points)
    .map(r => ({
      profile_id:          r.profile_id,
      winning_team_points: r.winning_team_points,
      margin_points:       r.margin_points,
      total_points:        r.total_points,
    }))

  return ok({
    round_number,
    managers_scored: leaderboard.length,
    scores: leaderboard,
  })
})
