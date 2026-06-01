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

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// Rank managers by total points descending. Returns profile_id → rank (1-based).
function rankByTotals(totals: Map<string, number>): Map<string, number> {
  const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1])
  const ranks = new Map<string, number>()
  sorted.forEach(([id], i) => ranks.set(id, i + 1))
  return ranks
}

// ── Types ─────────────────────────────────────────────────────────────────────

type PlayerMeta = {
  display_name: string
  nation: string
  canonical_position: string
  position_group: string
}

type PmsRow = {
  player_id: number
  match_id: number
  final_points: number
  players: PlayerMeta | null
}

type MmsRoundRow = {
  profile_id: string
  match_id: number
  final_points: number
  supersub_raw_points: number
  supersub_multiplier_applied: number
}

type MmsAllRow = {
  profile_id: string
  final_points: number
  matches: { round_number: number } | null
}

type SquadRow = { id: number; profile_id: string }
type SquadPlayerRow = { squad_id: number; player_id: number; role: string; is_captain: boolean }
type DraftPickRow = { profile_id: string; player_id: number }
type PriceRow = { player_id: number; final_price: number; round_number: number | null }
type ProfileRow = { id: string; display_name: string }
type MatchRow = { id: number; round_number: number; home_nation: string; away_nation: string }
type MatchdayRow = { player_id: number; match_id: number; status: string }

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'POST only', 405)

  let season_id: number, round_number: number
  try {
    ;({ season_id, round_number } = await req.json())
  } catch {
    return err('INVALID_REQUEST', 'Invalid JSON body', 400)
  }
  if (!season_id || !round_number) {
    return err('INVALID_REQUEST', 'season_id and round_number are required', 400)
  }

  const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceRoleKey)

  // ── Auth: admin only ──────────────────────────────────────────────
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return err('UNAUTHORIZED', 'Missing auth token', 401)
  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return err('UNAUTHORIZED', 'Invalid session', 401)
  const { data: callerProfile } = await admin.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!callerProfile?.is_admin) return err('FORBIDDEN', 'Admin only', 403)

  // ── Load all matches for this season ─────────────────────────────
  const { data: allMatchData, error: matchErr } = await admin
    .from('matches')
    .select('id, round_number, home_nation, away_nation')
    .eq('season_id', season_id)
  if (matchErr) return err('DB_ERROR', matchErr.message, 500)

  const allMatches = (allMatchData ?? []) as MatchRow[]
  const allMatchIds  = allMatches.map(m => m.id)
  const roundMatches = allMatches.filter(m => m.round_number === round_number)
  if (!roundMatches.length) return err('NO_MATCHES', `No matches for round ${round_number}`, 404)
  const roundMatchIds = roundMatches.map(m => m.id)

  // ── Parallel data load ────────────────────────────────────────────
  const [pmsRes, matchdayRes, squadsRes, mmsRoundRes, mmsAllRes, draftRes, pricesRes, profilesRes] =
    await Promise.all([
      // All player scores for the whole season (needed for season-to-date stats)
      admin.from('player_match_scores')
        .select('player_id, match_id, final_points, players!player_id(display_name, nation, canonical_position, position_group)')
        .in('match_id', allMatchIds),

      // Matchday squads for this round (supersub bench/start status)
      admin.from('matchday_squads')
        .select('player_id, match_id, status')
        .in('match_id', roundMatchIds),

      // Locked manager squads for this round
      admin.from('manager_round_squads')
        .select('id, profile_id')
        .eq('season_id', season_id)
        .eq('round_number', round_number)
        .eq('status', 'locked'),

      // Manager match scores for this round (with supersub columns)
      admin.from('manager_match_scores')
        .select('profile_id, match_id, final_points, supersub_raw_points, supersub_multiplier_applied')
        .in('match_id', roundMatchIds),

      // Manager match scores for whole season (for season-to-date rankings)
      admin.from('manager_match_scores')
        .select('profile_id, final_points, matches!match_id(round_number)')
        .in('match_id', allMatchIds),

      // Draft picks for this season
      admin.from('draft_picks')
        .select('profile_id, player_id')
        .eq('season_id', season_id),

      // Player prices for this season (null round = season default)
      admin.from('player_prices')
        .select('player_id, final_price, round_number')
        .eq('season_id', season_id),

      // All profiles
      admin.from('profiles').select('id, display_name'),
    ])

  if (squadsRes.error) return err('DB_ERROR', squadsRes.error.message, 500)

  // ── Load squad players once we have squad IDs ─────────────────────
  const squads = (squadsRes.data ?? []) as SquadRow[]
  const squadIds = squads.map(s => s.id)
  let squadPlayers: SquadPlayerRow[] = []
  if (squadIds.length > 0) {
    const { data: spData, error: spErr } = await admin
      .from('manager_round_squad_players')
      .select('squad_id, player_id, role, is_captain')
      .in('squad_id', squadIds)
    if (spErr) return err('DB_ERROR', spErr.message, 500)
    squadPlayers = (spData ?? []) as SquadPlayerRow[]
  }

  // ── Build lookup maps ─────────────────────────────────────────────

  const profileBySquadId = new Map<number, string>()
  for (const s of squads) profileBySquadId.set(s.id, s.profile_id)

  const allPms = (pmsRes.data ?? []) as unknown as PmsRow[]

  // Player metadata by player_id
  const playerMeta = new Map<number, PlayerMeta>()
  for (const row of allPms) {
    if (row.players && !playerMeta.has(row.player_id)) playerMeta.set(row.player_id, row.players)
  }

  // Player round totals (just this round)
  const playerRoundTotals = new Map<number, number>()
  for (const row of allPms) {
    if (roundMatchIds.includes(row.match_id)) {
      playerRoundTotals.set(row.player_id, (playerRoundTotals.get(row.player_id) ?? 0) + row.final_points)
    }
  }

  // Player season totals (all rounds)
  const playerSeasonTotals = new Map<number, number>()
  for (const row of allPms) {
    playerSeasonTotals.set(row.player_id, (playerSeasonTotals.get(row.player_id) ?? 0) + row.final_points)
  }

  // Matchday status per player for this round (best status across all matches)
  const matchdayRows = (matchdayRes.data ?? []) as MatchdayRow[]
  const playerRoundStatus = new Map<number, string>()
  for (const row of matchdayRows) {
    const cur = playerRoundStatus.get(row.player_id)
    if (!cur || (row.status === 'starting' && cur !== 'starting') ||
        (row.status === 'bench' && cur === 'not_selected')) {
      playerRoundStatus.set(row.player_id, row.status)
    }
  }

  // Manager squads: profile_id → Set<player_id>
  const managerSquad = new Map<string, Set<number>>()
  // Supersub player per manager
  const managerSupersub = new Map<string, number>()
  for (const sp of squadPlayers) {
    const pid = profileBySquadId.get(sp.squad_id)
    if (!pid) continue
    if (!managerSquad.has(pid)) managerSquad.set(pid, new Set())
    managerSquad.get(pid)!.add(sp.player_id)
    if (sp.role === 'supersub') managerSupersub.set(pid, sp.player_id)
  }

  // All squad player IDs (for "one that got away")
  const allSquadPlayerIds = new Set<number>()
  for (const [, s] of managerSquad) for (const pid of s) allSquadPlayerIds.add(pid)

  // Draft picks
  const draftPicks = (draftRes.data ?? []) as DraftPickRow[]
  const draftedByPlayer = new Map<number, string>()   // player_id → owner profile_id
  const draftedByManager = new Map<string, Set<number>>() // profile_id → Set<player_id>
  for (const dp of draftPicks) {
    draftedByPlayer.set(dp.player_id, dp.profile_id)
    if (!draftedByManager.has(dp.profile_id)) draftedByManager.set(dp.profile_id, new Set())
    draftedByManager.get(dp.profile_id)!.add(dp.player_id)
  }

  // Player prices: prefer round-specific, fall back to season default
  const playerPrices = new Map<number, number>()
  const priceRows = (pricesRes.data ?? []) as PriceRow[]
  for (const row of priceRows) {
    if (row.round_number === null) playerPrices.set(row.player_id, row.final_price)
  }
  for (const row of priceRows) {
    if (row.round_number === round_number) playerPrices.set(row.player_id, row.final_price)
  }

  // Profile names
  const profileName = new Map<string, string>()
  for (const p of (profilesRes.data ?? []) as ProfileRow[]) {
    profileName.set(p.id, p.display_name)
  }

  // Manager round totals (this round only)
  const mmsRound = (mmsRoundRes.data ?? []) as MmsRoundRow[]
  const managerRoundTotal = new Map<string, number>()
  for (const row of mmsRound) {
    managerRoundTotal.set(row.profile_id, (managerRoundTotal.get(row.profile_id) ?? 0) + row.final_points)
  }

  // Per-manager per-round totals for all rounds (for season-to-date and most-improved)
  const mmsAll = (mmsAllRes.data ?? []) as unknown as MmsAllRow[]
  const managerAllRounds = new Map<string, Map<number, number>>()
  for (const row of mmsAll) {
    if (!row.matches) continue
    const rn = row.matches.round_number
    if (!managerAllRounds.has(row.profile_id)) managerAllRounds.set(row.profile_id, new Map())
    const m = managerAllRounds.get(row.profile_id)!
    m.set(rn, (m.get(rn) ?? 0) + row.final_points)
  }

  // ── Section 1: Round performance ──────────────────────────────────

  const roundEntries = Array.from(managerRoundTotal.entries()).sort((a, b) => b[1] - a[1])

  const highMgr = roundEntries[0]
  const lowMgr  = roundEntries[roundEntries.length - 1]

  // Closest margin between any pair of managers
  let closestGap = Infinity
  let closestA = '', closestB = ''
  for (let i = 0; i < roundEntries.length; i++) {
    for (let j = i + 1; j < roundEntries.length; j++) {
      const gap = Math.abs(roundEntries[i][1] - roundEntries[j][1])
      if (gap < closestGap) {
        closestGap = gap; closestA = roundEntries[i][0]; closestB = roundEntries[j][0]
      }
    }
  }

  // Most improved: rank at end of round N vs end of round N-1
  let mostImproved: null | { profile_id: string; name: string; prev_rank: number; new_rank: number; positions_gained: number } = null
  if (round_number > 1) {
    const cumThis = new Map<string, number>()
    const cumPrev = new Map<string, number>()
    for (const [pid, rounds] of managerAllRounds) {
      let t = 0, p = 0
      for (const [rn, pts] of rounds) {
        if (rn <= round_number) t += pts
        if (rn <  round_number) p += pts
      }
      cumThis.set(pid, t); cumPrev.set(pid, p)
    }
    const rankThis = rankByTotals(cumThis)
    const rankPrev = rankByTotals(cumPrev)
    let bestGain = 0
    for (const [pid, thisRank] of rankThis) {
      const prevRank = rankPrev.get(pid) ?? thisRank
      const gain = prevRank - thisRank
      if (gain > bestGain) {
        bestGain = gain
        mostImproved = {
          profile_id: pid,
          name: profileName.get(pid) ?? 'Unknown',
          prev_rank: prevRank,
          new_rank: thisRank,
          positions_gained: gain,
        }
      }
    }
  }

  const roundSection = {
    highest_scoring_manager: highMgr ? {
      profile_id: highMgr[0], name: profileName.get(highMgr[0]) ?? 'Unknown', score: round1(highMgr[1]),
    } : null,
    lowest_scoring_manager: lowMgr && lowMgr[0] !== highMgr?.[0] ? {
      profile_id: lowMgr[0], name: profileName.get(lowMgr[0]) ?? 'Unknown', score: round1(lowMgr[1]),
    } : null,
    closest_margin: closestA ? {
      manager_a: { profile_id: closestA, name: profileName.get(closestA) ?? 'Unknown', score: round1(managerRoundTotal.get(closestA) ?? 0) },
      manager_b: { profile_id: closestB, name: profileName.get(closestB) ?? 'Unknown', score: round1(managerRoundTotal.get(closestB) ?? 0) },
      gap: round1(closestGap),
    } : null,
    most_improved: mostImproved,
  }

  // ── Section 2: Player insights ────────────────────────────────────

  // Highest scorer overall this round
  let highestScorer: null | { player_id: number; name: string; nation: string; position: string; points: number } = null
  {
    let best = 0, bestId = -1
    for (const [pid, pts] of playerRoundTotals) {
      if (pts > best) { best = pts; bestId = pid }
    }
    if (bestId >= 0) {
      const m = playerMeta.get(bestId)
      if (m) highestScorer = { player_id: bestId, name: m.display_name, nation: m.nation, position: m.canonical_position, points: round1(best) }
    }
  }

  // Highest scorer per canonical position
  const highestPerPosition: Record<string, { player_id: number; name: string; nation: string; points: number }> = {}
  for (const [pid, pts] of playerRoundTotals) {
    const m = playerMeta.get(pid)
    if (!m) continue
    const cur = highestPerPosition[m.canonical_position]
    if (!cur || pts > cur.points) {
      highestPerPosition[m.canonical_position] = { player_id: pid, name: m.display_name, nation: m.nation, points: round1(pts) }
    }
  }

  // Best supersub (highest supersub_raw_points × supersub_multiplier_applied)
  let bestSupersub: null | { player_id: number; name: string; nation: string; manager_name: string; raw_points: number; multiplied_points: number; multiplier: number } = null
  {
    let bestMultiplied = 0
    for (const [pid, supPid] of managerSupersub) {
      const mmsRows = mmsRound.filter(r => r.profile_id === pid)
      const multiplied = mmsRows.reduce((s, r) => s + Number(r.supersub_raw_points) * Number(r.supersub_multiplier_applied), 0)
      if (multiplied > bestMultiplied) {
        bestMultiplied = multiplied
        const rawPts = mmsRows.reduce((s, r) => s + Number(r.supersub_raw_points), 0)
        const maxMult = mmsRows.reduce((s, r) => Math.max(s, Number(r.supersub_multiplier_applied)), 0)
        const m = playerMeta.get(supPid)
        bestSupersub = {
          player_id: supPid,
          name: m?.display_name ?? 'Unknown',
          nation: m?.nation ?? '',
          manager_name: profileName.get(pid) ?? 'Unknown',
          raw_points: round1(rawPts),
          multiplied_points: round1(multiplied),
          multiplier: maxMult,
        }
      }
    }
  }

  // Most selected player across all squads
  const selectCount = new Map<number, number>()
  for (const [, s] of managerSquad) for (const pid of s) selectCount.set(pid, (selectCount.get(pid) ?? 0) + 1)
  let mostSelected: null | { player_id: number; name: string; nation: string; position: string; squad_count: number; total_managers: number } = null
  {
    let best = 0, bestId = -1
    for (const [pid, cnt] of selectCount) { if (cnt > best) { best = cnt; bestId = pid } }
    if (bestId >= 0) {
      const m = playerMeta.get(bestId)
      if (m) mostSelected = { player_id: bestId, name: m.display_name, nation: m.nation, position: m.canonical_position, squad_count: best, total_managers: squads.length }
    }
  }

  // One that got away: highest scorer NOT in any SPAL squad
  let oneGotAway: null | { player_id: number; name: string; nation: string; position: string; points: number } = null
  {
    let best = 0, bestId = -1
    for (const [pid, pts] of playerRoundTotals) {
      if (!allSquadPlayerIds.has(pid) && pts > best) { best = pts; bestId = pid }
    }
    if (bestId >= 0 && best > 0) {
      const m = playerMeta.get(bestId)
      if (m) oneGotAway = { player_id: bestId, name: m.display_name, nation: m.nation, position: m.canonical_position, points: round1(best) }
    }
  }

  // Points % by nation and position group (all players who scored this round)
  let totalRoundPts = 0
  const ptsByNation = new Map<string, number>()
  const ptsByPosGroup = new Map<string, number>()
  for (const [pid, pts] of playerRoundTotals) {
    if (pts <= 0) continue
    const m = playerMeta.get(pid)
    if (!m) continue
    totalRoundPts += pts
    ptsByNation.set(m.nation, (ptsByNation.get(m.nation) ?? 0) + pts)
    ptsByPosGroup.set(m.position_group, (ptsByPosGroup.get(m.position_group) ?? 0) + pts)
  }
  const pctByNation: Record<string, number> = {}
  const pctByPosition: Record<string, number> = {}
  if (totalRoundPts > 0) {
    for (const [k, v] of ptsByNation) pctByNation[k] = round1(v / totalRoundPts * 100)
    for (const [k, v] of ptsByPosGroup) pctByPosition[k] = round1(v / totalRoundPts * 100)
  }

  const playersSection = {
    highest_scorer:       highestScorer,
    highest_per_position: highestPerPosition,
    best_supersub:        bestSupersub,
    most_selected:        mostSelected,
    one_that_got_away:    oneGotAway,
    points_pct_by_nation: pctByNation,
    points_pct_by_position: pctByPosition,
  }

  // ── Section 3: Draft insights ─────────────────────────────────────

  // Best drafted player in any squad this round
  let bestDraftedPlayer: null | { player_id: number; name: string; drafted_by_name: string; points: number } = null
  {
    let best = 0, bestId = -1
    for (const [pid, pts] of playerRoundTotals) {
      const owner = draftedByPlayer.get(pid)
      if (!owner) continue
      if (!managerSquad.get(owner)?.has(pid)) continue // must be fielded by their owner
      if (pts > best) { best = pts; bestId = pid }
    }
    if (bestId >= 0) {
      const m = playerMeta.get(bestId)
      const owner = draftedByPlayer.get(bestId)!
      bestDraftedPlayer = { player_id: bestId, name: m?.display_name ?? 'Unknown', drafted_by_name: profileName.get(owner) ?? 'Unknown', points: round1(best) }
    }
  }

  // Manager whose drafted players scored most this round
  let bestDraftManager: null | { profile_id: string; name: string; total_drafted_points: number } = null
  {
    let best = 0, bestId = ''
    for (const [pid, s] of managerSquad) {
      const myDraft = draftedByManager.get(pid) ?? new Set()
      const draftPts = Array.from(s).filter(p => myDraft.has(p)).reduce((sum, p) => sum + (playerRoundTotals.get(p) ?? 0), 0)
      if (draftPts > best) { best = draftPts; bestId = pid }
    }
    if (bestId) bestDraftManager = { profile_id: bestId, name: profileName.get(bestId) ?? 'Unknown', total_drafted_points: round1(best) }
  }

  // Best value: highest points-per-star across all players who scored this round
  let bestValue: null | { player_id: number; name: string; points: number; price_stars: number; points_per_star: number } = null
  {
    let best = 0, bestId = -1, bestPts = 0, bestPrice = 0
    for (const [pid, pts] of playerRoundTotals) {
      const price = playerPrices.get(pid)
      if (!price || price <= 0) continue
      const ratio = pts / price
      if (ratio > best) { best = ratio; bestId = pid; bestPts = pts; bestPrice = price }
    }
    if (bestId >= 0) {
      const m = playerMeta.get(bestId)
      bestValue = { player_id: bestId, name: m?.display_name ?? 'Unknown', points: round1(bestPts), price_stars: bestPrice, points_per_star: round1(best) }
    }
  }

  // Zero scorers: drafted players in a squad this round who scored 0
  const zeroScorers: Array<{ player_id: number; name: string; drafted_by_name: string; played: boolean }> = []
  for (const [pid, s] of managerSquad) {
    const myDraft = draftedByManager.get(pid) ?? new Set()
    for (const playerId of s) {
      if (!myDraft.has(playerId)) continue
      if ((playerRoundTotals.get(playerId) ?? 0) === 0) {
        const m = playerMeta.get(playerId)
        const status = playerRoundStatus.get(playerId)
        zeroScorers.push({
          player_id: playerId,
          name: m?.display_name ?? 'Unknown',
          drafted_by_name: profileName.get(pid) ?? 'Unknown',
          played: status === 'starting' || status === 'bench',
        })
      }
    }
  }

  const draftSection = {
    best_drafted_player: bestDraftedPlayer,
    best_draft_manager:  bestDraftManager,
    best_value:          bestValue,
    zero_scorers:        zeroScorers,
  }

  // ── Section 4: Season to date ─────────────────────────────────────

  // Cumulative totals through this round
  const cumTotals = new Map<string, number>()
  for (const [pid, rounds] of managerAllRounds) {
    let t = 0
    for (const [rn, pts] of rounds) { if (rn <= round_number) t += pts }
    if (t > 0) cumTotals.set(pid, t)
  }
  const cumRanked = Array.from(cumTotals.entries()).sort((a, b) => b[1] - a[1])

  const leader = cumRanked[0]
    ? {
        profile_id: cumRanked[0][0],
        name: profileName.get(cumRanked[0][0]) ?? 'Unknown',
        total_points: round1(cumRanked[0][1]),
        lead_over_second: round1(cumRanked[0][1] - (cumRanked[1]?.[1] ?? cumRanked[0][1])),
      }
    : null

  // Most consistent: lowest variance in round scores up to this round
  let mostConsistent: null | { profile_id: string; name: string; score_variance: number; round_scores: number[] } = null
  {
    let lowestVar = Infinity
    for (const [pid, rounds] of managerAllRounds) {
      const scores = Array.from(rounds.entries())
        .filter(([rn]) => rn <= round_number)
        .sort((a, b) => a[0] - b[0])
        .map(([, pts]) => pts)
      if (scores.length < 2) continue
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length
      const variance = scores.reduce((sum, v) => sum + (v - mean) ** 2, 0) / scores.length
      if (variance < lowestVar) {
        lowestVar = variance
        mostConsistent = {
          profile_id: pid,
          name: profileName.get(pid) ?? 'Unknown',
          score_variance: round1(variance),
          round_scores: scores.map(round1),
        }
      }
    }
  }

  // Best draft season: manager whose drafted players scored most across all rounds
  let bestDraftSeason: null | { profile_id: string; name: string; total_drafted_points: number } = null
  {
    let best = 0, bestId = ''
    for (const [pid, drafted] of draftedByManager) {
      const total = Array.from(drafted).reduce((sum, p) => sum + (playerSeasonTotals.get(p) ?? 0), 0)
      if (total > best) { best = total; bestId = pid }
    }
    if (bestId) bestDraftSeason = { profile_id: bestId, name: profileName.get(bestId) ?? 'Unknown', total_drafted_points: round1(best) }
  }

  // Top season player: highest total points across all rounds
  let topSeasonPlayer: null | { player_id: number; name: string; nation: string; position: string; total_points: number } = null
  {
    let best = 0, bestId = -1
    for (const [pid, pts] of playerSeasonTotals) {
      if (pts > best) { best = pts; bestId = pid }
    }
    if (bestId >= 0) {
      const m = playerMeta.get(bestId)
      if (m) topSeasonPlayer = { player_id: bestId, name: m.display_name, nation: m.nation, position: m.canonical_position, total_points: round1(best) }
    }
  }

  const seasonSection = {
    leader,
    most_consistent:  mostConsistent,
    best_draft:       bestDraftSeason,
    top_season_player: topSeasonPlayer,
  }

  // ── Upsert and return ─────────────────────────────────────────────

  const payload = { round: roundSection, players: playersSection, draft: draftSection, season_to_date: seasonSection }

  const { error: upsertErr } = await admin
    .from('round_insights')
    .upsert(
      { season_id, round_number, payload, generated_at: new Date().toISOString() },
      { onConflict: 'season_id,round_number' },
    )

  if (upsertErr) return err('DB_ERROR', upsertErr.message, 500)

  return ok({ season_id, round_number, generated: true })
})
