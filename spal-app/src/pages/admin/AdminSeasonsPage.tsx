import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/Toast'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorCard from '../../components/ErrorCard'

interface Season {
  id: number
  year: number
  status: string
  created_at: string
}

const NATIONS = ['England', 'Ireland', 'Scotland', 'Wales', 'France', 'Italy'] as const

type RulesForm = typeof DEFAULT_RULES

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
  const [seasonsError, setSeasonsError] = useState(false)
  const [form, setForm]             = useState({ year: new Date().getFullYear(), status: 'setup' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [changingStatus, setChangingStatus] = useState<number | null>(null)

  // Rules editor
  const [rulesSeasonId, setRulesSeasonId]   = useState<number | null>(null)
  const [rulesForm, setRulesForm]           = useState<RulesForm>(DEFAULT_RULES)
  const [rulesExtra, setRulesExtra]         = useState<Record<string, unknown>>({})
  const [rulesLoading, setRulesLoading]     = useState(false)
  const [rulesError, setRulesError]         = useState(false)
  const [rulesSaving, setRulesSaving]       = useState(false)

  useEffect(() => { fetchSeasons() }, [])

  // Default the rules editor to the first (most recent) season once loaded.
  useEffect(() => {
    if (seasons.length > 0 && rulesSeasonId === null) setRulesSeasonId(seasons[0].id)
  }, [seasons, rulesSeasonId])

  useEffect(() => {
    if (rulesSeasonId !== null) fetchRules(rulesSeasonId)
  }, [rulesSeasonId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchSeasons() {
    setLoading(true)
    setSeasonsError(false)
    const { data, error } = await supabase
      .from('seasons')
      .select('id, year, status, created_at')
      .order('year', { ascending: false })
    if (error) { setSeasonsError(true); setLoading(false); return }
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

  async function fetchRules(seasonId: number) {
    setRulesLoading(true)
    setRulesError(false)
    const { data, error: fetchError } = await supabase
      .from('season_rules')
      .select('rules')
      .eq('season_id', seasonId)
      .maybeSingle()
    if (fetchError) { setRulesError(true); setRulesLoading(false); return }
    const blob = (data?.rules ?? {}) as Record<string, unknown>

    // Boolean fields need explicit undefined check — `false ?? default` would
    // incorrectly fall through to the default.
    setRulesForm({
      captain_multiplier:           Number(blob.captain_multiplier           ?? DEFAULT_RULES.captain_multiplier),
      supersub_bench_multiplier:    Number(blob.supersub_bench_multiplier    ?? DEFAULT_RULES.supersub_bench_multiplier),
      supersub_starter_multiplier:  Number(blob.supersub_starter_multiplier  ?? DEFAULT_RULES.supersub_starter_multiplier),
      supersub_not_played_points:   Number(blob.supersub_not_played_points   ?? DEFAULT_RULES.supersub_not_played_points),
      budget_enabled:               blob.budget_enabled !== undefined               ? Boolean(blob.budget_enabled)               : DEFAULT_RULES.budget_enabled,
      budget_limit:                 Number(blob.budget_limit                 ?? DEFAULT_RULES.budget_limit),
      max_players_per_nation:       Number(blob.max_players_per_nation       ?? DEFAULT_RULES.max_players_per_nation),
      italian_starter_rule_enabled: blob.italian_starter_rule_enabled !== undefined ? Boolean(blob.italian_starter_rule_enabled) : DEFAULT_RULES.italian_starter_rule_enabled,
      italian_starter_required:     Number(blob.italian_starter_required     ?? DEFAULT_RULES.italian_starter_required),
      weakest_nation:               String(blob.weakest_nation               ?? DEFAULT_RULES.weakest_nation),
    })

    // Preserve keys not in this form (e.g. slot_*_enabled set by draft setup)
    // so a save here doesn't erase them.
    const formKeys = new Set(Object.keys(DEFAULT_RULES))
    const extra: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(blob)) {
      if (!formKeys.has(k)) extra[k] = v
    }
    setRulesExtra(extra)
    setRulesLoading(false)
  }

  async function handleSaveRules(e: React.FormEvent) {
    e.preventDefault()
    if (rulesSeasonId == null) return
    setRulesSaving(true)
    const { error } = await supabase
      .from('season_rules')
      .upsert({ season_id: rulesSeasonId, rules: { ...rulesExtra, ...rulesForm } }, { onConflict: 'season_id' })
    if (error) { addToast(error.message, 'error'); setRulesSaving(false); return }
    addToast('Rules saved', 'success')
    setRulesSaving(false)
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
        <LoadingSpinner />
      ) : seasonsError ? (
        <ErrorCard onRetry={fetchSeasons} />
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
      {/* ── Season Rules editor ───────────────────────────────────────── */}
      <section className="mt-12">
        <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-4">
          Season Rules
        </h2>

        <div className="flex items-center gap-3 mb-6">
          <label className="text-sm text-spal-muted">Season</label>
          <select
            value={rulesSeasonId ?? ''}
            onChange={e => setRulesSeasonId(Number(e.target.value))}
            className="bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean"
          >
            {seasons.map(s => <option key={s.id} value={s.id}>{s.year}</option>)}
          </select>
        </div>

        {rulesLoading ? (
          <LoadingSpinner />
        ) : rulesError ? (
          <ErrorCard onRetry={() => { if (rulesSeasonId != null) fetchRules(rulesSeasonId) }} />
        ) : (
          <form onSubmit={handleSaveRules} className="max-w-lg space-y-7">

            {/* Scoring multipliers */}
            <div>
              <p className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">
                Scoring multipliers
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Captain multiplier" htmlFor="r-captain">
                  <input id="r-captain" type="number" step="0.5" min="0"
                    value={rulesForm.captain_multiplier}
                    onChange={e => setRulesForm(f => ({ ...f, captain_multiplier: Number(e.target.value) }))}
                    className={inputClass} />
                </Field>
                <Field label="Supersub bench multiplier" htmlFor="r-ssb">
                  <input id="r-ssb" type="number" step="0.5" min="0"
                    value={rulesForm.supersub_bench_multiplier}
                    onChange={e => setRulesForm(f => ({ ...f, supersub_bench_multiplier: Number(e.target.value) }))}
                    className={inputClass} />
                </Field>
                <Field label="Supersub starter multiplier" htmlFor="r-sss">
                  <input id="r-sss" type="number" step="0.1" min="0"
                    value={rulesForm.supersub_starter_multiplier}
                    onChange={e => setRulesForm(f => ({ ...f, supersub_starter_multiplier: Number(e.target.value) }))}
                    className={inputClass} />
                </Field>
                <Field label="Supersub not played points" htmlFor="r-ssnp">
                  <input id="r-ssnp" type="number" step="1"
                    value={rulesForm.supersub_not_played_points}
                    onChange={e => setRulesForm(f => ({ ...f, supersub_not_played_points: Number(e.target.value) }))}
                    className={inputClass} />
                </Field>
              </div>
            </div>

            {/* Budget */}
            <div>
              <p className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">
                Budget
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-sm text-spal-muted mb-1">Budget enabled</p>
                  <label className="flex items-center gap-2 cursor-pointer h-[34px]">
                    <input type="checkbox"
                      checked={rulesForm.budget_enabled}
                      onChange={e => setRulesForm(f => ({ ...f, budget_enabled: e.target.checked }))}
                      className="accent-spal-cerulean w-4 h-4" />
                    <span className="text-sm text-spal-text">Enabled</span>
                  </label>
                </div>
                <Field label="Budget limit (★)" htmlFor="r-budget">
                  <input id="r-budget" type="number" step="1" min="0"
                    value={rulesForm.budget_limit}
                    onChange={e => setRulesForm(f => ({ ...f, budget_limit: Number(e.target.value) }))}
                    disabled={!rulesForm.budget_enabled}
                    className={inputClass + ' disabled:opacity-40'} />
                </Field>
              </div>
            </div>

            {/* Squad rules */}
            <div>
              <p className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">
                Squad rules
              </p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Field label="Max players per nation" htmlFor="r-maxnation">
                  <input id="r-maxnation" type="number" step="1" min="1" max="15"
                    value={rulesForm.max_players_per_nation}
                    onChange={e => setRulesForm(f => ({ ...f, max_players_per_nation: Number(e.target.value) }))}
                    className={inputClass} />
                </Field>
                <Field label="Weakest nation" htmlFor="r-weakest">
                  <select id="r-weakest"
                    value={rulesForm.weakest_nation}
                    onChange={e => setRulesForm(f => ({ ...f, weakest_nation: e.target.value }))}
                    className={inputClass}>
                    {NATIONS.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-sm text-spal-muted mb-1">Italian starter rule</p>
                  <label className="flex items-center gap-2 cursor-pointer h-[34px]">
                    <input type="checkbox"
                      checked={rulesForm.italian_starter_rule_enabled}
                      onChange={e => setRulesForm(f => ({ ...f, italian_starter_rule_enabled: e.target.checked }))}
                      className="accent-spal-cerulean w-4 h-4" />
                    <span className="text-sm text-spal-text">Enabled</span>
                  </label>
                </div>
                <Field label="Italian starters required" htmlFor="r-italian">
                  <input id="r-italian" type="number" step="1" min="0" max="15"
                    value={rulesForm.italian_starter_required}
                    onChange={e => setRulesForm(f => ({ ...f, italian_starter_required: Number(e.target.value) }))}
                    disabled={!rulesForm.italian_starter_rule_enabled}
                    className={inputClass + ' disabled:opacity-40'} />
                </Field>
              </div>
            </div>

            <button type="submit" disabled={rulesSaving} className={submitClass}>
              {rulesSaving ? 'Saving…' : 'Save rules'}
            </button>
          </form>
        )}
      </section>

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
