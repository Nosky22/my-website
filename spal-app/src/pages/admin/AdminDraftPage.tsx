import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

interface Season      { id: number; year: number }
interface OrderItem   { profile_id: string; display_name: string; pick_position: number | '' }
interface DraftSession {
  id: number
  status: 'pending' | 'active' | 'paused' | 'complete'
  current_pick_number: number
  pick_timer_seconds: number
  started_at: string | null
  completed_at: string | null
}
interface SlotConfig {
  front_row: boolean; back_row: boolean; outside_back: boolean
  weakest_nation: boolean; bench: boolean
}

const DEFAULT_SLOTS: SlotConfig = {
  front_row: true, back_row: true, outside_back: true, weakest_nation: true, bench: false,
}

const SESSION_STATUS_COLOUR: Record<string, string> = {
  pending:  'bg-spal-warning/20 text-spal-warning',
  active:   'bg-spal-success/20 text-spal-success',
  paused:   'bg-spal-warning/20 text-spal-warning',
  complete: 'bg-white/10 text-spal-muted',
}

const SLOT_LABELS: [keyof SlotConfig, string][] = [
  ['front_row',      'Front Row (Props, Hookers)'],
  ['back_row',       'Back Row (Flankers, No. 8)'],
  ['outside_back',   'Outside Back (Wings, Fullbacks)'],
  ['weakest_nation', 'Weakest Nation (Wales by default)'],
  ['bench',          'Bench Sub — optional 5th slot (must not be in a GW1 starting XV)'],
]

function slotKey(k: keyof SlotConfig) {
  return `slot_${k}_enabled`
}

function sortByPosition(items: OrderItem[]): OrderItem[] {
  return [...items].sort((a, b) => {
    if (a.pick_position === '' && b.pick_position === '') return 0
    if (a.pick_position === '') return 1
    if (b.pick_position === '') return -1
    return (a.pick_position as number) - (b.pick_position as number)
  })
}

