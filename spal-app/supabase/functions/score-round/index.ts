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

// H2H group result computation.
// Pair:   win=place 1/4pts, draw=place 2/2pts each, loss=place 3/0pts
// Triple: normal places 1/4, 2/2, 3/0
//   Tie for 1st (A==B>C): A=1/3, B=1/3, C=3/0
//   Tie for 2nd (A>B==C): A=1/4, B=2/1, C=2/1
//   All tied:             all=2/2
function computeGroupResults(
  members: Array<{ profile_id: string; round_points: number }>,
): Array<{ profile_id: string; group_place: number; h2h_points: number }> {
  const s = [...members].sort((a, b) => b.round_points - a.round_points)

  if (s.length === 2) {
    if (s[0].round_points === s[1].round_points) {
      return [
        { profile_id: s[0].profile_id, group_place: 2, h2h_points: 2 },
        { profile_id: s[1].profile_id, group_place: 2, h2h_points: 2 },
      ]
    }
    return [
      { profile_id: s[0].profile_id, group_place: 1, h2h_points: 4 },
      { profile_id: s[1].profile_id, group_place: 3, h2h_points: 0 },
    ]
  }

  // Triple
  const [a, b, c] = s
  const allEqual = a.round_points === b.round_points && b.round_points === c.round_points
  if (allEqual) {
    return s.map(m => ({ profile_id: m.profile_id, group_place: 2, h2h_points: 2 }))
  }

  const topTied = a.round_points === b.round_points
  if (topTied) {
    return [
      { profile_id: a.profile_id, group_place: 1, h2h_points: 3 },
      { profile_id: b.profile_id, group_place: 1, h2h_points: 3 },
      { profile_id: c.profile_id, group_place: 3, h2h_points: 0 },
    ]
  }

  const bottomTied = b.round_points === c.round_points
  if (bottomTied) {
    return [
      { profile_id: a.profile_id, group_place: 1, h2h_points: 4 },
      { profile_id: b.profile_id, group_place: 2, h2h_points: 1 },
      { profile_id: c.profile_id, group_place: 2, h2h_points: 1 },
    ]
  }

  return [
    { profile_id: a.profile_id, group_place: 1, h2h_points: 4 },
    { profile_id: b.profile_id, group_place: 2, h2h_points: 2 },
    { profile_id: c.profile_id, group_place: 3, h2h_points: 0 },
  ]
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

  // ── Load season_rules ─────────────────────────────────────────
  const { data: rulesRow, error: rulesErr } = await admin
    .from('season_rules')
    .select('rules')
    .eq('season_id', season_id)
    .single()

  if (rulesErr || !rulesRow) return err('NO_RULES', 'No season rules found', 404)

  const rules = rulesRow.rules as {
    captain_multiplier: number
    supersub_bench_multiplier: number
    supersub_starter_multiplier: number
    supersub_not_played_points: number
  }

  // ── Load round matches ────────────────────────────────────────
  const { data: matches, error: matchErr } = await admin
    .from('matches')
    .select('id, round_number, home_nation, away_nation')
    .eq('season_id', season_id)
    .eq('round_number', round_number)

  if (matchErr) return err('DB_ERROR', matchErr.message, 500)
  if (!matches?.length) {
    return err('NO_MATCHES', `No matches for season ${season_id} round ${round_number}`, 404)
  }

  const matchIds = matches.map((m: { id: number }) => m.id)

  // ── Load all scoring data in parallel ─────────────────────────
  const [squadsResult, scoresResult, matchdayResult, penaltiesResult, groupsResult] =
    await Promise.all([
      admin
        .from('manager_round_squads')
        .select('id, profile_id, manager_round_squad_players(player_id, role, is_captain)')
        .eq('season_id', season_id)
        .eq('round_number', round_number)
        .in('status', ['submitted', 'locked']),

      admin
        .from('player_match_scores')
        .select('player_id, match_id, final_points')
        .in('match_id', matchIds),

      admin
        .from('matchday_squads')
        .select('player_id, match_id, status')
        .in('match_id', matchIds),

      admin
        .from('league_penalties')
        .select('profile_id, points_adjustment')
        .eq('season_id', season_id)
        .eq('round_number', round_number),

      admin
        .from('fixture_groups')
        .select('id, fixture_group_members(profile_id)')
        .eq('season_id', season_id)
        .eq('round_number', round_number),
    ])

  if (squadsResult.error)    return err('DB_ERROR', squadsResult.error.message, 500)
  if (scoresResult.error)    return err('DB_ERROR', scoresResult.error.message, 500)
  if (matchdayResult.error)  return err('DB_ERROR', matchdayResult.error.message, 500)
  if (penaltiesResult.error) return err('DB_ERROR', penaltiesResult.error.message, 500)
  if (groupsResult.error)    return err('DB_ERROR', groupsResult.error.message, 500)

  const squads    = squadsResult.data    ?? []
  const scores    = scoresResult.data    ?? []
  const matchdays = matchdayResult.data  ?? []
  const penalties = penaltiesResult.data ?? []
  const groups    = groupsResult.data    ?? []

  if (!squads.length) return err('NO_SQUADS', 'No submitted squads for this round', 404)

  // ── Build lookup maps ─────────────────────────────────────────
  // player_id → match_id → final_points
  const scoreMap = new Map<number, Map<number, number>>()
  for (const s of scores) {
    if (!scoreMap.has(s.player_id)) scoreMap.set(s.player_id, new Map())
    scoreMap.get(s.player_id)!.set(s.match_id, s.final_points)
  }

  // player_id → match_id → matchday status
  const matchdayMap = new Map<number, Map<number, string>>()
  for (const md of matchdays) {
    if (!matchdayMap.has(md.player_id)) matchdayMap.set(md.player_id, new Map())
    matchdayMap.get(md.player_id)!.set(md.match_id, md.status)
  }

  // profile_id → total penalty for the round (negative = deduction)
  const penaltyMap = new Map<string, number>()
  for (const p of penalties) {
    penaltyMap.set(p.profile_id, (penaltyMap.get(p.profile_id) ?? 0) + Number(p.points_adjustment))
  }

  // ── Block on unknown supersub statuses ────────────────────────
  for (const squad of squads) {
    const supersub = (squad.manager_round_squad_players ?? []).find(
      (p: { role: string }) => p.role === 'supersub',
    )
    if (!supersub) continue
    for (const matchId of matchIds) {
      if (matchdayMap.get(supersub.player_id)?.get(matchId) === 'unknown') {
        return err(
          'UNKNOWN_STATUS',
          `Supersub ${supersub.player_id} has unknown matchday status for match ${matchId} — resolve before scoring`,
          409,
        )
      }
    }
  }

  // ── Score each manager ────────────────────────────────────────
  type MatchScoreRow = {
    squad_id: number
    match_id: number
    profile_id: string
    season_id: number
    starters_raw_points: number
    supersub_raw_points: number
    supersub_multiplier_applied: number
    adjusted_points: number
    final_points: number
    status: string
  }

  const matchScoreRows: MatchScoreRow[] = []
  // profile_id → round score (adjusted + penalty) — used for H2H and response
  const roundScoreByProfile = new Map<string, number>()

  for (const squad of squads) {
    const squadPlayers = squad.manager_round_squad_players ?? []
    const starters = squadPlayers.filter((p: { role: string }) => p.role === 'starter')
    const supersub = squadPlayers.find((p: { role: string }) => p.role === 'supersub')
    const captain  = starters.find((p: { is_captain: boolean }) => p.is_captain)

    // Determine which match the supersub played in and what their status was
    let supersubMatchId: number | null = null
    let supersubStatus = 'not_selected'
    if (supersub) {
      for (const matchId of matchIds) {
        const status = matchdayMap.get(supersub.player_id)?.get(matchId)
        if (status === 'bench' || status === 'starting' || status === 'not_selected') {
          supersubMatchId = matchId
          supersubStatus = status
          break
        }
      }
    }

    let squadAdjustedTotal = 0

    for (const match of matches) {
      // Raw points from all 15 starters who played in this match
      let startersRaw = 0
      for (const starter of starters) {
        startersRaw += scoreMap.get(starter.player_id)?.get(match.id) ?? 0
      }

      // Extra points from captain multiplier (already included in startersRaw as ×1)
      let captainBonus = 0
      if (captain) {
        const captainPts = scoreMap.get(captain.player_id)?.get(match.id) ?? 0
        captainBonus = captainPts * (rules.captain_multiplier - 1)
      }

      // Supersub contribution (only for the one match they played in)
      let supersubRaw = 0
      let supersubMultiplier = 0
      if (supersub && supersubMatchId === match.id) {
        const basePts = scoreMap.get(supersub.player_id)?.get(match.id) ?? 0
        if (supersubStatus === 'bench') {
          supersubMultiplier = rules.supersub_bench_multiplier
          supersubRaw = basePts
        } else if (supersubStatus === 'starting') {
          supersubMultiplier = rules.supersub_starter_multiplier
          supersubRaw = basePts
        }
        // not_selected: both remain 0
      }

      const adjusted = startersRaw + captainBonus + supersubRaw * supersubMultiplier

      matchScoreRows.push({
        squad_id:                    squad.id,
        match_id:                    match.id,
        profile_id:                  squad.profile_id,
        season_id,
        starters_raw_points:         startersRaw,
        supersub_raw_points:         supersubRaw,
        supersub_multiplier_applied: supersubMultiplier,
        adjusted_points:             adjusted,
        final_points:                adjusted,
        status:                      'provisional',
      })

      squadAdjustedTotal += adjusted
    }

    const penalty = penaltyMap.get(squad.profile_id) ?? 0
    roundScoreByProfile.set(squad.profile_id, squadAdjustedTotal + penalty)
  }

  // ── Upsert manager_match_scores ───────────────────────────────
  const { error: upsertScoresErr } = await admin
    .from('manager_match_scores')
    .upsert(matchScoreRows, { onConflict: 'squad_id,match_id' })

  if (upsertScoresErr) return err('DB_ERROR', upsertScoresErr.message, 500)

  // ── H2H (skipped if no fixture groups for this round) ─────────
  if (groups.length > 0) {
    const h2hRows: Array<{
      fixture_group_id: number
      profile_id: string
      season_id: number
      round_points: number
      group_place: number
      h2h_points: number
    }> = []

    for (const group of groups) {
      const members = (group.fixture_group_members ?? []).map((m: { profile_id: string }) => ({
        profile_id:   m.profile_id,
        round_points: roundScoreByProfile.get(m.profile_id) ?? 0,
      }))

      for (const result of computeGroupResults(members)) {
        h2hRows.push({
          fixture_group_id: group.id,
          profile_id:       result.profile_id,
          season_id,
          round_points:     roundScoreByProfile.get(result.profile_id) ?? 0,
          group_place:      result.group_place,
          h2h_points:       result.h2h_points,
        })
      }
    }

    const { error: h2hErr } = await admin
      .from('fixture_group_members')
      .upsert(h2hRows, { onConflict: 'fixture_group_id,profile_id' })

    if (h2hErr) return err('DB_ERROR', h2hErr.message, 500)
  }

  // ── Recompute season standings from scratch ───────────────────
  const [allScoresResult, allPenaltiesResult, allGroupMembersResult] = await Promise.all([
    admin
      .from('manager_match_scores')
      .select('profile_id, adjusted_points, squad_id')
      .eq('season_id', season_id),

    admin
      .from('league_penalties')
      .select('profile_id, points_adjustment')
      .eq('season_id', season_id),

    admin
      .from('fixture_group_members')
      .select('profile_id, h2h_points, group_place')
      .eq('season_id', season_id),
  ])

  if (allScoresResult.error)       return err('DB_ERROR', allScoresResult.error.message, 500)
  if (allPenaltiesResult.error)    return err('DB_ERROR', allPenaltiesResult.error.message, 500)
  if (allGroupMembersResult.error) return err('DB_ERROR', allGroupMembersResult.error.message, 500)

  // Accumulate adjusted points and distinct squad IDs (= rounds played) per profile
  const totalAdjByProfile  = new Map<string, number>()
  const squadsByProfile    = new Map<string, Set<number>>()
  for (const row of allScoresResult.data ?? []) {
    totalAdjByProfile.set(row.profile_id, (totalAdjByProfile.get(row.profile_id) ?? 0) + row.adjusted_points)
    if (!squadsByProfile.has(row.profile_id)) squadsByProfile.set(row.profile_id, new Set())
    squadsByProfile.get(row.profile_id)!.add(row.squad_id)
  }

  const totalPenaltyByProfile = new Map<string, number>()
  for (const row of allPenaltiesResult.data ?? []) {
    totalPenaltyByProfile.set(
      row.profile_id,
      (totalPenaltyByProfile.get(row.profile_id) ?? 0) + Number(row.points_adjustment),
    )
  }

  const h2hByProfile = new Map<string, { h2h_points: number; wins: number; draws: number; losses: number }>()
  for (const row of allGroupMembersResult.data ?? []) {
    if (!h2hByProfile.has(row.profile_id)) {
      h2hByProfile.set(row.profile_id, { h2h_points: 0, wins: 0, draws: 0, losses: 0 })
    }
    const h = h2hByProfile.get(row.profile_id)!
    h.h2h_points += row.h2h_points
    if      (row.group_place === 1) h.wins++
    else if (row.group_place === 2) h.draws++
    else if (row.group_place === 3) h.losses++
  }

  const allProfiles = new Set([
    ...totalAdjByProfile.keys(),
    ...h2hByProfile.keys(),
    ...totalPenaltyByProfile.keys(),
  ])

  const standingsRows = []
  for (const profileId of allProfiles) {
    const adjusted    = totalAdjByProfile.get(profileId)     ?? 0
    const penalty     = totalPenaltyByProfile.get(profileId) ?? 0
    const h2h         = h2hByProfile.get(profileId)          ?? { h2h_points: 0, wins: 0, draws: 0, losses: 0 }
    const roundsPlayed = squadsByProfile.get(profileId)?.size ?? 0

    standingsRows.push({
      season_id,
      profile_id:          profileId,
      rounds_played:       roundsPlayed,
      total_points:        adjusted + penalty,
      h2h_points:          h2h.h2h_points,
      h2h_wins:            h2h.wins,
      h2h_draws:           h2h.draws,
      h2h_losses:          h2h.losses,
      last_updated_round:  round_number,
    })
  }

  const { error: standingsErr } = await admin
    .from('season_standings')
    .upsert(standingsRows, { onConflict: 'season_id,profile_id' })

  if (standingsErr) return err('DB_ERROR', standingsErr.message, 500)

  // ── Audit log ─────────────────────────────────────────────────
  await admin.from('audit_log').insert({
    actor_id:    user.id,
    action:      'score_round',
    entity_type: 'season',
    entity_id:   String(season_id),
    season_id,
    metadata:    { round_number, managers_scored: squads.length },
  })

  // ── Response ──────────────────────────────────────────────────
  const scoresSummary = [...roundScoreByProfile.entries()]
    .map(([profile_id, round_score]) => ({ profile_id, round_score }))
    .sort((a, b) => b.round_score - a.round_score)

  return ok({ round_number, managers_scored: squads.length, scores: scoresSummary })
})
