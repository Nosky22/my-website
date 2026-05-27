import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/Toast'

interface Season {
  id: number
  year: number
  status: string
  created_at: string
}

const DEFAULT_RULES = {
  captain_multiplier: 2,
  supersub_bench_multiplier: 3,
  supersub_starter_multiplier: 0.5,
  supersub_not_played_points: 0,
  budget_enabled: true,
  budget_limit: 200,
  max_players_per_nation: 4,
  italian_starter_rule_enabled: true,
  italian_starter_required: 1,
  weakest_nation: 'Wales',
}

const STATUS_OPTIONS = ['setup', 'test', 'active', 'live', 'complete', 'historical'] as const

const STATUS_COLOURS: Record<string, string> = {
  active:     'bg-spal-cerulean/20 text-spal-cerulean',
  setup:      'bg-spal-warning/20  text-spal-warning',
  test:       'bg-purple-500/20    text-purple-300',
  historical: 'bg-white/10         text-spal-muted',
  live:       'bg-spal-success/20  text-spal-success',
  complete:   'bg-white/5          text-spal-muted',
}

export default function AdminSeasonsPage() {
  const { addToast } = useToast()
  const [seasons, setSeasons]       = useState<Season[]>([])
  const [loading, setLoading]       = useState(true)
  const [form, setForm]             = useState({ year: new Date().getFullYear(), status: 'setup' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [changingStatus, setChangingStatus] = useState<number | null>(null)

  useEffect(() => { fetchSeasons() }, [])

  async function fetchSeasons() {
    setLoading(true)
    const { data, error } = await supabase
      .from('seasons')
      .select('id, year, status, created_at')
      .order('year', { ascending: false })
    if (error) console.error(error)
    setSeasons(data ?? [])
    setLoading(false)
  }

  async function handleSetStatus(id: number, newStatus: string) {
    setChangingStatus(id)
    const season = seasons.find(s => s.id === id)
    if (newStatus === 'active') {
      // Demote any other active season to 'complete' before promoting this one.
      await supabase
        .from('seasons')
        .update({ status: 'complete' })
        .eq('status', 'active')
        .neq('id', id)
    }
    await supabase.from('seasons').update({ status: newStatus }).eq('id', id)
    await fetchSeasons()
    addToast(`${season?.year ?? 'Season'} set to ${newStatus}`, 'success')
    setChangingStatus(null)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const { data: season, error: seasonErr } = await supabase
      .from('seasons')
      .insert({ year: form.year, status: form.status })
      .select('id')
      .single()

    if (seasonErr) {
      setError(seasonErr.message)
      setSubmitting(false)
      return
    }

    const { error: rulesErr } = await supabase
      .from('season_rules')
      .insert({ season_id: season.id, rules: DEFAULT_RULES })

    if (rulesErr) {
      setError(`Season created but rules failed: ${rulesErr.message}`)
      setSubmitting(false)
      return
    }

    addToast(`${form.year} season created`, 'success')
    await fetchSeasons()
    setForm({ year: new Date().getFullYear(), status: 'setup' })
    setSubmitting(false)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-spal-yellow mb-6">Seasons</h1>

      <section className="bg-spal-surface rounded p-5 mb-8 max-w-xs">
        <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-4">
          Create season
        </h2>
        <form onSubmit={handleCreate} className="space-y-3">
          <Field label="Year" htmlFor="season-year">
            <input
              id="season-year"
              type="number"
              value={form.year}
              onChange={e => setForm(f => ({ ...f, year: Number(e.target.value) }))}
              min={2020}
              max={2100}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Status" htmlFor="season-status">
            <select
              id="season-status"
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              className={inputClass}
            >
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          {error && <p className="text-spal-error text-sm">{error}</p>}
          <button type="submit" disabled={submitting} className={submitClass}>
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </form>
      </section>

      {loading ? (
        <p className="text-spal-muted text-sm">Loading…</p>
      ) : seasons.length === 0 ? (
        <p className="text-spal-muted text-sm">No seasons yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-spal-muted border-b border-white/10">
              <th className="pb-2 pr-8 font-normal">Year</th>
              <th className="pb-2 pr-8 font-normal">Status</th>
              <th className="pb-2 pr-8 font-normal">Created</th>
              <th className="pb-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {seasons.map(s => (
              <tr key={s.id} className="border-b border-white/5">
                <td className="py-2 pr-8 text-spal-text font-medium">{s.year}</td>
                <td className="py-2 pr-8">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs ${STATUS_COLOURS[s.status] ?? ''}`}>
                    {s.status}
                  </span>
                </td>
                <td className="py-2 pr-8 text-spal-muted">
                  {new Date(s.created_at).toLocaleDateString()}
                </td>
                <td className="py-2">
                  <select
                    value={s.status}
                    disabled={changingStatus !== null}
                    onChange={e => handleSetStatus(s.id, e.target.value)}
                    className="bg-spal-bg border border-white/10 rounded px-2 py-1 text-spal-text text-xs focus:outline-none focus:border-spal-cerulean disabled:opacity-40"
                  >
                    {STATUS_OPTIONS.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
