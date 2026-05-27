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

// Slot eligibility — mirrors the client-side check for defence-in-depth.
// Wales slot: any position, but player must be from Wales (the configured
// weakest nation for 2026). Positional slots are gated by position_group.
function isEligible(positionGroup: string, nation: string, slot: string): boolean {
  switch (slot) {
    case 'Front Row':    return positionGroup === 'Front Row'
    case 'Back Row':     return positionGroup === 'Back Row'
    case 'Outside Back': return positionGroup === 'Outside Back'
    case 'Wales':        return nation === 'Wales'
    case 'Bench Sub':    return true
    default:             return false
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'POST only', 405)

  // ── Parse body ────────────────────────────────────────────────
  let season_id: number, player_id: number, draft_slot: string
  try {
    ;({ season_id, player_id, draft_slot } = await req.json())
  } catch {
    return err('INVALID_REQUEST', 'Invalid JSON body', 400)
  }
  if (!season_id || !player_id || !draft_slot) {
    return err('INVALID_REQUEST', 'season_id, player_id, and draft_slot are required', 400)
  }

  // ── Clients ───────────────────────────────────────────────────
  const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const admin = createClient(supabaseUrl, serviceRoleKey)

  // ── 1. Auth ───────────────────────────────────────────────────
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return err('UNAUTHORIZED', 'Missing auth token', 401)

  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return err('UNAUTHORIZED', 'Invalid session', 401)

  // ── 2. Session ────────────────────────────────────────────────
  const { data: session } = await admin
    .from('draft_sessions')
    .select('id, status, current_pick_number, pick_timer_seconds, pick_deadline')
    .eq('season_id', season_id)
    .single()

  if (!session)                  return err('NO_SESSION',  'No draft session for this season', 404)
  if (session.status !== 'active') return err('NOT_ACTIVE', 'Draft is not active', 409)

  // ── 3. Timer ──────────────────────────────────────────────────
  if (session.pick_deadline && new Date() > new Date(session.pick_deadline)) {
    return err('TIMER_EXPIRED', 'Pick timer has expired', 409)
  }

  // ── 4. Turn + admin check ─────────────────────────────────────
  const { data: draftOrder } = await admin
    .from('draft_order')
    .select('profile_id, pick_position')
    .eq('season_id', season_id)
    .order('pick_position')

  if (!draftOrder?.length) return err('NO_DRAFT_ORDER', 'Draft order not set', 409)

  const managerCount = draftOrder.length
  const posInRound   = ((session.current_pick_number - 1) % managerCount) + 1
  const onClockEntry = draftOrder.find((o: { pick_position: number }) => o.pick_position === posInRound)
  if (!onClockEntry) return err('INTERNAL', 'Cannot determine on-clock manager', 500)

  const onClockProfileId = onClockEntry.profile_id

  const { data: callerProfile } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  const callerIsAdmin = callerProfile?.is_admin === true

  if (user.id !== onClockProfileId && !callerIsAdmin) {
    return err('WRONG_TURN', 'It is not your turn to pick', 403)
  }

  // ── 5. Slot open ──────────────────────────────────────────────
  const { data: slotCheck } = await admin
    .from('draft_picks')
    .select('id')
    .eq('season_id', season_id)
    .eq('profile_id', onClockProfileId)
    .eq('draft_slot', draft_slot)
    .maybeSingle()

  if (slotCheck) return err('SLOT_FILLED', 'This draft slot is already filled for this manager', 409)

  // ── 6. Player exists + eligibility ───────────────────────────
  const { data: player } = await admin
    .from('players')
    .select('id, position_group, nation')
    .eq('id', player_id)
    .eq('season_id', season_id)
    .single()

  if (!player) return err('PLAYER_NOT_FOUND', 'Player not found in this season', 404)

  if (!isEligible(player.position_group, player.nation, draft_slot)) {
    return err('NOT_ELIGIBLE', `This player is not eligible for the ${draft_slot} slot`, 409)
  }

  // ── 7. Player available ───────────────────────────────────────
  const { data: takenCheck } = await admin
    .from('draft_picks')
    .select('id')
    .eq('season_id', season_id)
    .eq('player_id', player_id)
    .maybeSingle()

  if (takenCheck) return err('PLAYER_TAKEN', 'This player has already been drafted', 409)

  // ── 8. Nation cap ─────────────────────────────────────────────
  const { data: managerPicks } = await admin
    .from('draft_picks')
    .select('players!player_id(nation)')
    .eq('season_id', season_id)
    .eq('profile_id', onClockProfileId)

  const nationCount = (managerPicks ?? []).filter(
    (p: { players: { nation: string } | null }) => p.players?.nation === player.nation
  ).length

  if (nationCount >= 4) {
    return err('NATION_CAP', `Maximum 4 players from ${player.nation} already reached`, 409)
  }

  // ── Insert pick ───────────────────────────────────────────────
  const { data: newPick, error: insertErr } = await admin
    .from('draft_picks')
    .insert({
      season_id,
      profile_id: onClockProfileId,
      player_id,
      pick_number: session.current_pick_number,
      draft_slot,
    })
    .select()
    .single()

  if (insertErr) return err('INSERT_FAILED', insertErr.message, 500)

  // ── Advance session ───────────────────────────────────────────
  const { data: rulesRow } = await admin
    .from('season_rules')
    .select('rules')
    .eq('season_id', season_id)
    .maybeSingle()

  const rules = ((rulesRow?.rules ?? {}) as Record<string, unknown>)
  let slotsPerManager = 0
  if (rules.slot_front_row_enabled      !== false) slotsPerManager++
  if (rules.slot_back_row_enabled        !== false) slotsPerManager++
  if (rules.slot_outside_back_enabled    !== false) slotsPerManager++
  if (rules.slot_weakest_nation_enabled  !== false) slotsPerManager++
  if (rules.slot_bench_enabled           === true)  slotsPerManager++
  if (slotsPerManager === 0) slotsPerManager = 4

  const totalPicks = managerCount * slotsPerManager

  // Find next unfilled pick number, scanning forward from the one just completed.
  // Picks can have gaps if the admin skipped turns, so +1 is not always right.
  const { data: allPickNumbers } = await admin
    .from('draft_picks')
    .select('pick_number')
    .eq('season_id', season_id)

  const filled = new Set((allPickNumbers ?? []).map((p: { pick_number: number }) => p.pick_number))

  let nextPick: number | null = null
  for (let i = session.current_pick_number + 1; i <= totalPicks; i++) {
    if (!filled.has(i)) { nextPick = i; break }
  }

  const isComplete = nextPick === null

  await admin
    .from('draft_sessions')
    .update({
      ...(nextPick != null ? { current_pick_number: nextPick } : {}),
      status:        isComplete ? 'complete' : 'active',
      pick_deadline: isComplete
        ? null
        : new Date(Date.now() + session.pick_timer_seconds * 1000).toISOString(),
      ...(isComplete ? { completed_at: new Date().toISOString() } : {}),
    })
    .eq('id', session.id)

  return ok({ pick: newPick })
})
