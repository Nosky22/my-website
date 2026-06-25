import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorCard from '../components/ErrorCard'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Season  { id: number; year: number }
interface Match   { id: number; home_nation: string; away_nation: string; kickoff_at: string | null }

interface Prediction {
  id: number
  profile_id: string
  match_id: number
  predicted_winner: string
  predicted_margin: number
}

interface PredoResult {
  match_id: number
  actual_winner: string
  actual_margin: number
}

interface PredoScore {
  profile_id: string
  round_number: number
  winning_team_points: number
  margin_points: number
  total_points: number
}

interface Profile { id: string; display_name: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROUNDS = [1, 2, 3, 4, 5] as const

function roundDeadlinePassed(matches: Match[]): boolean {
  if (matches.length === 0) return false
  const kickoffs = matches.map(m => m.kickoff_at).filter(Boolean) as string[]
  if (kickoffs.length === 0) return false
  const first = kickoffs.reduce((a, b) => (a < b ? a : b))
  return first <= new Date().toISOString()
}

function winnerOptions(match: Match): string[] {
  return [match.home_nation, match.away_nation, 'Draw']
}

function fmt(pts: number): string {
  return Number(pts).toFixed(1)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PredosPage() {
  const { user } = useAuth()

  const [seasons, setSeasons]         = useState<Season[]>([])
  const [seasonId, setSeasonId]       = useState<number | null>(null)
  const [round, setRound]             = useState<number | null>(null)
  const [matches, setMatches]         = useState<Match[]>([])
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [results, setResults]         = useState<PredoResult[]>([])
  const [scores, setScores]           = useState<PredoScore[]>([])
  const [profiles, setProfiles]       = useState<Profile[]>([])
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(false)

  // Form state: matchId → { winner, margin }
  const [formState, setFormState]   = useState<Record<number, { winner: string; margin: string }>>({})
  const [saving, setSaving]         = useState(false)
  const [saveMsg, setSaveMsg]       = useState<string | null>(null)
  const [rulesOpen, setRulesOpen]   = useState(false)

  // ── Load seasons, default to active, auto-select current round ────
  useEffect(() => {
    supabase
      .from('seasons')
      .select('id, year, status')
      .order('year', { ascending: false })
      .then(async ({ data }) => {
        const list = (data ?? []) as (Season & { status: string })[]
        setSeasons(list)
        const preferred = list.find(s => s.status === 'active') ?? list[0]
        if (!preferred) return
        setSeasonId(preferred.id)

        // Derive current round from kickoffs for the preferred season
        const { data: matchRows } = await supabase
          .from('matches')
          .select('round_number, kickoff_at')
          .eq('season_id', preferred.id)
          .order('round_number')
          .order('kickoff_at')

        if (!matchRows?.length) return
        const now = new Date()
        const allRounds = [...new Set(matchRows.map(m => m.round_number as number))].sort((a, b) => a - b)
        let activeR = allRounds[allRounds.length - 1]
        for (const r of allRounds) {
          const kickoffs = matchRows
            .filter(m => m.round_number === r)
            .map(m => new Date(m.kickoff_at as string))
            .sort((a, b) => a.getTime() - b.getTime())
          if (kickoffs[0] && kickoffs[0] > now) { activeR = r; break }
        }
        setRound(activeR)
      })
  }, [])

  // ── Load round data ───────────────────────────────────────────
  useEffect(() => {
    if (seasonId == null || round == null) {
      setMatches([]); setPredictions([]); setResults([]); setScores([]); setFormState({})
      return
    }
    setLoading(true)
    loadRound(seasonId, round)
  }, [seasonId, round]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadRound(sid: number, r: number) {
    setLoading(true)
    setError(false)
    setSaveMsg(null)

    const { data: matchData, error: matchError } = await supabase
      .from('matches')
      .select('id, home_nation, away_nation, kickoff_at')
      .eq('season_id', sid)
      .eq('round_number', r)
      .order('kickoff_at')

    if (matchError) { setError(true); setLoading(false); return }
    const matchList = (matchData ?? []) as Match[]
    setMatches(matchList)

    if (!matchList.length) { setLoading(false); return }

    const matchIds = matchList.map(m => m.id)

    const [predsRes, resRes, scoresRes, profilesRes] = await Promise.all([
      supabase.from('predo_predictions').select('id, profile_id, match_id, predicted_winner, predicted_margin').in('match_id', matchIds),
      supabase.from('predo_results').select('match_id, actual_winner, actual_margin').in('match_id', matchIds),
      supabase.from('predo_scores').select('profile_id, round_number, winning_team_points, margin_points, total_points').eq('season_id', sid).eq('round_number', r),
      supabase.from('profiles').select('id, display_name').order('display_name'),
    ])

    const predsList = (predsRes.data ?? []) as Prediction[]
    setPredictions(predsList)
    setResults((resRes.data ?? []) as PredoResult[])
    setScores((scoresRes.data ?? []) as PredoScore[])
    setProfiles((profilesRes.data ?? []) as Profile[])

    // Pre-fill form from own predictions (only relevant before deadline)
    if (user) {
      const own = predsList.filter(p => p.profile_id === user.id)
      const init: Record<number, { winner: string; margin: string }> = {}
      for (const p of own) {
        init[p.match_id] = { winner: p.predicted_winner, margin: String(p.predicted_margin) }
      }
      // Default unfilled matches to first option
      for (const m of matchList) {
        if (!init[m.id]) init[m.id] = { winner: m.home_nation, margin: '0' }
      }
      setFormState(init)
    }

    setLoading(false)
  }

  // ── Derived ───────────────────────────────────────────────────
  const deadlinePassed = useMemo(() => roundDeadlinePassed(matches), [matches])
  const resultMap      = useMemo(() => {
    const m = new Map<number, PredoResult>()
    for (const r of results) m.set(r.match_id, r)
    return m
  }, [results])

  const hasAllResults = matches.length > 0 && matches.every(m => resultMap.has(m.id))

  // predictions grouped by match_id
  const predsByMatch = useMemo(() => {
    const m = new Map<number, Prediction[]>()
    for (const p of predictions) {
      if (!m.has(p.match_id)) m.set(p.match_id, [])
      m.get(p.match_id)!.push(p)
    }
    return m
  }, [predictions])

  // manager name lookup
  const nameMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of profiles) m.set(p.id, p.display_name)
    return m
  }, [profiles])

