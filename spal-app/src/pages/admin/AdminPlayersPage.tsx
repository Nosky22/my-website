import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface Season { id: number; year: number }
interface Player {
  id: number
  display_name: string
  nation: string
  canonical_position: string
  position_group: string
  active: boolean
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

const EMPTY_FORM = {
  display_name: '',
  nation: 'England' as string,
  canonical_position: 'Prop' as string,
}

export default function AdminPlayersPage() {
  const [seasons, setSeasons] = useState<Season[]>([])
  const [selectedSeasonId, setSelectedSeasonId] = useState<number | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [loadingPlayers, setLoadingPlayers] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  async function handleAddPlayer(e: React.FormEvent) {
    e.preventDefault()
    if (selectedSeasonId == null) return
    setSubmitting(true)
    setError(null)

    const position_group = POSITION_GROUP[form.canonical_position] ?? 'Other'
    // Lowercase and strip non-alphanumeric (except spaces) for deduplication matching
    const search_name = form.display_name.toLowerCase().replace(/[^a-z0-9 ]/g, '')

    const { error } = await supabase.from('players').insert({
      season_id: selectedSeasonId,
      display_name: form.display_name.trim(),
      search_name,
      nation: form.nation,
      canonical_position: form.canonical_position,
      position_group,
    })

    if (error) {
      setError(error.message)
      setSubmitting(false)
      return
    }

    setForm(EMPTY_FORM)
    const { data } = await supabase
      .from('players')
      .select('id, display_name, nation, canonical_position, position_group, active')
      .eq('season_id', selectedSeasonId)
      .order('display_name')
    setPlayers(data ?? [])
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
          className="bg-spal-surface border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean"
        >
          {seasons.map(s => (
            <option key={s.id} value={s.id}>{s.year}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-8 items-start">
        {/* Add player form */}
        <section className="bg-spal-surface rounded p-5 w-64 shrink-0">
          <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-4">
            Add player
          </h2>
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
            {error && <p className="text-spal-error text-sm">{error}</p>}
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
                  <th className="pb-2 font-normal">Slot group</th>
                </tr>
              </thead>
              <tbody>
                {players.map(p => (
                  <tr
                    key={p.id}
                    className={`border-b border-white/5 ${!p.active ? 'opacity-40' : ''}`}
                  >
                    <td className="py-2 pr-6 text-spal-text">{p.display_name}</td>
                    <td className="py-2 pr-6 text-spal-muted">{p.nation}</td>
                    <td className="py-2 pr-6 text-spal-muted">{p.canonical_position}</td>
                    <td className="py-2 text-spal-muted">{p.position_group}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
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
