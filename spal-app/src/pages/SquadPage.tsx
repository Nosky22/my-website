import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/Toast'
import { supabase } from '../lib/supabase'
import NationBadge from '../components/NationBadge'
import SquadPlayerPicker from '../components/SquadPlayerPicker'
import { ConfirmModal } from '../components/ConfirmModal'
import { EmptyState } from '../components/EmptyState'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlayerWithPrice {
  id: number
  display_name: string
  nation: string
  canonical_position: string
  position_group: string
  effective_price: number
}

interface SquadSlot {
  key: string
  label: string
  eligiblePositions: string[]   // empty = any (supersub)
  role: 'starter' | 'supersub'
  player: PlayerWithPrice | null
  isCaptain: boolean
}

interface SeasonRules {
  budget_limit: number
  max_players_per_nation: number
  italian_starter_rule_enabled: boolean
  italian_starter_required: number
}

interface Season { id: number; year: number; status: string }

// ── Slot configuration ────────────────────────────────────────────────────────

const SLOT_CONFIG: Omit<SquadSlot, 'player' | 'isCaptain'>[] = [
  { key: 'prop1',     label: 'Prop',       eligiblePositions: ['Prop'],                 role: 'starter'  },
  { key: 'prop2',     label: 'Prop',       eligiblePositions: ['Prop'],                 role: 'starter'  },
  { key: 'hooker',    label: 'Hooker',     eligiblePositions: ['Hooker'],               role: 'starter'  },
  { key: 'lock1',     label: 'Second Row', eligiblePositions: ['Second Row'],           role: 'starter'  },
  { key: 'lock2',     label: 'Second Row', eligiblePositions: ['Second Row'],           role: 'starter'  },
  { key: 'flanker1',  label: 'Back Row',   eligiblePositions: ['Flanker', 'Number 8'],  role: 'starter'  },
  { key: 'flanker2',  label: 'Back Row',   eligiblePositions: ['Flanker', 'Number 8'],  role: 'starter'  },
  { key: 'number8',   label: 'Back Row',   eligiblePositions: ['Flanker', 'Number 8'],  role: 'starter'  },
  { key: 'scrumhalf', label: 'Scrum-half', eligiblePositions: ['Scrum-half'],           role: 'starter'  },
  { key: 'flyhalf',   label: 'Fly-half',   eligiblePositions: ['Fly-half'],             role: 'starter'  },
  { key: 'centre1',   label: 'Centre',     eligiblePositions: ['Centre'],               role: 'starter'  },
  { key: 'centre2',   label: 'Centre',     eligiblePositions: ['Centre'],               role: 'starter'  },
  { key: 'back1',     label: 'Outside Back', eligiblePositions: ['Wing', 'Fullback'],   role: 'starter'  },
  { key: 'back2',     label: 'Outside Back', eligiblePositions: ['Wing', 'Fullback'],   role: 'starter'  },
  { key: 'back3',     label: 'Outside Back', eligiblePositions: ['Wing', 'Fullback'],   role: 'starter'  },
  { key: 'supersub',  label: 'Supersub',   eligiblePositions: [],                       role: 'supersub' },
]

const GROUP_LABELS: { label: string; keys: string[] }[] = [
  { label: 'Front Five',  keys: ['prop1','prop2','hooker','lock1','lock2'] },
  { label: 'Back Row',    keys: ['flanker1','flanker2','number8'] },
  { label: 'Half Backs',  keys: ['scrumhalf','flyhalf'] },
  { label: 'Backs',       keys: ['centre1','centre2','back1','back2','back3'] },
  { label: 'Supersub',    keys: ['supersub'] },
]

function makeEmptySlots(): SquadSlot[] {
  return SLOT_CONFIG.map(cfg => ({ ...cfg, player: null, isCaptain: false }))
}

// ── Slot card ─────────────────────────────────────────────────────────────────

interface SlotCardProps {
  slot: SquadSlot
  locked: boolean
  onOpen: () => void
  onRemove: () => void
  onToggleCaptain: () => void
}

