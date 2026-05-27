import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/Toast'

interface Season { id: number; year: number }
interface Player {
  id: number
  display_name: string
  nation: string
  canonical_position: string
  position_group: string
  active: boolean
}
interface PriceRow {
  id: number
  source_price: number
  final_price: number
}

const NATIONS = ['England', 'Ireland', 'Scotland', 'Wales', 'France', 'Italy'] as const

const CANONICAL_POSITIONS = [
  'Prop', 'Hooker', 'Second Row', 'Flanker', 'Number 8',
  'Scrum-half', 'Fly-half', 'Centre', 'Wing', 'Fullback',
] as const

const POSITION_GROUP: Record<string, string> = {
  'Prop':       'Front Row',
  'Hooker':     'Front Row',
  'Second Row': 'Other',
  'Flanker':    'Back Row',
  'Number 8':   'Back Row',
  'Scrum-half': 'Other',
  'Fly-half':   'Other',
  'Centre':     'Other',
  'Wing':       'Outside Back',
  'Fullback':   'Outside Back',
}

const ROUNDS = [1, 2, 3, 4, 5] as const
const EMPTY_FORM = { display_name: '', nation: 'England' as string, canonical_position: 'Prop' as string }

export default function AdminPlayersPage() {
  const { addToast } = useToast()
  const [seasons, setSeasons]               = useState<Season[]>([])
  const [selectedSeasonId, setSelectedSeasonId] = useState<number | null>(null)
  const [players, setPlayers]               = useState<Player[]>([])
  const [loadingPlayers, setLoadingPlayers] = useState(false)
  const [form, setForm]                     = useState(EMPTY_FORM)
  const [submitting, setSubmitting]         = useState(false)
  const [formError, setFormError]           = useState<string | null>(null)

  // Price state
  const [selectedRound, setSelectedRound]   = useState<number | null>(null)
  const [basePrices, setBasePrices]         = useState<Map<number, PriceRow>>(new Map())
  const [roundPrices, setRoundPrices]       = useState<Map<number, PriceRow>>(new Map())
  const [editingPlayerId, setEditingPlayerId] = useState<number | null>(null)
  const [editValue, setEditValue]           = useState('')

  useEffect(() => {
    supabase
      .from('seasons')
      .select('id, year')
      .order('year', { ascending: false })
      .then(({ data }) => {
        const list = data ?? []
        setSeasons(list)
        if (list.length > 0) setSelectedSeasonId(list[0].id)
      })
  }, [])

  // Players
  useEffect(() => {
    if (selectedSeasonId == null) return
    setLoadingPlayers(true)
    supabase
      .from('players')
      .select('id, display_name, nation, canonical_position, position_group, active')
      .eq('season_id', selectedSeasonId)
      .order('display_name')
      .then(({ data, error }) => {
        if (error) console.error(error)
        setPlayers(data ?? [])
        setLoadingPlayers(false)
      })
  }, [selectedSeasonId])

  // Base prices (round_number IS NULL) — reload when season changes
  useEffect(() => {
    if (selectedSeasonId == null) return
    supabase
      .from('player_prices')
      .select('id, player_id, source_price, final_price')
      .eq('season_id', selectedSeasonId)
      .is('round_number', null)
      .then(({ data }) => {
        const m = new Map<number, PriceRow>()
        for (const r of data ?? []) m.set(r.player_id, { id: r.id, source_price: r.source_price, final_price: r.final_price })
        setBasePrices(m)
      })
  }, [selectedSeasonId])

  // Round prices — reload when season or selected round changes
  useEffect(() => {
    setRoundPrices(new Map())
    if (selectedSeasonId == null || selectedRound == null) return
    supabase
      .from('player_prices')
      .select('id, player_id, source_price, final_price')
      .eq('season_id', selectedSeasonId)
      .eq('round_number', selectedRound)
      .then(({ data }) => {
        const m = new Map<number, PriceRow>()
        for (const r of data ?? []) m.set(r.player_id, { id: r.id, source_price: r.source_price, final_price: r.final_price })
        setRoundPrices(m)
      })
  }, [selectedSeasonId, selectedRound])

  // Effective price for display: round price if exists, else base
  function effectivePrice(playerId: number): number | null {
    const rp = selectedRound != null ? roundPrices.get(playerId) : null
    return (rp ?? basePrices.get(playerId))?.final_price ?? null
  }

  function startEdit(playerId: number) {
    const price = effectivePrice(playerId)
    setEditingPlayerId(playerId)
    setEditValue(price != null ? String(price) : '')
  }

  async function commitEdit(playerId: number) {
    setEditingPlayerId(null)
    const val = parseFloat(editValue)
    if (isNaN(val) || val < 0) { addToast('Invalid price', 'error'); return }
    if (selectedSeasonId == null) return

    const { error } = await supabase
      .from('player_prices')
      .upsert(
        { player_id: playerId, season_id: selectedSeasonId, round_number: selectedRound, source_price: val },
        { onConflict: 'player_id,season_id,round_number' }
      )

    if (error) { addToast(error.message, 'error'); return }

    // Refresh whichever price map was affected
    if (selectedRound == null) {
      const { data } = await supabase
        .from('player_prices')
        .select('id, player_id, source_price, final_price')
        .eq('season_id', selectedSeasonId)
        .is('round_number', null)
      const m = new Map<number, PriceRow>()
      for (const r of data ?? []) m.set(r.player_id, { id: r.id, source_price: r.source_price, final_price: r.final_price })
      setBasePrices(m)
    } else {
      const { data } = await supabase
        .from('player_prices')
        .select('id, player_id, source_price, final_price')
        .eq('season_id', selectedSeasonId)
        .eq('round_number', selectedRound)
      const m = new Map<number, PriceRow>()
      for (const r of data ?? []) m.set(r.player_id, { id: r.id, source_price: r.source_price, final_price: r.final_price })
      setRoundPrices(m)
    }
    addToast('Price saved', 'success')
  }

  function handleKeyDown(e: React.KeyboardEvent, playerId: number) {
    if (e.key === 'Enter') commitEdit(playerId)
    if (e.key === 'Escape') setEditingPlayerId(null)
  }

  async function handleAddPlayer(e: React.FormEvent) {
    e.preventDefault()
    if (selectedSeasonId == null) return
    setSubmitting(true)
    setFormError(null)

    const position_group = POSITION_GROUP[form.canonical_position] ?? 'Other'
    const search_name = form.display_name.toLowerCase().replace(/[^a-z0-9 ]/g, '')

    const { data: newPlayer, error } = await supabase.from('players').insert({
      season_id: selectedSeasonId,
      display_name: form.display_name.trim(),
      search_name,
      nation: form.nation,
      canonical_position: form.canonical_position,
      position_group,
    }).select('id').single()

    if (error) { setFormError(error.message); setSubmitting(false); return }

    // Seed a base price row for the new player
    await supabase.from('player_prices').upsert(
      { player_id: newPlayer.id, season_id: selectedSeasonId, round_number: null, source_price: 10 },
      { onConflict: 'player_id,season_id,round_number' }
    )

    setForm(EMPTY_FORM)
    const { data } = await supabase
      .from('players')
      .select('id, display_name, nation, canonical_position, position_group, active')
      .eq('season_id', selectedSeasonId)
      .order('display_name')
    setPlayers(data ?? [])

    // Refresh base prices
    const { data: priceData } = await supabase
      .from('player_prices')
      .select('id, player_id, source_price, final_price')
      .eq('season_id', selectedSeasonId)
      .is('round_number', null)
    const m = new Map<number, PriceRow>()
    for (const r of priceData ?? []) m.set(r.player_id, { id: r.id, source_price: r.source_price, final_price: r.final_price })
    setBasePrices(m)

    addToast(`${form.display_name.trim()} added`, 'success')
    setSubmitting(false)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-spal-yellow mb-6">Players</h1>

      {/* Season selector */}
      <div className="mb-6 flex items-center gap-3">
        <label htmlFor="season-select" className="text-sm text-spal-muted">Season</label>
        <select
          id="season-select"
          value={selectedSeasonId ?? ''}
          onChange={e => setSelectedSeasonId(Number(e.target.value))}
          className={inputClass}
        >
          {seasons.map(s => <option key={s.id} value={s.id}>{s.year}</option>)}
        </select>
      </div>

      <div className="flex gap-8 items-start">
        {/* Add player form */}
        <section className="bg-spal-surface rounded p-5 w-64 shrink-0">
          <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-4">Add player</h2>
          <form onSubmit={handleAddPlayer} className="space-y-3">
            <Field label="Name" htmlFor="player-name">
              <input
                id="player-name"
                type="text"
                value={form.display_name}
                onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                required
                placeholder="e.g. Sergio Parisse"
                className={inputClass}
              />
            </Field>
            <Field label="Nation" htmlFor="player-nation">
              <select
                id="player-nation"
                value={form.nation}
                onChange={e => setForm(f => ({ ...f, nation: e.target.value }))}
                className={inputClass}
              >
                {NATIONS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Position" htmlFor="player-position">
              <select
                id="player-position"
                value={form.canonical_position}
                onChange={e => setForm(f => ({ ...f, canonical_position: e.target.value }))}
                className={inputClass}
              >
                {CANONICAL_POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <p className="text-xs text-spal-muted">
              Draft slot group:{' '}
              <span className="text-spal-text">{POSITION_GROUP[form.canonical_position] ?? 'Other'}</span>
            </p>
            {formError && <p className="text-spal-error text-sm">{formError}</p>}
            <button
              type="submit"
              disabled={submitting || selectedSeasonId == null}
              className={submitClass}
            >
              {submitting ? 'Adding…' : 'Add player'}
            </button>
          </form>
        </section>

        {/* Players table */}
        <div className="flex-1 min-w-0">

          {/* Round selector */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-spal-muted">Prices for</span>
            <button
              onClick={() => setSelectedRound(null)}
              className={roundBtn(selectedRound === null)}
            >
              Base
            </button>
            {ROUNDS.map(r => (
              <button
                key={r}
                onClick={() => setSelectedRound(r)}
                className={roundBtn(selectedRound === r)}
              >
                R{r}
              </button>
            ))}
            {selectedRound != null && (
              <span className="text-xs text-spal-muted ml-1">
                (showing round price if set, else base)
              </span>
            )}
          </div>

          {loadingPlayers ? (
            <p className="text-spal-muted text-sm">Loading…</p>
          ) : players.length === 0 ? (
            <p className="text-spal-muted text-sm">No players for this season.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-spal-muted border-b border-white/10">
                  <th className="pb-2 pr-6 font-normal">Name</th>
                  <th className="pb-2 pr-6 font-normal">Nation</th>
                  <th className="pb-2 pr-6 font-normal">Position</th>
                  <th className="pb-2 pr-6 font-normal">Slot group</th>
                  <th className="pb-2 font-normal">Price</th>
                </tr>
              </thead>
              <tbody>
                {players.map(p => {
                  const price = effectivePrice(p.id)
                  const isEditing = editingPlayerId === p.id
                  const hasRoundOverride = selectedRound != null && roundPrices.has(p.id)

                  return (
                    <tr
                      key={p.id}
                      className={`border-b border-white/5 ${!p.active ? 'opacity-40' : ''}`}
                    >
                      <td className="py-2 pr-6 text-spal-text">{p.display_name}</td>
                      <td className="py-2 pr-6 text-spal-muted">{p.nation}</td>
                      <td className="py-2 pr-6 text-spal-muted">{p.canonical_position}</td>
                      <td className="py-2 pr-6 text-spal-muted">{p.position_group}</td>
                      <td className="py-2">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(p.id)}
                            onKeyDown={e => handleKeyDown(e, p.id)}
                            autoFocus
                            className="w-20 bg-spal-bg border border-spal-cerulean rounded px-2 py-0.5 text-spal-text text-sm focus:outline-none"
                          />
                        ) : (
                          <button
                            onClick={() => startEdit(p.id)}
                            className={`tabular-nums hover:text-spal-cerulean transition-colors ${
                              hasRoundOverride ? 'text-spal-cerulean' : 'text-spal-text'
                            }`}
                            title="Click to edit"
                          >
                            {price != null ? price : '—'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function roundBtn(active: boolean) {
  return `px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
    active
      ? 'border-spal-cerulean bg-spal-cerulean/10 text-spal-cerulean'
      : 'border-white/10 text-spal-muted hover:border-white/30 hover:text-spal-text'
  }`
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm text-spal-muted mb-1">{label}</label>
      {children}
    </div>
  )
}

const inputClass =
  'w-full bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'

const submitClass =
  'bg-spal-cerulean text-white text-sm rounded px-4 py-1.5 hover:bg-spal-cerulean-light disabled:opacity-50 transition-colors'
