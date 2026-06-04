import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NationBadge from '../components/NationBadge'
import { EmptyState } from '../components/EmptyState'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorCard from '../components/ErrorCard'

interface RawScore {
  player_id: number
  season_id: number
  final_points: number
  matches: { round_number: number } | null
  players: { display_name: string; nation: string; canonical_position: string } | null
}

interface PlayerAllTime {
  player_id: number
  display_name: string
  nation: string
  position: string
  total_points: number
  seasons_appeared: number
  avg_per_season: number
  best_round: number
}

const NATIONS = ['England', 'Ireland', 'Scotland', 'Wales', 'France', 'Italy']
const POSITIONS = [
  'Prop', 'Hooker', 'Second Row', 'Flanker', 'Number 8',
  'Scrum-half', 'Fly-half', 'Centre', 'Wing', 'Fullback',
]

export default function PlayersAllTimePage() {
  const [rows, setRows]       = useState<PlayerAllTime[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [nation, setNation]   = useState('')
  const [position, setPosition] = useState('')

  useEffect(() => {
    setError(false)
    supabase
      .from('player_match_scores')
      .select('player_id, season_id, final_points, matches!match_id(round_number), players!player_id(display_name, nation, canonical_position)')
      .then(({ data, error: fetchError }) => {
        if (fetchError) { setError(true); setLoading(false); return }
        const scores = (data ?? []) as unknown as RawScore[]

        // Aggregate per player
        type Acc = {
          display_name: string
          nation: string
          position: string
          total_points: number
          season_ids: Set<number>
          // key = `${season_id}_${round_number}` → sum of points for that round
          roundTotals: Map<string, number>
        }

        const byPlayer = new Map<number, Acc>()

        for (const s of scores) {
          if (!s.players) continue
          const pts = Number(s.final_points ?? 0)
          const roundKey = `${s.season_id}_${s.matches?.round_number ?? 0}`

          const acc = byPlayer.get(s.player_id) ?? {
            display_name: s.players.display_name,
            nation:       s.players.nation,
            position:     s.players.canonical_position,
            total_points: 0,
            season_ids:   new Set<number>(),
            roundTotals:  new Map<string, number>(),
          }
          acc.total_points += pts
          acc.season_ids.add(s.season_id)
          acc.roundTotals.set(roundKey, (acc.roundTotals.get(roundKey) ?? 0) + pts)
          byPlayer.set(s.player_id, acc)
        }

        const result: PlayerAllTime[] = Array.from(byPlayer.entries())
          .filter(([, a]) => a.total_points > 0)
          .map(([player_id, a]) => {
            const seasons = a.season_ids.size
            const bestRound = Math.max(0, ...a.roundTotals.values())
            return {
              player_id,
              display_name:     a.display_name,
              nation:           a.nation,
              position:         a.position,
              total_points:     a.total_points,
              seasons_appeared: seasons,
              avg_per_season:   seasons > 0 ? a.total_points / seasons : 0,
              best_round:       bestRound,
            }
          })

        result.sort((a, b) => b.total_points - a.total_points)
        setRows(result)
        setLoading(false)
      })
  }, [retryKey])

  const visible = useMemo(() => rows.filter(r =>
    (!nation   || r.nation   === nation) &&
    (!position || r.position === position)
  ), [rows, nation, position])

  const selectClass = 'bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'

  return (
    <div>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-spal-yellow">All-Time Top Players</h1>
        <Link to="/players" className="text-xs text-spal-muted hover:text-spal-text transition-colors">
          ← Current season
        </Link>
      </div>
      <p className="text-spal-muted text-sm mb-6">Total fantasy points across all seasons in the database.</p>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select value={nation} onChange={e => setNation(e.target.value)} className={selectClass}>
          <option value="">All nations</option>
          {NATIONS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={position} onChange={e => setPosition(e.target.value)} className={selectClass}>
          <option value="">All positions</option>
          {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {(nation || position) && (
          <button
            onClick={() => { setNation(''); setPosition('') }}
            className="text-xs text-spal-muted hover:text-spal-text transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorCard onRetry={() => setRetryKey(k => k + 1)} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
          }
          title="No players found"
          body="No players match the current filters."
        />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-spal-muted border-b border-white/10">
              <th className="pb-2 pr-3 font-normal w-8">#</th>
              <th className="pb-2 pr-4 font-normal">Player</th>
              <th className="pb-2 pr-4 font-normal hidden sm:table-cell">Nation</th>
              <th className="pb-2 pr-4 font-normal hidden md:table-cell">Position</th>
              <th className="pb-2 pr-4 font-normal text-right tabular-nums hidden sm:table-cell">Seasons</th>
              <th className="pb-2 pr-4 font-normal text-right tabular-nums">Total pts</th>
              <th className="pb-2 pr-4 font-normal text-right tabular-nums hidden md:table-cell">Avg / season</th>
              <th className="pb-2 font-normal text-right tabular-nums hidden lg:table-cell">Best round</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={row.player_id} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="py-3 pr-3 text-spal-muted tabular-nums">{i + 1}</td>
                <td className="py-3 pr-4 font-medium text-spal-text">
                  {row.display_name}
                  <span className="sm:hidden text-xs text-spal-muted ml-2">{row.nation}</span>
                </td>
                <td className="py-3 pr-4 hidden sm:table-cell">
                  <NationBadge nation={row.nation} />
                </td>
                <td className="py-3 pr-4 text-spal-muted text-xs hidden md:table-cell">{row.position}</td>
                <td className="py-3 pr-4 text-right tabular-nums text-spal-muted hidden sm:table-cell">
                  {row.seasons_appeared}
                </td>
                <td className="py-3 pr-4 text-right tabular-nums font-medium text-spal-text">
                  {Number(row.total_points).toFixed(1)}
                </td>
                <td className="py-3 pr-4 text-right tabular-nums text-spal-muted hidden md:table-cell">
                  {Number(row.avg_per_season).toFixed(1)}
                </td>
                <td className="py-3 text-right tabular-nums text-spal-muted hidden lg:table-cell">
                  {Number(row.best_round).toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
