import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../components/Toast'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorCard from '../../components/ErrorCard'
import NationBadge from '../../components/NationBadge'
import SquadPlayerPicker from '../../components/SquadPlayerPicker'
import { type PlayerWithPrice, type SquadSlot, SLOT_CONFIG, makeEmptySlots } from '../SquadPage'

interface Season  { id: number; year: number; status: string }
interface Profile { id: string; display_name: string }
interface Match   { id: number; home_nation: string; away_nation: string }

interface PredoEntry {
  matchId: number
  winner: string
  margin: string
  existingId: number | null
}

const ROUNDS = [1, 2, 3, 4, 5] as const

export default function AdminSquadOverridePage() {
  useEffect(() => { document.title = 'Squad Override — Admin — SPAL' }, [])
  const { user } = useAuth()
  const { addToast } = useToast()

  const [seasons, setSeasons]         = useState<Season[]>([])
  const [seasonId, setSeasonId]       = useState<number | null>(null)
  const [round, setRound]             = useState<number | null>(null)
  const [profiles, setProfiles]       = useState<Profile[]>([])
  const [targetProfileId, setTargetProfileId] = useState<string>('')
  const [matches, setMatches]         = useState<Match[]>([])

  // Squad state
  const [slots, setSlots]             = useState<SquadSlot[]>(makeEmptySlots())
  const [allPlayers, setAllPlayers]   = useState<PlayerWithPrice[]>([])
  const [existingSquadId, setExistingSquadId] = useState<number | null>(null)
  const [squadStatus, setSquadStatus] = useState<string>('')
  const [pickerSlotKey, setPickerSlotKey] = useState<string | null>(null)
  const [squadReason, setSquadReason] = useState('')
  const [savingSquad, setSavingSquad] = useState(false)

  // Predo state
  const [predoEntries, setPredoEntries] = useState<PredoEntry[]>([])
  const [predoReason, setPredoReason]   = useState('')
  const [savingPredos, setSavingPredos] = useState(false)

  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  // Load seasons + profiles
  useEffect(() => {
    supabase.from('seasons').select('id, year, status').order('year', { ascending: false })
      .then(({ data }) => {
        const list = (data ?? []) as Season[]
        setSeasons(list)
        const preferred = list.find(s => s.status === 'active') ?? list[0]
        if (preferred) setSeasonId(preferred.id)
      })
    supabase.from('profiles').select('id, display_name').order('display_name')
      .then(({ data }) => setProfiles((data ?? []) as Profile[]))
  }, [])

  // Load round data when season + round + manager are all selected
  useEffect(() => {
    if (seasonId == null || round == null || !targetProfileId) {
      setSlots(makeEmptySlots()); setAllPlayers([]); setMatches([])
      setExistingSquadId(null); setSquadStatus(''); setPredoEntries([])
      return
    }
    setLoading(true); setError(false)

    async function load() {
      const [matchRes, playerRes, priceRes, squadRes, predoRes] = await Promise.all([
        supabase.from('matches').select('id, home_nation, away_nation').eq('season_id', seasonId!).eq('round_number', round!).order('kickoff_at'),
        supabase.from('players').select('id, display_name, nation, canonical_position, position_group').eq('season_id', seasonId!).eq('active', true),
        supabase.from('player_prices').select('player_id, round_number, final_price').eq('season_id', seasonId!),
        supabase.from('manager_round_squads').select('id, status, locked_at').eq('season_id', seasonId!).eq('profile_id', targetProfileId).eq('round_number', round!).maybeSingle(),
        supabase.from('predo_predictions').select('id, match_id, predicted_winner, predicted_margin').eq('season_id', seasonId!).eq('profile_id', targetProfileId),
      ])

      if (matchRes.error || playerRes.error || priceRes.error || squadRes.error || predoRes.error) {
        setError(true); setLoading(false); return
      }

      const mList = (matchRes.data ?? []) as Match[]
      setMatches(mList)

      // Build player pool (all active players, admin can assign any)
      const basePrices  = new Map<number, number>()
      const roundPrices = new Map<number, number>()
      for (const p of priceRes.data ?? []) {
        if (p.round_number === null) basePrices.set(Number(p.player_id), Number(p.final_price))
        else if (p.round_number === round!) roundPrices.set(Number(p.player_id), Number(p.final_price))
      }
      const players: PlayerWithPrice[] = (playerRes.data ?? []).map(p => ({
        id: p.id,
        display_name: p.display_name,
        nation: p.nation,
        canonical_position: p.canonical_position,
        position_group: p.position_group,
        effective_price: roundPrices.get(p.id) ?? basePrices.get(p.id) ?? 0,
      })).sort((a, b) => a.display_name.localeCompare(b.display_name))
      setAllPlayers(players)

      // Load squad
      const squadRow = squadRes.data
      if (squadRow) {
        setExistingSquadId(squadRow.id)
        setSquadStatus(squadRow.status as string)
        const { data: spRows } = await supabase
          .from('manager_round_squad_players')
          .select('player_id, role, is_captain')
          .eq('squad_id', squadRow.id)
        const playerMap = new Map(players.map(p => [p.id, p]))
        const newSlots = makeEmptySlots()
        const starters = (spRows ?? []).filter(r => r.role === 'starter')
        const supersubs = (spRows ?? []).filter(r => r.role === 'supersub')
        for (const sp of starters) {
          const p = playerMap.get(Number(sp.player_id))
          if (!p) continue
          const slot = newSlots.find(s => s.role === 'starter' && !s.player && (s.eligiblePositions.length === 0 || s.eligiblePositions.includes(p.canonical_position)))
          if (slot) { slot.player = p; slot.isCaptain = sp.is_captain }
        }
        for (const sp of supersubs) {
          const p = playerMap.get(Number(sp.player_id))
          const ssSlot = newSlots.find(s => s.role === 'supersub')
          if (p && ssSlot && !ssSlot.player) { ssSlot.player = p; ssSlot.isCaptain = sp.is_captain }
        }
        setSlots(newSlots)
      } else {
        setExistingSquadId(null); setSquadStatus('')
        setSlots(makeEmptySlots())
      }

      // Load predos (index by match_id)
      const matchIds = mList.map(m => m.id)
      const predoData = (predoRes.data ?? []).filter(p => matchIds.includes(p.match_id))
      const entries: PredoEntry[] = mList.map(m => {
        const existing = predoData.find(p => p.match_id === m.id)
        return {
          matchId:    m.id,
          winner:     existing?.predicted_winner ?? m.home_nation,
          margin:     existing ? String(existing.predicted_margin) : '0',
          existingId: existing?.id ?? null,
        }
      })
      setPredoEntries(entries)
      setLoading(false)
    }

    load()
  }, [seasonId, round, targetProfileId, retryKey])

  // Squad helpers
  const alreadySelected = new Set(slots.filter(s => s.player).map(s => s.player!.id))
  const pickerSlot = pickerSlotKey ? SLOT_CONFIG.find(s => s.key === pickerSlotKey) ?? null : null

  function handleSelect(slotKey: string, player: PlayerWithPrice) {
    setSlots(prev => prev.map(s => s.key === slotKey ? { ...s, player } : s))
    setPickerSlotKey(null)
  }

  function handleRemove(slotKey: string) {
    setSlots(prev => prev.map(s => s.key === slotKey ? { ...s, player: null, isCaptain: false } : s))
  }

  function handleToggleCaptain(slotKey: string) {
    setSlots(prev => prev.map(s =>
      s.key === slotKey ? { ...s, isCaptain: !s.isCaptain }
        : s.role === 'starter' ? { ...s, isCaptain: false }
        : s
    ))
  }

  async function handleSaveSquad() {
    if (!user || seasonId == null || round == null || !targetProfileId) return
    if (!squadReason.trim()) { addToast('Reason is required', 'error'); return }
    setSavingSquad(true)

    // Upsert squad header
    const now = new Date().toISOString()
    let squadId = existingSquadId
    if (squadId) {
      const { error: updateErr } = await supabase.from('manager_round_squads')
        .update({ status: 'submitted', submitted_at: now, updated_at: now })
        .eq('id', squadId)
      if (updateErr) { addToast(updateErr.message, 'error'); setSavingSquad(false); return }
    } else {
      const { data: insertData, error: insertErr } = await supabase.from('manager_round_squads')
        .insert({ season_id: seasonId, profile_id: targetProfileId, round_number: round, status: 'submitted', submitted_at: now })
        .select('id').single()
      if (insertErr || !insertData) { addToast(insertErr?.message ?? 'Failed to create squad', 'error'); setSavingSquad(false); return }
      squadId = (insertData as { id: number }).id
    }

    // Replace all squad players
    await supabase.from('manager_round_squad_players').delete().eq('squad_id', squadId)
    const playerRows = slots
      .filter(s => s.player)
      .map(s => ({ squad_id: squadId!, player_id: s.player!.id, role: s.role, is_captain: s.isCaptain }))
    if (playerRows.length > 0) {
      const { error: playersErr } = await supabase.from('manager_round_squad_players').insert(playerRows)
      if (playersErr) { addToast(playersErr.message, 'error'); setSavingSquad(false); return }
    }

    // Audit
    await supabase.from('audit_log').insert({
      actor_id:    user.id,
      action:      'squad.admin_override',
      entity_type: 'manager_round_squads',
      entity_id:   String(squadId),
      season_id:   seasonId,
      metadata:    { target_profile_id: targetProfileId, round_number: round, player_count: playerRows.length, reason: squadReason.trim() },
    })

    addToast('Squad saved', 'success')
    setSavingSquad(false)
    setSquadReason('')
    setRetryKey(k => k + 1)
  }

  async function handleSavePredos() {
    if (!user || seasonId == null || round == null || !targetProfileId) return
    if (!predoReason.trim()) { addToast('Reason is required', 'error'); return }
    setSavingPredos(true)

    for (const entry of predoEntries) {
      const margin = entry.winner === 'Draw' ? 0 : Math.max(0, parseInt(entry.margin, 10) || 0)
      const now = new Date().toISOString()

      if (entry.existingId) {
        // Find old values for audit
        const oldEntry = predoEntries.find(e => e.matchId === entry.matchId)
        const { error: upErr } = await supabase.from('predo_predictions')
          .update({ predicted_winner: entry.winner, predicted_margin: margin, updated_at: now })
          .eq('id', entry.existingId)
        if (upErr) { addToast(upErr.message, 'error'); continue }
        await supabase.from('admin_overrides').insert({
          season_id:   seasonId,
          entity_type: 'predo_prediction',
          entity_id:   String(entry.existingId),
          field_name:  'prediction',
          old_value:   { predicted_winner: oldEntry?.winner, predicted_margin: oldEntry?.margin },
          new_value:   { predicted_winner: entry.winner, predicted_margin: margin },
          reason:      predoReason.trim(),
          created_by:  user.id,
        })
      } else {
        const { error: insErr } = await supabase.from('predo_predictions')
          .insert({ season_id: seasonId, profile_id: targetProfileId, match_id: entry.matchId, predicted_winner: entry.winner, predicted_margin: margin })
        if (insErr) { addToast(insErr.message, 'error'); continue }
        await supabase.from('audit_log').insert({
          actor_id:    user.id,
          action:      'predo.admin_override_insert',
          entity_type: 'predo_prediction',
          entity_id:   `${targetProfileId}_${entry.matchId}`,
          season_id:   seasonId,
          metadata:    { target_profile_id: targetProfileId, match_id: entry.matchId, predicted_winner: entry.winner, predicted_margin: margin, reason: predoReason.trim() },
        })
      }
    }

    addToast('Predos saved', 'success')
    setSavingPredos(false)
    setPredoReason('')
    setRetryKey(k => k + 1)
  }

  const targetProfile = profiles.find(p => p.id === targetProfileId)

  // Group slots visually
  const GROUP_LABELS = [
    { label: 'Front Five',  keys: ['prop1','prop2','hooker','lock1','lock2'] },
    { label: 'Back Row',    keys: ['flanker1','flanker2','number8'] },
    { label: 'Half Backs',  keys: ['scrumhalf','flyhalf'] },
    { label: 'Backs',       keys: ['centre1','centre2','back1','back2','back3'] },
    { label: 'Supersub',    keys: ['supersub'] },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-spal-yellow mb-6">Squad &amp; Predo Override</h1>
      <p className="text-sm text-spal-muted mb-6">
        Edit a manager's squad or predo predictions after the deadline. All changes are audited and require a reason.
      </p>

      {/* Selectors */}
      <div className="flex items-center gap-6 mb-8 flex-wrap">
        <div className="flex items-center gap-3">
          <label className="text-sm text-spal-muted">Season</label>
          <select value={seasonId ?? ''} onChange={e => { setSeasonId(Number(e.target.value)); setRound(null); setTargetProfileId('') }} className={selectClass}>
            {seasons.map(s => <option key={s.id} value={s.id}>{s.year}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-spal-muted">Round</span>
          {ROUNDS.map(r => (
            <button key={r} onClick={() => setRound(r)} className={roundBtnClass(round === r)}>R{r}</button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-spal-muted">Manager</label>
          <select value={targetProfileId} onChange={e => setTargetProfileId(e.target.value)} className={selectClass}>
            <option value="">Select manager…</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </select>
        </div>
      </div>

      {!targetProfileId || round == null ? (
        <p className="text-spal-muted text-sm">Select a round and manager to continue.</p>
      ) : loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorCard onRetry={() => setRetryKey(k => k + 1)} />
      ) : (
        <div className="space-y-8">

          {/* ── Squad section ── */}
          <section className="bg-spal-surface rounded p-5">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="font-semibold text-spal-text">
                Squad — {targetProfile?.display_name} · Round {round}
              </h2>
              {squadStatus && (
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                  squadStatus === 'locked'    ? 'bg-red-500/20 text-red-400' :
                  squadStatus === 'submitted' ? 'bg-spal-success/20 text-spal-success' :
                                               'bg-white/10 text-spal-muted'
                }`}>
                  {squadStatus === 'locked' ? '🔒 Locked (admin override)' : squadStatus}
                </span>
              )}
              {!existingSquadId && (
                <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">
                  No squad yet
                </span>
              )}
            </div>

            <div className="space-y-4 mb-5">
              {GROUP_LABELS.map(group => (
                <div key={group.label}>
                  <p className="text-xs text-spal-muted uppercase tracking-wider mb-2">{group.label}</p>
                  <div className="space-y-0">
                    {slots
                      .filter(s => group.keys.includes(s.key))
                      .map(slot => (
                        <AdminSlotRow
                          key={slot.key}
                          slot={slot}
                          onOpen={() => setPickerSlotKey(slot.key)}
                          onRemove={() => handleRemove(slot.key)}
                          onToggleCaptain={() => handleToggleCaptain(slot.key)}
                        />
                      ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 border-t border-white/10 pt-4 flex-wrap">
              <input
                type="text"
                value={squadReason}
                onChange={e => setSquadReason(e.target.value)}
                placeholder="Reason for override (required)"
                className={`${inputClass} flex-1 min-w-48`}
              />
              <button
                onClick={handleSaveSquad}
                disabled={savingSquad}
                className={`${btnPrimary} shrink-0`}
              >
                {savingSquad ? 'Saving…' : 'Save & submit squad'}
              </button>
            </div>
            <p className="text-xs text-spal-muted mt-2">
              Saves the squad with status "submitted" regardless of deadline. Action is logged to audit_log.
            </p>
          </section>

          {/* ── Predo section ── */}
          {matches.length > 0 && (
            <section className="bg-spal-surface rounded p-5">
              <h2 className="font-semibold text-spal-text mb-4">
                Predictions — {targetProfile?.display_name} · Round {round}
              </h2>

              <div className="space-y-3 mb-5">
                {predoEntries.map((entry, i) => {
                  const match = matches.find(m => m.id === entry.matchId)
                  if (!match) return null
                  return (
                    <div key={entry.matchId} className="flex items-center gap-3 flex-wrap">
                      <span className="text-sm text-spal-text w-48 shrink-0">
                        {match.home_nation} vs {match.away_nation}
                        {entry.existingId && <span className="ml-1 text-xs text-spal-success">✓</span>}
                      </span>
                      <select
                        value={entry.winner}
                        onChange={e => {
                          const w = e.target.value
                          setPredoEntries(prev => prev.map((pe, j) =>
                            j === i ? { ...pe, winner: w, margin: w === 'Draw' ? '0' : pe.margin } : pe
                          ))
                        }}
                        className={selectClass}
                      >
                        <option value={match.home_nation}>{match.home_nation}</option>
                        <option value={match.away_nation}>{match.away_nation}</option>
                        <option value="Draw">Draw</option>
                      </select>
                      {entry.winner !== 'Draw' && (
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-spal-muted">Margin</label>
                          <input
                            type="number"
                            min="0"
                            value={entry.margin}
                            onChange={e => setPredoEntries(prev => prev.map((pe, j) =>
                              j === i ? { ...pe, margin: e.target.value } : pe
                            ))}
                            className={`${inputClass} w-20`}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="flex items-center gap-3 border-t border-white/10 pt-4 flex-wrap">
                <input
                  type="text"
                  value={predoReason}
                  onChange={e => setPredoReason(e.target.value)}
                  placeholder="Reason for override (required)"
                  className={`${inputClass} flex-1 min-w-48`}
                />
                <button
                  onClick={handleSavePredos}
                  disabled={savingPredos}
                  className={`${btnPrimary} shrink-0`}
                >
                  {savingPredos ? 'Saving…' : 'Save predos'}
                </button>
              </div>
              <p className="text-xs text-spal-muted mt-2">
                Bypasses the deadline. Edits write to admin_overrides; new entries write to audit_log.
              </p>
            </section>
          )}
        </div>
      )}

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

function AdminSlotRow({ slot, onOpen, onRemove, onToggleCaptain }: {
  slot: SquadSlot
  onOpen: () => void
  onRemove: () => void
  onToggleCaptain: () => void
}) {
  const posLabel = slot.eligiblePositions.length > 0 ? slot.eligiblePositions.join(' / ') : 'Any'
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0">
      <span className="w-28 shrink-0 text-xs text-spal-muted">{slot.label}</span>
      {slot.player ? (
        <>
          <NationBadge nation={slot.player.nation} />
          <span className="flex-1 text-sm text-spal-text truncate">{slot.player.display_name}</span>
          <span className="text-xs text-spal-muted tabular-nums shrink-0">{slot.player.effective_price}★</span>
          {slot.role === 'starter' && (
            <button
              onClick={onToggleCaptain}
              title={slot.isCaptain ? 'Remove captain' : 'Make captain'}
              className={`w-6 h-6 rounded text-xs font-bold shrink-0 transition-colors ${
                slot.isCaptain ? 'bg-spal-yellow text-spal-bg' : 'bg-white/10 text-spal-muted hover:bg-white/20'
              }`}
            >
              C
            </button>
          )}
          <button onClick={onRemove} className="w-6 h-6 flex items-center justify-center text-spal-muted hover:text-red-400 text-sm shrink-0" title="Remove">
            ×
          </button>
        </>
      ) : (
        <button onClick={onOpen} className="flex-1 text-left text-xs text-spal-muted hover:text-spal-cerulean transition-colors">
          + {posLabel}
        </button>
      )}
    </div>
  )
}

function roundBtnClass(active: boolean) {
  return `px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
    active
      ? 'border-spal-cerulean bg-spal-cerulean/10 text-spal-cerulean'
      : 'border-white/10 text-spal-muted hover:border-white/30 hover:text-spal-text'
  }`
}

const selectClass = 'bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
const inputClass  = 'bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean w-full'
const btnPrimary  = 'bg-spal-cerulean text-white text-sm rounded px-4 py-1.5 hover:bg-spal-cerulean-light disabled:opacity-50 transition-colors'
