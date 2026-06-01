import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { EmptyState } from '../components/EmptyState'

interface Season {
  id: number
  year: number
  status: string
}

interface StandingRow {
  season_id: number
  profile_id: string
  total_points: number
  profiles: { display_name: string } | null
}

interface SeasonCard {
  season: Season
  winner: string
  winnerPts: number
  managerCount: number
}

export default function HistoryPage() {
  const [cards, setCards]     = useState<SeasonCard[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: seasonData } = await supabase
        .from('seasons')
        .select('id, year, status')
        .in('status', ['historical', 'complete'])
        .order('year', { ascending: false })

      const seasons = (seasonData ?? []) as Season[]
      if (seasons.length === 0) { setLoading(false); return }

      const seasonIds = seasons.map(s => s.id)

      const { data: standingData } = await supabase
        .from('season_standings')
        .select('season_id, profile_id, total_points, profiles!profile_id(display_name)')
        .in('season_id', seasonIds)

      const standings = (standingData ?? []) as unknown as StandingRow[]

      // Group standings by season_id
      const bySeasonId = new Map<number, StandingRow[]>()
      for (const row of standings) {
        const list = bySeasonId.get(row.season_id) ?? []
        list.push(row)
        bySeasonId.set(row.season_id, list)
      }

      const built: SeasonCard[] = seasons.map(season => {
        const rows = bySeasonId.get(season.id) ?? []
        const winner = rows.reduce<StandingRow | null>(
          (best, r) => best == null || r.total_points > best.total_points ? r : best,
          null,
        )
        return {
          season,
          winner:       winner?.profiles?.display_name ?? 'Unknown',
          winnerPts:    winner?.total_points ?? 0,
          managerCount: rows.length,
        }
      })

      setCards(built)
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold text-spal-yellow mb-1">History</h1>
      <p className="text-spal-muted text-sm mb-8">Past seasons and all-time records.</p>

      {loading ? (
        <p className="text-spal-muted text-sm">Loading…</p>
      ) : cards.length === 0 ? (
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
            </svg>
          }
          title="No completed seasons yet"
          body="Past seasons will appear here once they are marked as complete."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map(({ season, winner, winnerPts, managerCount }) => (
            <Link
              key={season.id}
              to={`/history/${season.year}`}
              className="block bg-spal-surface border border-white/5 rounded-lg p-5 hover:border-spal-cerulean/40 transition-colors group"
            >
              <div className="flex items-start justify-between mb-4">
                <span className="text-3xl font-bold text-spal-yellow group-hover:text-spal-cerulean transition-colors">
                  {season.year}
                </span>
                <span className="text-xs text-spal-muted uppercase tracking-wider mt-1">
                  {managerCount} managers
                </span>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-spal-muted uppercase tracking-wider">Champion</p>
                <p className="text-spal-text font-semibold">{winner}</p>
                <p className="text-spal-cerulean text-sm tabular-nums">{Number(winnerPts).toFixed(1)} pts</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
