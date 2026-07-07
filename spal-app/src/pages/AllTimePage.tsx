import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { EmptyState } from '../components/EmptyState'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorCard from '../components/ErrorCard'

interface RawStanding {
  season_id: number
  profile_id: string
  total_points: number
  seasons: { year: number } | null
  profiles: { display_name: string } | null
}

interface AllTimeRow {
  profile_id: string
  display_name: string
  seasons_played: number
  total_points: number
  avg_per_season: number
  best_finish: number
  seasons_won: number
  predo_points: number | null
}

interface Record {
  label: string
  value: string
  holder: string
}

export default function AllTimePage() {
  useEffect(() => { document.title = 'All-Time Table — SPAL' }, [])
  const [rows, setRows]       = useState<AllTimeRow[]>([])
  const [records, setRecords] = useState<Record[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    setError(false)
    Promise.all([
      supabase
        .from('season_standings')
        .select('season_id, profile_id, total_points, seasons!season_id(year), profiles!profile_id(display_name)'),
      supabase
        .from('predo_scores')
        .select('profile_id, season_id, total_points'),
      supabase
        .from('manager_match_scores')
        .select('profile_id, season_id, final_points, matches!match_id(round_number), profiles!profile_id(display_name)'),
    ]).then(([standingsRes, predoRes, mmsRes]) => {
        if (standingsRes.error || predoRes.error || mmsRes.error) { setError(true); setLoading(false); return }
        const standings = (standingsRes.data ?? []) as unknown as RawStanding[]

        // Per-season predo totals: "${profile_id}:${season_id}" → sum
        const predoSeasonMap = new Map<string, number>()
        for (const row of (predoRes.data ?? []) as Array<{ profile_id: string; season_id: number; total_points: number }>) {
          const key = `${row.profile_id}:${row.season_id}`
          predoSeasonMap.set(key, (predoSeasonMap.get(key) ?? 0) + Number(row.total_points))
        }
        // All-time predo totals per manager
        const predoTotals = new Map<string, number>()
        for (const [key, pts] of predoSeasonMap.entries()) {
          const pid = key.split(':')[0]
          predoTotals.set(pid, (predoTotals.get(pid) ?? 0) + pts)
        }

        // Per-round scores: group manager_match_scores by (profile_id, season_id, round_number)
        type RawMms = { profile_id: string; season_id: number; final_points: number; matches: { round_number: number } | null; profiles: { display_name: string } | null }
        const mmsRows = (mmsRes.data ?? []) as unknown as RawMms[]
        const roundScoreMap = new Map<string, { pts: number; display_name: string }>()
        for (const row of mmsRows) {
          const rn = row.matches?.round_number
          if (rn == null) continue
          const key = `${row.profile_id}:${row.season_id}:${rn}`
          const existing = roundScoreMap.get(key)
          roundScoreMap.set(key, {
            pts: (existing?.pts ?? 0) + Number(row.final_points),
            display_name: row.profiles?.display_name ?? 'Unknown',
          })
        }

        // Group all standings by season for ranks
        const bySeason = new Map<number, RawStanding[]>()
        for (const row of standings) {
          const list = bySeason.get(row.season_id) ?? []
          list.push(row)
          bySeason.set(row.season_id, list)
        }
        const rankMap = new Map<number, Map<string, number>>()
        for (const [sid, sRows] of bySeason.entries()) {
          const sorted = [...sRows].sort((a, b) => b.total_points - a.total_points)
          const perProfile = new Map<string, number>()
          sorted.forEach((r, i) => perProfile.set(r.profile_id, i + 1))
          rankMap.set(sid, perProfile)
        }

        const byManager = new Map<string, {
          display_name: string
          season_ids: Set<number>
          total_points: number
          finishes: number[]
        }>()
        for (const row of standings) {
          const existing = byManager.get(row.profile_id) ?? {
            display_name: row.profiles?.display_name ?? 'Unknown',
            season_ids: new Set<number>(),
            total_points: 0,
            finishes: [],
          }
          existing.season_ids.add(row.season_id)
          existing.total_points += Number(row.total_points)
          const rank = rankMap.get(row.season_id)?.get(row.profile_id) ?? 99
          existing.finishes.push(rank)
          byManager.set(row.profile_id, existing)
        }

        const allTime: AllTimeRow[] = Array.from(byManager.entries()).map(([profile_id, m]) => ({
          profile_id,
          display_name:   m.display_name,
          seasons_played: m.season_ids.size,
          total_points:   m.total_points,
          avg_per_season: m.total_points / m.season_ids.size,
          best_finish:    Math.min(...m.finishes),
          seasons_won:    m.finishes.filter(f => f === 1).length,
          predo_points:   predoTotals.has(profile_id) ? predoTotals.get(profile_id)! : null,
        }))
        allTime.sort((a, b) => b.total_points - a.total_points)
        setRows(allTime)

        // ── Compute records ────────────────────────────────────────────────
        const computed: Record[] = []

        // 1. Highest single round score
        let bestRound = { pts: -Infinity, name: '' }
        for (const [, v] of roundScoreMap.entries()) {
          if (v.pts > bestRound.pts) bestRound = { pts: v.pts, name: v.display_name }
        }
        if (bestRound.pts > -Infinity) {
          computed.push({ label: 'Highest single round', value: bestRound.pts.toFixed(1), holder: bestRound.name })
        }

        // 2. Most points in a season
        let bestSeason = { pts: -Infinity, name: '' }
        for (const row of standings) {
          const pts = Number(row.total_points)
          if (pts > bestSeason.pts) bestSeason = { pts, name: row.profiles?.display_name ?? 'Unknown' }
        }
        if (bestSeason.pts > -Infinity) {
          computed.push({ label: 'Most points in a season', value: bestSeason.pts.toFixed(1), holder: bestSeason.name })
        }

        // 3. Most predo points in a season
        let bestPredo = { pts: -Infinity, name: '' }
        for (const [key, pts] of predoSeasonMap.entries()) {
          if (pts > bestPredo.pts) {
            const pid = key.split(':')[0]
            const name = allTime.find(r => r.profile_id === pid)?.display_name ?? 'Unknown'
            bestPredo = { pts, name }
          }
        }
        if (bestPredo.pts > -Infinity) {
          computed.push({ label: 'Most predo pts in a season', value: bestPredo.pts.toFixed(1), holder: bestPredo.name })
        }

        // 4. Most consistent (lowest coefficient of variation across rounds, min 3 rounds)
        const roundsByManager = new Map<string, number[]>()
        for (const [key, v] of roundScoreMap.entries()) {
          const pid = key.split(':')[0]
          const list = roundsByManager.get(pid) ?? []
          list.push(v.pts)
          roundsByManager.set(pid, list)
        }
        let bestCv = { cv: Infinity, name: '' }
        for (const [pid, scores] of roundsByManager.entries()) {
          if (scores.length < 3) continue
          const mean = scores.reduce((s, x) => s + x, 0) / scores.length
          if (mean === 0) continue
          const variance = scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length
          const cv = Math.sqrt(variance) / mean
          if (cv < bestCv.cv) {
            const name = allTime.find(r => r.profile_id === pid)?.display_name ?? 'Unknown'
            bestCv = { cv, name }
          }
        }
        if (bestCv.cv < Infinity) {
          computed.push({ label: 'Most consistent manager', value: `CV ${(bestCv.cv * 100).toFixed(0)}%`, holder: bestCv.name })
        }

        // 5. Most titles
        const topWinner = allTime.reduce<AllTimeRow | null>((best, r) => {
          if (r.seasons_won === 0) return best
          if (!best || r.seasons_won > best.seasons_won) return r
          return best
        }, null)
        if (topWinner && topWinner.seasons_won > 0) {
          computed.push({ label: 'Most titles', value: String(topWinner.seasons_won), holder: topWinner.display_name })
        }

        setRecords(computed)
        setLoading(false)
      })
  }, [retryKey])

  // Separate winner(s) for glory row
  const mostWins = useMemo(() => Math.max(0, ...rows.map(r => r.seasons_won)), [rows])

  return (
    <div>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-spal-yellow">All-Time Table</h1>
        <Link to="/players/alltime" className="text-xs text-spal-cerulean hover:text-spal-cerulean-light transition-colors">
          Top players →
        </Link>
      </div>
      <p className="text-spal-muted text-sm mb-8">Aggregated across all seasons in the database.</p>

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorCard onRetry={() => setRetryKey(k => k + 1)} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M6 9v11M18 9v11M6 4h12M3 20h18" />
            </svg>
          }
          title="No history yet"
          body="All-time records will appear here once seasons have been completed."
        />
      ) : (
        <>
        {records.length > 0 && (
          <div className="mb-10">
            <h2 className="text-lg font-semibold text-spal-text mb-1">Records</h2>
            <p className="text-xs text-spal-muted mb-4">Notable all-time stats across all completed seasons.</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {records.map(rec => (
                <div key={rec.label} className="bg-spal-surface rounded-lg px-4 py-3 border border-white/5">
                  <p className="text-xs text-spal-muted mb-1">{rec.label}</p>
                  <p className="text-xl font-bold text-spal-yellow tabular-nums">{rec.value}</p>
                  <p className="text-xs text-spal-text mt-0.5">{rec.holder}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-spal-muted border-b border-white/10">
              <th className="pb-2 pr-4 font-normal w-8">#</th>
              <th className="pb-2 pr-6 font-normal">Manager</th>
              <th className="pb-2 pr-4 font-normal text-right tabular-nums hidden sm:table-cell">Seasons</th>
              <th className="pb-2 pr-4 font-normal text-right tabular-nums">Total pts</th>
              <th className="pb-2 pr-4 font-normal text-right tabular-nums hidden md:table-cell">Avg / season</th>
              <th className="pb-2 pr-4 font-normal text-right tabular-nums hidden md:table-cell">Best finish</th>
              <th className="pb-2 pr-4 font-normal text-right tabular-nums hidden sm:table-cell">Wins</th>
              <th className="pb-2 font-normal text-right tabular-nums hidden lg:table-cell">Predo pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isTopWinner = mostWins > 0 && row.seasons_won === mostWins
              return (
                <tr key={row.profile_id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-3 pr-4 text-spal-muted tabular-nums">{i + 1}</td>
                  <td className="py-3 pr-6 font-medium text-spal-text">
                    <Link to={`/manager/${row.profile_id}`} className="hover:text-spal-cerulean transition-colors">
                      {row.display_name}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-spal-muted hidden sm:table-cell">
                    {row.seasons_played}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-spal-text font-medium">
                    {Number(row.total_points).toFixed(1)}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-spal-muted hidden md:table-cell">
                    {Number(row.avg_per_season).toFixed(1)}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-spal-muted hidden md:table-cell">
                    {row.best_finish === 1 ? <span className="text-spal-yellow">1st</span> : `${row.best_finish}${ordinal(row.best_finish)}`}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums hidden sm:table-cell">
                    {row.seasons_won > 0 ? (
                      <span className={isTopWinner ? 'text-spal-yellow font-semibold' : 'text-spal-text'}>
                        {row.seasons_won}
                      </span>
                    ) : (
                      <span className="text-spal-muted">—</span>
                    )}
                  </td>
                  <td className="py-3 text-right tabular-nums text-spal-muted hidden lg:table-cell">
                    {row.predo_points != null ? Number(row.predo_points).toFixed(1) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </>
      )}
    </div>
  )
}

function ordinal(n: number): string {
  if (n === 1) return 'st'
  if (n === 2) return 'nd'
  if (n === 3) return 'rd'
  return 'th'
}