function SlotCard({ slot, locked, onOpen, onRemove, onToggleCaptain }: SlotCardProps) {
  const posLabel = slot.eligiblePositions.length > 0
    ? slot.eligiblePositions.join(' / ')
    : 'Any'

  return (
    <div className="flex items-center gap-2 py-2 border-b border-white/5 last:border-0">
      {/* Position label */}
      <span className="w-28 shrink-0 text-xs text-spal-muted">{slot.label}</span>

      {slot.player ? (
        <>
          <NationBadge nation={slot.player.nation} />
          <span className="flex-1 text-sm text-spal-text truncate">{slot.player.display_name}</span>
          <span className="text-xs text-spal-muted tabular-nums shrink-0">{slot.player.effective_price}★</span>

          {slot.role === 'starter' && (
            <button
              onClick={onToggleCaptain}
              disabled={locked}
              title={slot.isCaptain ? 'Remove captain' : 'Make captain'}
              className={`w-6 h-6 rounded text-xs font-bold shrink-0 transition-colors ${
                slot.isCaptain
                  ? 'bg-spal-yellow text-spal-bg'
                  : 'bg-white/10 text-spal-muted hover:bg-white/20'
              } disabled:opacity-40 disabled:cursor-default`}
            >
              C
            </button>
          )}

          {!locked && (
            <button
              onClick={onRemove}
              className="w-6 h-6 flex items-center justify-center text-spal-muted hover:text-red-400 text-sm shrink-0"
              title="Remove"
            >
              ×
            </button>
          )}
        </>
      ) : (
        <button
          onClick={onOpen}
          disabled={locked}
          className="flex-1 text-left text-xs text-spal-muted hover:text-spal-cerulean disabled:cursor-default disabled:opacity-40 transition-colors"
        >
          + {posLabel}
        </button>
      )}
    </div>
  )
}

// ── Validation ────────────────────────────────────────────────────────────────