export default function AdminDraftPage() {
  // ── Seasons ───────────────────────────────────────────────────────
  const [seasons, setSeasons]   = useState<Season[]>([])
  const [seasonId, setSeasonId] = useState<number | null>(null)

  // ── Draft order ───────────────────────────────────────────────────
  const [orderItems, setOrderItems]       = useState<OrderItem[]>([])
  const [savingOrder, setSavingOrder]     = useState(false)
  const [orderError, setOrderError]       = useState<string | null>(null)
  const [orderSaved, setOrderSaved]       = useState(false)
  const [standingsSrc, setStandingsSrc]   = useState<number | ''>('')
  const [applyingStgs, setApplyingStgs]   = useState(false)

  // ── Draft session ─────────────────────────────────────────────────
  const [session, setSession]           = useState<DraftSession | null>(null)
  const [timerInput, setTimerInput]     = useState('120')
  const [creatingSession, setCreating]  = useState(false)
  const [savingTimer, setSavingTimer]   = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)

  // ── Draft slots ───────────────────────────────────────────────────
  const [rules, setRules]           = useState<Record<string, unknown>>({})
  const [slots, setSlots]           = useState<SlotConfig>(DEFAULT_SLOTS)
  const [savingSlots, setSavingSlots] = useState(false)
  const [slotsSaved, setSlotsSaved]   = useState(false)

  // ── Load seasons ──────────────────────────────────────────────────
  useEffect(() => {
    supabase.from('seasons').select('id, year').order('year', { ascending: false })
      .then(({ data }) => {
        const list = data ?? []
        setSeasons(list)
        if (list.length) setSeasonId(list[0].id)
        // Default standings source: second most recent season
        if (list.length > 1) setStandingsSrc(list[1].id)
      })
  }, [])

  // ── Load season data ──────────────────────────────────────────────
  useEffect(() => {
    if (seasonId == null) return
    loadSeasonData()
  }, [seasonId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSeasonData() {
    setOrderError(null); setOrderSaved(false)
    setSessionError(null); setSlotsSaved(false)

    const [profilesRes, orderRes, sessionRes, rulesRes] = await Promise.all([
      supabase.from('profiles').select('id, display_name').eq('is_admin', false).order('display_name'),
      supabase.from('draft_order').select('profile_id, pick_position').eq('season_id', seasonId!),
      supabase.from('draft_sessions')
        .select('id, status, current_pick_number, pick_timer_seconds, started_at, completed_at')
        .eq('season_id', seasonId!)
        .maybeSingle(),
      supabase.from('season_rules').select('rules').eq('season_id', seasonId!).maybeSingle(),
    ])

    const profiles = profilesRes.data ?? []
    const positionByProfile = new Map(
      (orderRes.data ?? []).map(o => [o.profile_id, o.pick_position])
    )
    setOrderItems(sortByPosition(profiles.map(p => ({
      profile_id:    p.id,
      display_name:  p.display_name,
      pick_position: positionByProfile.get(p.id) ?? '',
    }))))

    const sess = sessionRes.data as DraftSession | null
    setSession(sess)
    setTimerInput(String(sess?.pick_timer_seconds ?? 120))

    const blob = (rulesRes.data?.rules ?? {}) as Record<string, unknown>
    setRules(blob)
    setSlots({
      front_row:      typeof blob.slot_front_row_enabled      === 'boolean' ? blob.slot_front_row_enabled      : true,
      back_row:       typeof blob.slot_back_row_enabled        === 'boolean' ? blob.slot_back_row_enabled        : true,
      outside_back:   typeof blob.slot_outside_back_enabled    === 'boolean' ? blob.slot_outside_back_enabled    : true,
      weakest_nation: typeof blob.slot_weakest_nation_enabled  === 'boolean' ? blob.slot_weakest_nation_enabled  : true,
      bench:          typeof blob.slot_bench_enabled           === 'boolean' ? blob.slot_bench_enabled           : false,
    })
  }

  // ── Draft order handlers ──────────────────────────────────────────

  function setPosition(profileId: string, raw: string) {
    const val = raw === '' ? '' : parseInt(raw, 10)
    setOrderItems(items => items.map(item =>
      item.profile_id === profileId ? { ...item, pick_position: isNaN(val as number) ? '' : val } : item
    ))
    setOrderSaved(false)
  }

  async function handleSetFromStandings() {
    if (!standingsSrc) return
    setApplyingStgs(true)

    const { data } = await supabase
      .from('season_standings')
      .select('profile_id, h2h_points, total_points')
      .eq('season_id', standingsSrc)
      .order('h2h_points', { ascending: false })
      .order('total_points', { ascending: false })

    const standings = data ?? []
    const n = standings.length
    // Reverse: best standing → last pick (highest number)
    const posByProfile = new Map(standings.map((s, i) => [s.profile_id, n - i]))

    setOrderItems(items => sortByPosition(items.map(item => ({
      ...item,
      pick_position: posByProfile.get(item.profile_id) ?? '',
    }))))
    setApplyingStgs(false)
    setOrderSaved(false)
  }

  async function handleSaveOrder() {
    if (seasonId == null) return

    const filled = orderItems.filter(i => i.pick_position !== '')
    if (filled.length !== orderItems.length) {
      setOrderError('Set a position for every manager before saving.')
      return
    }
    const positions = filled.map(i => i.pick_position as number)
    if (new Set(positions).size !== positions.length) {
      setOrderError('Each manager must have a unique position.')
      return
    }
    const n = orderItems.length
    if (positions.some(p => p < 1 || p > n)) {
      setOrderError(`Positions must be between 1 and ${n}.`)
      return
    }

    setSavingOrder(true); setOrderError(null)
    // DELETE + INSERT avoids (season, position) unique constraint conflicts during swaps
    const { error: delErr } = await supabase.from('draft_order').delete().eq('season_id', seasonId)
    if (delErr) { setOrderError(delErr.message); setSavingOrder(false); return }

    const { error: insErr } = await supabase.from('draft_order').insert(
      orderItems.map(item => ({
        season_id:     seasonId,
        profile_id:    item.profile_id,
        pick_position: item.pick_position as number,
      }))
    )
    if (insErr) setOrderError(insErr.message)
    else { setOrderSaved(true); setOrderItems(sortByPosition(orderItems)) }
    setSavingOrder(false)
  }

  // ── Session handlers ──────────────────────────────────────────────

  function parseTimer(): number | null {
    const t = parseInt(timerInput, 10)
    return isNaN(t) || t < 10 ? null : t
  }

  async function handleCreateSession() {
    const timer = parseTimer()
    if (!timer) { setSessionError('Timer must be at least 10 seconds.'); return }
    if (seasonId == null) return
    setCreating(true); setSessionError(null)

    const { data, error } = await supabase.from('draft_sessions')
      .insert({ season_id: seasonId, status: 'pending', pick_timer_seconds: timer })
      .select('id, status, current_pick_number, pick_timer_seconds, started_at, completed_at')
      .single()

    if (error) setSessionError(error.message)
    else setSession(data as DraftSession)
    setCreating(false)
  }

  async function handleUpdateTimer() {
    if (!session) return
    const timer = parseTimer()
    if (!timer) { setSessionError('Timer must be at least 10 seconds.'); return }
    setSavingTimer(true); setSessionError(null)

    const { error } = await supabase.from('draft_sessions')
      .update({ pick_timer_seconds: timer })
      .eq('id', session.id)

    if (error) setSessionError(error.message)
    else setSession(s => s ? { ...s, pick_timer_seconds: timer } : s)
    setSavingTimer(false)
  }

  // ── Slots handler ─────────────────────────────────────────────────

  async function handleSaveSlots() {
    if (seasonId == null) return
    setSavingSlots(true); setSlotsSaved(false)

    const updatedRules: Record<string, unknown> = { ...rules }
    for (const [key] of SLOT_LABELS) updatedRules[slotKey(key)] = slots[key]

    const { error } = await supabase.from('season_rules')
      .upsert({ season_id: seasonId, rules: updatedRules }, { onConflict: 'season_id' })

    if (!error) { setRules(updatedRules); setSlotsSaved(true) }
    setSavingSlots(false)
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div>
      <h1 className="text-2xl font-bold text-spal-yellow mb-6">Draft Setup</h1>

      {/* Season selector */}
      <div className="flex items-center gap-3 mb-8">
        <label className="text-sm text-spal-muted">Season</label>
        <select
          value={seasonId ?? ''}
          onChange={e => setSeasonId(Number(e.target.value))}
          className={selectClass}
        >
          {seasons.map(s => <option key={s.id} value={s.id}>{s.year}</option>)}
        </select>
      </div>

      <div className="space-y-6 max-w-xl">

        {/* ── Draft Order ──────────────────────────────────────── */}
        <section className="bg-spal-surface rounded p-5">
          <h2 className={sectionHead}>Draft order</h2>

          {/* Set from standings helper */}
          <div className="flex flex-wrap items-center gap-2 mb-5 p-3 bg-spal-bg rounded text-xs">
            <span className="text-spal-muted">Set from standings:</span>
            <select
              value={standingsSrc}
              onChange={e => setStandingsSrc(Number(e.target.value))}
              className="bg-spal-surface border border-white/10 rounded px-2 py-1 text-spal-text text-xs focus:outline-none focus:border-spal-cerulean"
            >
              <option value="">Pick season…</option>
              {seasons.filter(s => s.id !== seasonId).map(s => (
                <option key={s.id} value={s.id}>{s.year}</option>
              ))}
            </select>
            <button
              onClick={handleSetFromStandings}
              disabled={!standingsSrc || applyingStgs}
              className="text-spal-cerulean hover:text-spal-cerulean-light disabled:opacity-40 transition-colors"
            >
              {applyingStgs ? 'Applying…' : 'Apply (reverse order)'}
            </button>
            <span className="text-spal-muted">— 1st place → last pick</span>
          </div>

          {/* Manager list with position inputs */}
          {orderItems.length === 0 ? (
            <p className="text-spal-muted text-sm mb-4">No manager profiles found.</p>
          ) : (
            <div className="space-y-2 mb-4">
              {orderItems.map(item => (
                <div key={item.profile_id} className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={orderItems.length}
                    value={item.pick_position}
                    onChange={e => setPosition(item.profile_id, e.target.value)}
                    placeholder="—"
                    className="w-14 bg-spal-bg border border-white/10 rounded px-2 py-1 text-center text-spal-text text-sm tabular-nums focus:outline-none focus:border-spal-cerulean"
                  />
                  <span className="text-spal-text text-sm">{item.display_name}</span>
                </div>
              ))}
            </div>
          )}

          {orderError  && <p className="text-spal-error   text-xs mb-3">{orderError}</p>}
          {orderSaved  && <p className="text-spal-success text-xs mb-3">Draft order saved.</p>}

          <button
            onClick={handleSaveOrder}
            disabled={savingOrder || orderItems.length === 0}
            className={btnClass}
          >
            {savingOrder ? 'Saving…' : 'Save order'}
          </button>
        </section>

        {/* ── Draft Session ─────────────────────────────────────── */}
        <section className="bg-spal-surface rounded p-5">
          <h2 className={sectionHead}>Draft session</h2>

          {sessionError && <p className="text-spal-error text-xs mb-3">{sessionError}</p>}

          {session ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-sm">
                <span className={`rounded px-2 py-0.5 text-xs ${SESSION_STATUS_COLOUR[session.status] ?? ''}`}>
                  {session.status}
                </span>
                <span className="text-spal-muted text-xs">
                  Current pick: #{session.current_pick_number}
                </span>
              </div>

              {session.started_at && (
                <p className="text-xs text-spal-muted">
                  Started: {new Date(session.started_at).toLocaleString()}
                </p>
              )}
              {session.completed_at && (
                <p className="text-xs text-spal-muted">
                  Completed: {new Date(session.completed_at).toLocaleString()}
                </p>
              )}

              <div className="flex items-center gap-3">
                <label className="text-sm text-spal-muted whitespace-nowrap">Pick timer (s)</label>
                <input
                  type="number" min={10} max={600}
                  value={timerInput}
                  onChange={e => setTimerInput(e.target.value)}
                  className={timerInputClass}
                />
                <button onClick={handleUpdateTimer} disabled={savingTimer} className={btnClass}>
                  {savingTimer ? 'Saving…' : 'Update'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-spal-muted text-sm">No draft session exists for this season.</p>
              <div className="flex items-center gap-3">
                <label className="text-sm text-spal-muted whitespace-nowrap">Pick timer (s)</label>
                <input
                  type="number" min={10} max={600}
                  value={timerInput}
                  onChange={e => setTimerInput(e.target.value)}
                  className={timerInputClass}
                />
              </div>
              <button onClick={handleCreateSession} disabled={creatingSession} className={btnClass}>
                {creatingSession ? 'Creating…' : 'Create draft session'}
              </button>
            </div>
          )}
        </section>

        {/* ── Draft Slots ───────────────────────────────────────── */}
        <section className="bg-spal-surface rounded p-5">
          <h2 className={sectionHead}>Draft slots</h2>
          <p className="text-spal-muted text-xs mb-4">
            Which position slots are active for this season's draft.
          </p>

          <div className="space-y-3 mb-5">
            {SLOT_LABELS.map(([key, label]) => (
              <label key={key} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={slots[key]}
                  onChange={e => { setSlots(s => ({ ...s, [key]: e.target.checked })); setSlotsSaved(false) }}
                  className="mt-0.5 accent-spal-cerulean"
                />
                <span className="text-sm text-spal-text leading-snug">{label}</span>
              </label>
            ))}
          </div>

          {slotsSaved && <p className="text-spal-success text-xs mb-3">Slots saved.</p>}
          <button onClick={handleSaveSlots} disabled={savingSlots} className={btnClass}>
            {savingSlots ? 'Saving…' : 'Save slots'}
          </button>
        </section>

        {/* ── Quick Links ───────────────────────────────────────── */}
        <section className="bg-spal-surface rounded p-5">
          <h2 className={sectionHead}>Quick links</h2>
          <Link
            to="/draft-room"
            className="inline-block bg-spal-cerulean text-white text-sm rounded px-4 py-1.5 hover:bg-spal-cerulean-light transition-colors"
          >
            Go to draft room →
          </Link>
        </section>

      </div>
    </div>
  )
}

const sectionHead  = 'text-xs font-semibold text-spal-muted uppercase tracking-wider mb-4'
const selectClass  = 'bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
const btnClass     = 'bg-spal-cerulean text-white text-sm rounded px-4 py-1.5 hover:bg-spal-cerulean-light disabled:opacity-50 transition-colors'
const timerInputClass = 'w-24 bg-spal-bg border border-white/10 rounded px-3 py-1 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
