import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { EmptyState } from '../components/EmptyState'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorCard from '../components/ErrorCard'

interface ScoreRow {
  profile_id: string
  season_id: number
  round_number: number
  total_points: number
  winning_team_points: number
  margin_points: number
}

interface Profile { id: string; display_name: string }

interface ManagerRow {
  profile_id: string
  display_name: string
  total_pts: number
  seasons: number
  avg_per_season: number
  best_round: number
}

function fmt(n: number): string {
  return Number(n).toFixed(1)
}

export default function PredosAllTimePage() {
  useEffect(() => { document.title = 'Predos All-Time — SPAL' }, [])
  const [scores, setScores]     = useState<ScoreRow[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    setError(false)
    Promise.all([
      supabase.from('predo_scores').select('profile_id, season_id, round_number, total_points, winning_team_points, margin_points'),
      supabase.from('profiles').select('id, display_name').order('display_name'),
    ]).then(([scoresRes, profilesRes]) => {
      if (scoresRes.error || profilesRes.error) { setError(true); setLoading(false); return }
      setScores((scoresRes.data ?? []) as ScoreRow[])
      setProfiles((profilesRes.data ?? []) as Profile[])
      setLoading(false)
    })
  }, [retryKey])

  const nameMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of profiles) m.set(p.id, p.display_name)
    return m
  }, [profiles])

  const rows: ManagerRow[] = useMemo(() => {
    // Aggregate: total_pts, seasons played, best single-round score
    const mgr = new Map<string, { total: number; seasons: Set<number>; bestRound: number }>()

    for (const s of scores) {
      if (!mgr.has(s.profile_id)) mgr.set(s.profile_id, { total: 0, seasons: new Set(), bestRound: -Infinity })
      const m = mgr.get(s.profile_id)!
      m.total += Number(s.total_points)
      m.seasons.add(s.season_id)
      if (Number(s.total_points) > m.bestRound) m.bestRound = Number(s.total_points)
    }

    return Array.from(mgr.entries())
      .map(([id, d]) => ({
        profile_id:    id,
        display_name:  nameMap.get(id) ?? id,
        total_pts:     d.total,
        seasons:       d.seasons.size,
        avg_per_season: d.total / d.seasons.size,
        best_round:    d.bestRound === -Infinity ? 0 : d.bestRound,
      }))
      .sort((a, b) => b.total_pts - a.total_pts)
  }, [scores, nameMap])

  return (
    <div className="space-y-8">
      <div>
        <Link to="/predos" className="text-xs text-spal-muted hover:text-spal-text transition-colors">
          ← Predos
        </Link>
        <h1 className="text-2xl font-bold text-spal-yellow mt-2">Predos — All-Time</h1>
        <p className="text-spal-muted text-sm mt-0.5">Aggregated predo scores across all seasons</p>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorCard onRetry={() => setRetryKey(k => k + 1)} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
            </svg>
          }
          title="No predo scores yet"
          body="Scores will appear here once rounds have been calculated."
        />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-spal-muted border-b border-white/10">
              <th className="pb-2 pr-4 font-normal w-8">#</th>
              <th className="pb-2 pr-6 font-normal">Manager</th>
              <th className="pb-2 pr-4 font-normal text-right tabular-nums">Total pts</th>
              <th className="pb-2 pr-4 font-normal text-right tabular-nums hidden sm:table-cell">Seasons</th>
              <th className="pb-2 pr-4 font-normal text-right tabular-nums hidden sm:table-cell">Avg / season</th>
              <th className="pb-2 font-normal text-right tabular-nums hidden sm:table-cell">Best round</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.profile_id} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="py-3 pr-4 text-spal-muted tabular-nums">{i + 1}</td>
                <td className="py-3 pr-6 font-medium text-spal-text">
                  <Link to={`/manager/${row.profile_id}`} className="hover:text-spal-cerulean transition-colors">
                    {row.display_name}
                  </Link>
                </td>
                <td className={`py-3 pr-4 text-right tabular-nums font-semibold ${i === 0 ? 'text-spal-yellow' : 'text-spal-text'}`}>
                  {fmt(row.total_pts)}
                </td>
                <td className="py-3 pr-4 text-right tabular-nums text-spal-muted hidden sm:table-cell">{row.seasons}</td>
                <td className="py-3 pr-4 text-right tabular-nums text-spal-muted hidden sm:table-cell">{fmt(row.avg_per_season)}</td>
                <td className="py-3 text-right tabular-nums text-spal-muted hidden sm:table-cell">{fmt(row.best_round)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
