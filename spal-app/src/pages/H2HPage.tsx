import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { EmptyState } from '../components/EmptyState'

interface Season { id: number; year: number }

interface H2HRow {
  profile_id: string
  display_name: string
  h2h_points: number
  h2h_wins: number
  h2h_draws: number
  h2h_losses: number
  total_points: number
  last_updated_round: number | null
}

export default function H2HPage() {
  const { user } = useAuth()
  const [seasons, setSeasons]     = useState<Season[]>([])
  const [seasonId, setSeasonId]   = useState<number | null>(null)
  const [rows, setRows]           = useState<H2HRow[]>([])
  const [hasFixtures, setHasFixtures] = useState(true)
  const [loading, setLoading]     = useState(false)

  useEffect(() => {
    supabase
      .from('seasons')
      .select('id, year')
      .order('year', { ascending: false })
      .then(({ data }) => {
        const list = data ?? []
        setSeasons(list)
        if (list.length > 0) setSeasonId(list[0].id)
      })
  }, [])

  useEffect(() => {
    if (seasonId == null) return
    setLoading(true)
    setRows([])

    Promise.all([
      supabase
        .from('season_standings')
        .select('profile_id, h2h_points, h2h_wins, h2h_draws, h2h_losses, total_points, last_updated_round, profiles!profile_id(display_name)')
        .eq('season_id', seasonId)
        .order('h2h_points', { ascending: false })
        .order('total_points', { ascending: false }),

      supabase
        .from('fixture_groups')
        .select('id')
        .eq('season_id', seasonId)
        .limit(1),
    ]).then(([standingsRes, fixturesRes]) => {
      type RawStanding = {
        profile_id: string
        h2h_points: number
        h2h_wins: number
        h2h_draws: number
        h2h_losses: number
        total_points: number
        last_updated_round: number | null
        profiles: { display_name: string } | null
      }
      const standings = (standingsRes.data ?? []) as unknown as RawStanding[]
      setRows(standings.map(s => ({
        profile_id:         s.profile_id,
        display_name:       s.profiles?.display_name ?? 'Unknown',
        h2h_points:         s.h2h_points,
        h2h_wins:           s.h2h_wins,
        h2h_draws:          s.h2h_draws,
        h2h_losses:         s.h2h_losses,
        total_points:       s.total_points,
        last_updated_round: s.last_updated_round,
      })))

      setHasFixtures((fixturesRes.data ?? []).length > 0)
      setLoading(false)
    })
  }, [seasonId])

  const lastRound = rows.reduce<number | null>((acc, r) => {
    if (r.last_updated_round == null) return acc
    return acc == null ? r.last_updated_round : Math.max(acc, r.last_updated_round)
  }, null)

  return (
    <div>
      <h1 className="text-2xl font-bold text-spal-yellow mb-2">Head to Head Cup</h1>
      <p className="text-sm text-spal-muted mb-6">
        Each round, managers are paired for a head-to-head fixture — the manager with higher total points that round wins 4 points (draw: 2 each, loss: 0).
      </p>

      <div className="flex items-center gap-3 mb-8">
        <label className="text-sm text-spal-muted">Season</label>
        <select
          value={seasonId ?? ''}
          onChange={e => setSeasonId(Number(e.target.value))}
          className={selectClass}
        >
          {seasons.map(s => <option key={s.id} value={s.id}>{s.year}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-spal-muted text-sm">Loading…</p>
      ) : !hasFixtures || rows.length === 0 ? (
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10">
              <path d="M17 3v4M7 3v4M3 9h18M7 13h.01M12 13h.01M17 13h.01M7 17h.01M12 17h.01M17 17h.01" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="3" y="5" width="18" height="16" rx="2" />
            </svg>
          }
          title="No H2H data yet"
          body="H2H Cup results will appear after rounds are played"
        />
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-spal-muted border-b border-white/10">
                <th className="pb-2 pr-4 font-normal w-8">#</th>
                <th className="pb-2 pr-6 font-normal">Manager</th>
                <th className="pb-2 pr-4 font-normal text-right tabular-nums">H2H Pts</th>
                <th className="pb-2 pr-4 font-normal text-right hidden sm:table-cell">W/D/L</th>
                <th className="pb-2 font-normal text-right tabular-nums hidden sm:table-cell">Total Pts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const isMe = user?.id === row.profile_id
                return (
                  <tr
                    key={row.profile_id}
                    className={`border-b border-white/5 ${isMe ? 'bg-spal-cerulean/10' : ''}`}
                  >
                    <td className="py-3 pr-4 text-spal-muted tabular-nums">{i + 1}</td>
                    <td className={`py-3 pr-6 font-medium ${isMe ? 'text-spal-cerulean' : 'text-spal-text'}`}>
                      {row.display_name}{isMe && <span className="ml-1 text-xs opacity-60">you</span>}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-spal-text font-semibold">
                      {row.h2h_points}
                    </td>
                    <td className="py-3 pr-4 text-right text-spal-muted tabular-nums hidden sm:table-cell">
                      {row.h2h_wins}W&nbsp;{row.h2h_draws}D&nbsp;{row.h2h_losses}L
                    </td>
                    <td className="py-3 text-right tabular-nums text-spal-muted hidden sm:table-cell">
                      {Number(row.total_points).toFixed(1)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {lastRound != null && (
            <p className="text-xs text-spal-muted mt-3">Last updated: Round {lastRound}</p>
          )}
        </>
      )}
    </div>
  )
}

const selectClass =
  'bg-spal-surface border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