function validate(slots: SquadSlot[], rules: SeasonRules): string[] {
  const errors: string[] = []
  const filled = slots.filter(s => s.player !== null)

  if (filled.length < 16) {
    errors.push(`All 16 slots must be filled (${filled.length}/16 filled)`)
  }

  const captains = slots.filter(s => s.isCaptain)
  if (captains.length === 0) errors.push('You must select a captain')
  if (captains.length > 1)   errors.push('Only one captain is allowed')

  // Nation cap
  const nationCounts: Record<string, number> = {}
  for (const s of filled) {
    if (!s.player) continue
    nationCounts[s.player.nation] = (nationCounts[s.player.nation] ?? 0) + 1
  }
  for (const [nation, count] of Object.entries(nationCounts)) {
    if (count > rules.max_players_per_nation) {
      errors.push(`Too many ${nation} players (${count}/${rules.max_players_per_nation} max)`)
    }
  }

  // Italian starter rule — supersub does NOT count
  if (rules.italian_starter_rule_enabled) {
    const starters = slots.filter(s => s.role === 'starter')
    const italianStarterCount = starters.filter(s => s.player?.nation === 'Italy').length
    if (italianStarterCount < rules.italian_starter_required) {
      errors.push(
        `At least ${rules.italian_starter_required} Italian player must be a starter (supersub does not count)`
      )
    }
  }

  return errors
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SquadPage() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [searchParams] = useSearchParams()

  // Read URL params once at mount — used to pre-select season/round when
  // navigating from the dashboard. Refs so they survive re-renders but are
  // consumed only on the first load cycle.
  const initSeasonParam = useRef<number | null>(parseInt(searchParams.get('season') ?? '') || null)
  const initRoundParam  = useRef<number | null>(parseInt(searchParams.get('round')  ?? '') || null)

  const [seasons, setSeasons]                   = useState<Season[]>([])
  const [selectedSeasonId, setSelectedSeasonId] = useState<number | null>(null)
  const [selectedRound, setSelectedRound]       = useState<number>(1)
  const [rounds, setRounds]                     = useState<number[]>([])
  const [rules, setRules]                       = useState<SeasonRules | null>(null)
  const [allPlayers, setAllPlayers]             = useState<PlayerWithPrice[]>([])
  const [slots, setSlots]                       = useState<SquadSlot[]>(makeEmptySlots())
  const [squadStatus, setSquadStatus]           = useState<string>('draft')
  const [locked, setLocked]                     = useState(false)
  const [loading, setLoading]                   = useState(true)
  const [saving, setSaving]                     = useState(false)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [pickerSlotKey, setPickerSlotKey]       = useState<string | null>(null)
  const [hasPrevRound, setHasPrevRound]         = useState(false)
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)

  // Load seasons on mount
  useEffect(() => {
    supabase.from('seasons').select('id, year, status').order('year', { ascending: false })
      .then(({ data }) => {
        if (!data) return
        setSeasons(data)
        const paramId = initSeasonParam.current
        const preferred = (paramId ? data.find(s => s.id === paramId) : null)
          ?? data.find(s => s.status === 'active')
          ?? data[0]
        if (preferred) setSelectedSeasonId(preferred.id)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load data when season changes
  useEffect(() => {
    if (!selectedSeasonId || !user) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setValidationErrors([])

      // Rounds from matches
      const { data: matchRows } = await supabase
        .from('matches')
        .select('round_number')
        .eq('season_id', selectedSeasonId!)
        .order('round_number')

      const roundNums = [...new Set((matchRows ?? []).map(m => m.round_number as number))].sort((a, b) => a - b)
      if (cancelled) return

      const activeRounds = roundNums.length > 0 ? roundNums : [1, 2, 3, 4, 5]
      setRounds(activeRounds)

      // Consume the URL round param on first load only; null it so manual
      // season changes afterwards always default to the first round.
      const paramRound = initRoundParam.current
      initRoundParam.current = null
      const round = (paramRound && activeRounds.includes(paramRound)) ? paramRound : activeRounds[0]
      setSelectedRound(round)

      await loadRoundData(selectedSeasonId!, round, cancelled)
    }

    load().finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeasonId, user])

  const loadRoundData = useCallback(async (
    seasonId: number, round: number, cancelled: boolean
  ) => {
    if (!user) return

    const [
      { data: rulesRow },
      { data: playerRows },
      { data: priceRows },
      { data: pickRows },
      { data: squadRow },
      { data: prevSquadRow },
    ] = await Promise.all([
      supabase.from('season_rules').select('rules').eq('season_id', seasonId).single(),
      supabase.from('players').select('id, display_name, nation, canonical_position, position_group').eq('season_id', seasonId).eq('active', true),
      supabase.from('player_prices').select('player_id, round_number, final_price').eq('season_id', seasonId),
      supabase.from('draft_picks').select('player_id, profile_id').eq('season_id', seasonId),
      supabase.from('manager_round_squads').select('id, status, locked_at').eq('season_id', seasonId).eq('profile_id', user.id).eq('round_number', round).maybeSingle(),
      round > 1
        ? supabase.from('manager_round_squads').select('id').eq('season_id', seasonId).eq('profile_id', user.id).eq('round_number', round - 1).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    if (cancelled) return

    // Parse rules
    const r = rulesRow?.rules as Record<string, unknown> | undefined
    const parsedRules: SeasonRules = {
      budget_limit:                  Number(r?.budget_limit ?? 200),
      max_players_per_nation:        Number(r?.max_players_per_nation ?? 4),
      italian_starter_rule_enabled:  Boolean(r?.italian_starter_rule_enabled ?? true),
      italian_starter_required:      Number(r?.italian_starter_required ?? 1),
    }
    setRules(parsedRules)

    // Build price lookup: prefer round-specific price, fall back to base (null round)
    const basePrices   = new Map<number, number>()
    const roundPrices  = new Map<number, number>()
    for (const p of priceRows ?? []) {
      if (p.round_number === null) basePrices.set(Number(p.player_id), Number(p.final_price))
      else if (p.round_number === round) roundPrices.set(Number(p.player_id), Number(p.final_price))
    }

    // My drafted players + undrafted = available to pick
    const otherManagerPickIds = new Set(
      (pickRows ?? [])
        .filter(p => p.profile_id !== user.id)
        .map(p => Number(p.player_id))
    )

    const players: PlayerWithPrice[] = (playerRows ?? [])
      .filter(p => !otherManagerPickIds.has(p.id))
      .map(p => ({
        id: p.id,
        display_name: p.display_name,
        nation: p.nation,
        canonical_position: p.canonical_position,
        position_group: p.position_group,
        effective_price: roundPrices.get(p.id) ?? basePrices.get(p.id) ?? 0,
      }))
      .sort((a, b) => a.display_name.localeCompare(b.display_name))

    setAllPlayers(players)
    setHasPrevRound(prevSquadRow != null)

    // Load existing squad if any
    if (squadRow) {
      setSquadStatus(squadRow.status)
      const isLocked = Boolean(squadRow.locked_at)
      setLocked(isLocked)

      const { data: squadPlayers } = await supabase
        .from('manager_round_squad_players')
        .select('player_id, role, is_captain')
        .eq('squad_id', squadRow.id)

      if (!cancelled && squadPlayers) {
        const playerMap = new Map(players.map(p => [p.id, p]))
        const newSlots = makeEmptySlots()
        const startingSlots  = newSlots.filter(s => s.role === 'starter')
        const supersubSlots  = newSlots.filter(s => s.role === 'supersub')
        const starterPlayers = squadPlayers.filter(sp => sp.role === 'starter')
        const supersubPlayers = squadPlayers.filter(sp => sp.role === 'supersub')

        // Assign starters to slots by position compatibility
        for (const sp of starterPlayers) {
          const p = playerMap.get(Number(sp.player_id))
          if (!p) continue
          const slot = startingSlots.find(
            s => !s.player && (s.eligiblePositions.length === 0 || s.eligiblePositions.includes(p.canonical_position))
          )
          if (slot) { slot.player = p; slot.isCaptain = sp.is_captain }
        }
        for (const sp of supersubPlayers) {
          const p = playerMap.get(Number(sp.player_id))
          if (p && supersubSlots[0] && !supersubSlots[0].player) {
            supersubSlots[0].player = p
            supersubSlots[0].isCaptain = sp.is_captain
          }
        }
        setSlots(newSlots)
      }
    } else {
      setSquadStatus('draft')
      setLocked(false)
      setSlots(makeEmptySlots())
    }
  }, [user])

  // When round selector changes
  const handleRoundChange = useCallback(async (round: number) => {
    if (!selectedSeasonId) return
    setSelectedRound(round)
    setLoading(true)
    setValidationErrors([])
    await loadRoundData(selectedSeasonId, round, false)
    setLoading(false)
  }, [selectedSeasonId, loadRoundData])

  // Derived state
  const alreadySelected = useMemo(
    () => new Set(slots.map(s => s.player?.id).filter(Boolean) as number[]),
    [slots]
  )

  const totalCost = useMemo(
    () => slots.reduce((sum, s) => sum + (s.player?.effective_price ?? 0), 0),
    [slots]
  )

  const budgetRemaining = rules ? rules.budget_limit - totalCost : null

  // ── Slot actions ─────────────────────────────────────────────────────────

  function handleSelect(slotKey: string, player: PlayerWithPrice) {
    setSlots(prev => prev.map(s => s.key === slotKey ? { ...s, player } : s))
    setPickerSlotKey(null)
    setValidationErrors([])
  }

  function handleRemove(slotKey: string) {
    setSlots(prev => prev.map(s => {
      if (s.key !== slotKey) return s
      return { ...s, player: null, isCaptain: false }
    }))
    setValidationErrors([])
  }

  function handleToggleCaptain(slotKey: string) {
    setSlots(prev => prev.map(s => ({
      ...s,
      isCaptain: s.key === slotKey ? !s.isCaptain : false,
    })))
    setValidationErrors([])
  }

  // ── Copy from previous round ──────────────────────────────────────────────

  async function handleCopyPrevRound() {
    if (!selectedSeasonId || !user || selectedRound <= 1) return
    const { data: prevSquad } = await supabase
      .from('manager_round_squads')
      .select('id')
      .eq('season_id', selectedSeasonId)
      .eq('profile_id', user.id)
      .eq('round_number', selectedRound - 1)
      .maybeSingle()

    if (!prevSquad) return

    const { data: prevPlayers } = await supabase
      .from('manager_round_squad_players')
      .select('player_id, role, is_captain')
      .eq('squad_id', prevSquad.id)

    if (!prevPlayers) return

    const playerMap = new Map(allPlayers.map(p => [p.id, p]))
    const newSlots = makeEmptySlots()
    const startingSlots = newSlots.filter(s => s.role === 'starter')
    const supersubSlots = newSlots.filter(s => s.role === 'supersub')

    for (const sp of prevPlayers.filter(sp => sp.role === 'starter')) {
      const p = playerMap.get(Number(sp.player_id))
      if (!p) continue
      const slot = startingSlots.find(
        s => !s.player && (s.eligiblePositions.length === 0 || s.eligiblePositions.includes(p.canonical_position))
      )
      if (slot) { slot.player = p; slot.isCaptain = sp.is_captain }
    }
    for (const sp of prevPlayers.filter(sp => sp.role === 'supersub')) {
      const p = playerMap.get(Number(sp.player_id))
      if (p && supersubSlots[0] && !supersubSlots[0].player) {
        supersubSlots[0].player = p
        supersubSlots[0].isCaptain = sp.is_captain
      }
    }

    setSlots(newSlots)
    setValidationErrors([])
  }

  // ── Save / Submit ─────────────────────────────────────────────────────────

  async function saveSquad(submit: boolean) {
    if (!selectedSeasonId || !user || !rules) return

    const errors = submit ? validate(slots, rules) : []
    if (errors.length > 0) {
      setValidationErrors(errors)
      return
    }
    setValidationErrors([])
    setSaving(true)

    try {
      // Upsert the squad header
      const newStatus = submit ? 'submitted' : 'draft'
      const { data: squad, error: squadErr } = await supabase
        .from('manager_round_squads')
        .upsert(
          {
            season_id: selectedSeasonId,
            profile_id: user.id,
            round_number: selectedRound,
            status: newStatus,
            ...(submit ? { submitted_at: new Date().toISOString() } : {}),
          },
          { onConflict: 'season_id,profile_id,round_number' }
        )
        .select('id')
        .single()

      if (squadErr || !squad) throw new Error(squadErr?.message ?? 'Failed to save squad')

      // Replace squad players
      await supabase.from('manager_round_squad_players').delete().eq('squad_id', squad.id)

      const insertRows = slots
        .filter(s => s.player !== null)
        .map(s => ({
          squad_id: squad.id,
          player_id: s.player!.id,
          role: s.role,
          is_captain: s.isCaptain,
        }))

      if (insertRows.length > 0) {
        const { error: insertErr } = await supabase
          .from('manager_round_squad_players')
          .insert(insertRows)
        if (insertErr) throw new Error(insertErr.message)
      }

      setSquadStatus(newStatus)
      addToast(submit ? 'Squad submitted' : 'Draft saved', 'success')
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Unknown error', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Picker slot ───────────────────────────────────────────────────────────

  const pickerSlot = pickerSlotKey ? slots.find(s => s.key === pickerSlotKey) ?? null : null

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 rounded-full border-2 border-spal-cerulean border-t-transparent animate-spin" />
      </div>
    )
  }

  const filledCount = slots.filter(s => s.player !== null).length

  if (allPlayers.length === 0 && filledCount === 0) {
    return (
      <div className="max-w-spal mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-spal-yellow mb-6">Squad Builder</h1>
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
          title="No squad yet"
          body="Build your squad for this round"
        />
      </div>
    )
  }

  return (
    <div className="max-w-spal mx-auto px-4 py-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-spal-yellow">Squad Builder</h1>
        <div className="flex items-center gap-3">
          {/* Season selector */}
          <select
            value={selectedSeasonId ?? ''}
            onChange={e => setSelectedSeasonId(Number(e.target.value))}
            className="bg-spal-bg border border-white/10 rounded px-2 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean"
          >
            {seasons.map(s => (
              <option key={s.id} value={s.id}>{s.year}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Round selector */}
      {rounds.length > 0 && (
        <div className="flex gap-2 mb-6 flex-wrap">
          {rounds.map(r => (
            <button
              key={r}
              onClick={() => handleRoundChange(r)}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                selectedRound === r
                  ? 'bg-spal-cerulean text-white'
                  : 'bg-spal-bg border border-white/10 text-spal-muted hover:text-spal-text'
              }`}
            >
              Round {r}
            </button>
          ))}
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center justify-between mb-4 text-sm">
        <div className="flex items-center gap-4">
          <span className="text-spal-muted">{filledCount}/16 players</span>
          {rules && (
            <span className={budgetRemaining !== null && budgetRemaining < 0 ? 'text-red-400' : 'text-spal-muted'}>
              Budget: {totalCost}/{rules.budget_limit}★
              {budgetRemaining !== null && budgetRemaining >= 0 && (
                <span className="text-spal-muted ml-1">({budgetRemaining}★ left)</span>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {locked && (
            <span className="text-xs text-amber-400 border border-amber-400/30 rounded px-2 py-0.5">Locked</span>
          )}
          {!locked && squadStatus === 'submitted' && (
            <span className="text-xs text-spal-cerulean border border-spal-cerulean/30 rounded px-2 py-0.5">Submitted</span>
          )}
          {!locked && squadStatus === 'draft' && filledCount > 0 && (
            <span className="text-xs text-spal-muted border border-white/10 rounded px-2 py-0.5">Draft</span>
          )}
        </div>
      </div>

      {/* Copy from previous round */}
      {hasPrevRound && !locked && (
        <div className="mb-4">
          <button
            onClick={handleCopyPrevRound}
            className="text-xs text-spal-cerulean hover:underline"
          >
            Copy from Round {selectedRound - 1}
          </button>
        </div>
      )}

      {/* Slot groups */}
      <div className="bg-spal-surface border border-white/10 rounded-lg divide-y divide-white/5 mb-6">
        {GROUP_LABELS.map(group => {
          const groupSlots = slots.filter(s => group.keys.includes(s.key))
          return (
            <div key={group.label} className="px-4 py-2">
              <p className="text-xs text-spal-yellow font-semibold mb-1 mt-1">{group.label}</p>
              {groupSlots.map(slot => (
                <SlotCard
                  key={slot.key}
                  slot={slot}
                  locked={locked}
                  onOpen={() => setPickerSlotKey(slot.key)}
                  onRemove={() => handleRemove(slot.key)}
                  onToggleCaptain={() => handleToggleCaptain(slot.key)}
                />
              ))}
            </div>
          )
        })}
      </div>

      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <div className="mb-4 bg-red-900/20 border border-red-500/30 rounded-lg px-4 py-3">
          <ul className="space-y-1">
            {validationErrors.map(e => (
              <li key={e} className="text-sm text-red-400">{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      {!locked && (
        <div className="flex gap-3">
          <button
            onClick={() => saveSquad(false)}
            disabled={saving || filledCount === 0}
            className="flex-1 py-2.5 rounded bg-spal-bg border border-white/10 text-spal-text text-sm hover:bg-white/5 disabled:opacity-40 disabled:cursor-default transition-colors"
          >
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
          <button
            onClick={() => {
              if (!rules) return
              const errors = validate(slots, rules)
              if (errors.length > 0) { setValidationErrors(errors); return }
              setShowSubmitConfirm(true)
            }}
            disabled={saving}
            className="flex-1 py-2.5 rounded bg-spal-cerulean text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-default transition-opacity"
          >
            {saving ? 'Submitting…' : 'Submit Squad'}
          </button>
        </div>
      )}

      {/* Submit confirmation modal */}
      <ConfirmModal
        open={showSubmitConfirm}
        title={`Submit squad for Round ${selectedRound}?`}
        confirmLabel="Submit"
        onConfirm={() => { setShowSubmitConfirm(false); saveSquad(true) }}
        onCancel={() => setShowSubmitConfirm(false)}
      >
        <div className="text-sm space-y-2 mb-5">
          <div className="flex justify-between">
            <span className="text-spal-muted">Players</span>
            <span className="text-spal-text tabular-nums">{filledCount}/16</span>
          </div>
          <div className="flex justify-between">
            <span className="text-spal-muted">Budget used</span>
            <span className="text-spal-text tabular-nums">{totalCost}/{rules?.budget_limit ?? '—'}★</span>
          </div>
          <div className="flex justify-between">
            <span className="text-spal-muted">Captain</span>
            <span className="text-spal-text">{slots.find(s => s.isCaptain)?.player?.display_name ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-spal-muted">Supersub</span>
            <span className="text-spal-text">{slots.find(s => s.role === 'supersub')?.player?.display_name ?? '—'}</span>
          </div>
          <p className="text-xs text-spal-muted pt-2 border-t border-white/10">
            You can edit your squad until the round deadline. After that it will be locked.
          </p>
        </div>
      </ConfirmModal>

      {/* Player picker modal */}
      {pickerSlot && (
        <SquadPlayerPicker
          slotLabel={pickerSlot.label}
          eligiblePositions={pickerSlot.eligiblePositions}
          availablePlayers={allPlayers}
          alreadySelected={alreadySelected}
          onSelect={player => handleSelect(pickerSlot.key, player)}
          onClose={() => setPickerSlotKey(null)}
        />
      )}

    </div>
  )
}