  // cumulative season predo leaderboard (sum all rounds scored so far)
  const seasonLeaderboard = useMemo(() => {
    const totals = new Map<string, number>()
    for (const s of scores) {
      totals.set(s.profile_id, (totals.get(s.profile_id) ?? 0) + Number(s.total_points))
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, pts]) => ({ profile_id: id, name: nameMap.get(id) ?? id, pts }))
  }, [scores, nameMap])

  // ── Save predictions ──────────────────────────────────────────
  async function handleSave() {
    if (!user || seasonId == null || round == null) return
    setSaving(true); setSaveMsg(null)

    const rows = matches.map(m => {
      const f = formState[m.id] ?? { winner: m.home_nation, margin: '0' }
      const margin = f.winner === 'Draw' ? 0 : Math.max(0, parseInt(f.margin, 10) || 0)
      return {
        season_id:        seasonId,
        profile_id:       user.id,
        match_id:         m.id,
        predicted_winner: f.winner,
        predicted_margin: margin,
      }
    })

    const { error } = await supabase
      .from('predo_predictions')
      .upsert(rows, { onConflict: 'profile_id,match_id' })

    setSaving(false)
    if (error) {
      setSaveMsg(error.message)
    } else {
      setSaveMsg('Predictions saved.')
      await loadRound(seasonId, round)
    }
  }

  // ── UI state labels ───────────────────────────────────────────
  const phaseLabel = !deadlinePassed
    ? 'Open for predictions'
    : hasAllResults
    ? 'Results in'
    : 'Round in progress'

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-spal-yellow">Predos</h1>
          <p className="text-spal-muted text-sm mt-0.5">
            Predict match results and win glory. <Link to="/predos/alltime" className="text-spal-cerulean hover:underline">All-time table →</Link>
          </p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded font-medium self-start mt-1 ${
          !deadlinePassed    ? 'bg-spal-cerulean/20 text-spal-cerulean' :
          hasAllResults      ? 'bg-spal-success/20 text-spal-success'    :
                               'bg-amber-500/20 text-amber-400'
        }`}>{round != null ? phaseLabel : ''}</span>
      </div>

      {/* Scoring rules (collapsible) */}
      <details className="bg-spal-surface border border-white/5 rounded-lg" onToggle={e => setRulesOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="px-4 py-3 text-sm font-medium text-spal-text cursor-pointer select-none flex items-center gap-2">
          <span className={`text-spal-muted text-xs transition-transform ${rulesOpen ? 'rotate-90' : ''}`}>▶</span>
          Scoring rules
        </summary>
        <div className="px-4 pb-4 text-sm text-spal-muted space-y-2 border-t border-white/5 pt-3">
          <p><span className="text-spal-text font-medium">Correct winning team:</span> +1 point</p>
          <p><span className="text-spal-text font-medium">Wrong winning team:</span> −1 point</p>
          <p><span className="text-spal-text font-medium">Draw correctly predicted:</span> +1 point</p>
          <p><span className="text-spal-text font-medium">Draw incorrectly predicted:</span> −1 point</p>
          <p className="pt-1 border-t border-white/5">
            <span className="text-spal-text font-medium">Margin points</span> are only awarded when you correctly predicted the winning team (or the draw):
          </p>
          <ul className="pl-3 space-y-0.5">
            <li>Closest margin to actual: <span className="text-spal-text">3 points</span></li>
            <li>Second closest: <span className="text-spal-text">2 points</span></li>
            <li>Third closest: <span className="text-spal-text">1 point</span></li>
            <li>Ties split equally — e.g. two tied for closest share 2.5 pts each</li>
          </ul>
          <p className="pt-1 border-t border-white/5">Margin is always the points difference (e.g. England beat Italy 34–27, margin = 7). A draw prediction sets margin = 0 automatically.</p>
        </div>
      </details>

      {/* Season + round selectors */}
      <div className="flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-3">
          <label className="text-sm text-spal-muted">Season</label>
          <select
            value={seasonId ?? ''}
            onChange={e => { setSeasonId(Number(e.target.value)); setRound(null) }}
            className={selectClass}
          >
            {seasons.map(s => <option key={s.id} value={s.id}>{s.year}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-spal-muted">Round</span>
          {ROUNDS.map(r => (
            <button key={r} onClick={() => setRound(r)} className={roundBtnClass(round === r)}>R{r}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      {round == null ? (
        <p className="text-spal-muted text-sm">Select a round to see predictions.</p>
      ) : loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorCard onRetry={() => { if (seasonId != null && round != null) loadRound(seasonId, round) }} />
      ) : matches.length === 0 ? (
        <p className="text-spal-muted text-sm">No matches found for this round.</p>
      ) : (
        <div className="space-y-8">

          {/* ── Phase A: before deadline — prediction form ─────── */}
          {!deadlinePassed && (
            <section className="space-y-4">
              {user ? (
                <>
                  {matches.map(match => {
                    const f = formState[match.id] ?? { winner: match.home_nation, margin: '0' }
                    return (
                      <div key={match.id} className="bg-spal-surface border border-white/5 rounded-lg p-4">
                        <p className="font-medium text-spal-text mb-3">
                          {match.home_nation} <span className="text-spal-muted font-normal text-sm">vs</span> {match.away_nation}
                          {match.kickoff_at && (
                            <span className="text-xs text-spal-muted ml-2 font-normal">
                              {new Date(match.kickoff_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </p>
                        <div className="flex items-center gap-4 flex-wrap">
                          <div>
                            <label className="block text-xs text-spal-muted mb-1">Winner</label>
                            <select
                              value={f.winner}
                              onChange={e => {
                                const w = e.target.value
                                setFormState(prev => ({
                                  ...prev,
                                  [match.id]: { winner: w, margin: w === 'Draw' ? '0' : prev[match.id]?.margin ?? '0' },
                                }))
                              }}
                              className={inputClass}
                            >
                              {winnerOptions(match).map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </div>
                          {f.winner !== 'Draw' && (
                            <div>
                              <label className="block text-xs text-spal-muted mb-1">Margin (pts)</label>
                              <input
                                type="number"
                                min="0"
                                value={f.margin}
                                onChange={e => setFormState(prev => ({
                                  ...prev,
                                  [match.id]: { ...prev[match.id], margin: e.target.value },
                                }))}
                                className={`${inputClass} w-24`}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  <div className="flex items-center gap-4">
                    <button onClick={handleSave} disabled={saving} className={submitClass}>
                      {saving ? 'Saving…' : 'Save predictions'}
                    </button>
                    {saveMsg && (
                      <p className={`text-sm ${saveMsg.includes('aved') ? 'text-spal-success' : 'text-spal-error'}`}>
                        {saveMsg}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="bg-spal-surface border border-white/5 rounded-lg p-6 text-center">
                  <p className="text-spal-muted text-sm">
                    <Link to="/login" className="text-spal-cerulean hover:underline">Sign in</Link> to submit predictions before the round starts.
                  </p>
                  <p className="text-xs text-spal-muted mt-2">Predictions are hidden until the first match kicks off.</p>
                </div>
              )}
            </section>
          )}

          {/* ── Phase B / C: after deadline — predictions grid ─── */}
          {deadlinePassed && (
            <section className="space-y-4">
              <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider">Predictions</h2>
              {matches.map(match => {
                const result   = resultMap.get(match.id)
                const matchPreds = (predsByMatch.get(match.id) ?? [])
                  .slice()
                  .sort((a, b) => (nameMap.get(a.profile_id) ?? '').localeCompare(nameMap.get(b.profile_id) ?? ''))

                return (
                  <div key={match.id} className="bg-spal-surface border border-white/5 rounded-lg p-4">
                    {/* Match header */}
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                      <p className="font-medium text-spal-text">
                        {match.home_nation} <span className="text-spal-muted font-normal text-sm">vs</span> {match.away_nation}
                      </p>
                      {result && (
                        <span className="text-sm font-semibold text-spal-yellow tabular-nums">
                          Result: {result.actual_winner === 'Draw' ? 'Draw' : `${result.actual_winner} +${result.actual_margin}`}
                        </span>
                      )}
                    </div>

                    {matchPreds.length === 0 ? (
                      <p className="text-spal-muted text-xs">No predictions submitted.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-spal-muted border-b border-white/10">
                            <th className="pb-2 pr-4 font-normal">Manager</th>
                            <th className="pb-2 pr-4 font-normal">Pick</th>
                            <th className="pb-2 pr-4 font-normal text-right tabular-nums">Margin</th>
                            {result && <th className="pb-2 pr-2 font-normal text-right tabular-nums sm:hidden">Pts</th>}
                            {result && <th className="pb-2 pr-2 font-normal text-right tabular-nums hidden sm:table-cell">Win</th>}
                            {result && <th className="pb-2 font-normal text-right tabular-nums hidden sm:table-cell">Margin pts</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {matchPreds.map(pred => {
                            const isMe = user?.id === pred.profile_id
                            const correct = result && pred.predicted_winner === result.actual_winner

                            // Margin points — look up from predo_scores only if scored
                            // We don't store per-match margin breakdown, so just show win/loss indicator
                            return (
                              <tr key={pred.id} className={`border-b border-white/5 ${isMe ? 'bg-spal-cerulean/5' : ''}`}>
                                <td className={`py-2 pr-4 font-medium ${isMe ? 'text-spal-cerulean' : 'text-spal-text'}`}>
                                  {nameMap.get(pred.profile_id) ?? '—'}{isMe && <span className="ml-1 text-xs opacity-60">you</span>}
                                </td>
                                <td className="py-2 pr-4 text-spal-text">{pred.predicted_winner}</td>
                                <td className="py-2 pr-4 text-right tabular-nums text-spal-muted">
                                  {pred.predicted_winner === 'Draw' ? '—' : pred.predicted_margin}
                                </td>
                                {result && (
                                  <td className={`py-2 pr-2 text-right tabular-nums font-medium sm:hidden ${correct ? 'text-spal-success' : 'text-spal-error'}`}>
                                    {correct ? '+1' : '−1'}
                                  </td>
                                )}
                                {result && (
                                  <td className={`py-2 pr-2 text-right tabular-nums font-medium hidden sm:table-cell ${correct ? 'text-spal-success' : 'text-spal-error'}`}>
                                    {correct ? '+1' : '−1'}
                                  </td>
                                )}
                                {result && (
                                  <td className="py-2 text-right tabular-nums text-spal-muted text-xs hidden sm:table-cell">
                                    {correct ? '✓' : '—'}
                                  </td>
                                )}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )
              })}
            </section>
          )}

          {/* ── Round leaderboard (after results) ─────────────── */}
          {hasAllResults && scores.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">
                Round {round} leaderboard
              </h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-spal-muted border-b border-white/10">
                    <th className="pb-2 pr-4 font-normal w-8">#</th>
                    <th className="pb-2 pr-6 font-normal">Manager</th>
                    <th className="pb-2 pr-4 font-normal text-right tabular-nums hidden sm:table-cell">Win pts</th>
                    <th className="pb-2 pr-4 font-normal text-right tabular-nums hidden sm:table-cell">Margin pts</th>
                    <th className="pb-2 font-normal text-right tabular-nums">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {scores
                    .slice()
                    .sort((a, b) => Number(b.total_points) - Number(a.total_points))
                    .map((s, i) => {
                      const isMe = user?.id === s.profile_id
                      return (
                        <tr key={s.profile_id} className={`border-b border-white/5 ${isMe ? 'bg-spal-cerulean/10' : ''}`}>
                          <td className="py-2 pr-4 text-spal-muted tabular-nums">{i + 1}</td>
                          <td className={`py-2 pr-6 font-medium ${isMe ? 'text-spal-cerulean' : 'text-spal-text'}`}>
                            {nameMap.get(s.profile_id) ?? '—'}{isMe && <span className="ml-1 text-xs opacity-60">you</span>}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-spal-muted hidden sm:table-cell">{fmt(Number(s.winning_team_points))}</td>
                          <td className="py-2 pr-4 text-right tabular-nums text-spal-muted hidden sm:table-cell">{fmt(Number(s.margin_points))}</td>
                          <td className={`py-2 text-right tabular-nums font-semibold ${i === 0 ? 'text-spal-yellow' : 'text-spal-text'}`}>
                            {fmt(Number(s.total_points))}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </section>
          )}

          {/* Season cumulative leaderboard — once any round has been scored */}
          {seasonLeaderboard.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">
                Season standings
              </h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-spal-muted border-b border-white/10">
                    <th className="pb-2 pr-4 font-normal w-8">#</th>
                    <th className="pb-2 pr-6 font-normal">Manager</th>
                    <th className="pb-2 font-normal text-right tabular-nums">Predo pts</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonLeaderboard.map((row, i) => {
                    const isMe = user?.id === row.profile_id
                    return (
                      <tr key={row.profile_id} className={`border-b border-white/5 ${isMe ? 'bg-spal-cerulean/10' : ''}`}>
                        <td className="py-2 pr-4 text-spal-muted tabular-nums">{i + 1}</td>
                        <td className={`py-2 pr-6 font-medium ${isMe ? 'text-spal-cerulean' : 'text-spal-text'}`}>
                          {row.name}{isMe && <span className="ml-1 text-xs opacity-60">you</span>}
                        </td>
                        <td className={`py-2 text-right tabular-nums font-semibold ${i === 0 ? 'text-spal-yellow' : 'text-spal-text'}`}>
                          {fmt(row.pts)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          )}

        </div>
      )}
    </div>
  )
}

// ── Style constants ───────────────────────────────────────────────────────────

const selectClass = 'bg-spal-surface border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
const inputClass  = 'bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
const submitClass = 'bg-spal-cerulean text-white text-sm rounded px-4 py-1.5 hover:bg-spal-cerulean-light disabled:opacity-50 transition-colors'

function roundBtnClass(active: boolean) {
  return `px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
    active
      ? 'border-spal-cerulean bg-spal-cerulean/10 text-spal-cerulean'
      : 'border-white/10 text-spal-muted hover:border-white/30 hover:text-spal-text'
  }`
}
