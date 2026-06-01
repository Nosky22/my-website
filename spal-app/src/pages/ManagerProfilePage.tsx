import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NationBadge from '../components/NationBadge'
import { EmptyState } from '../components/EmptyState'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Profile {
  id: string
  display_name: string
  team_name: string | null
}

interface SeasonRecord {
  season_id: number
  year: number
  total_points: number
  rounds_played: number
  position: number   // computed rank within the season
}

interface DraftedPlayer {
  season_id: number
  year: number
  pick_number: number
  draft_slot: string
  display_name: string
  nation: string
  canonical_position: string
}

const DRAFT_SLOT_LABELS: Record<string, string> = {
  front_row:      'Front Row',
  back_row:       'Back Row',
  outside_back:   'Outside Back',
  weakest_nation: 'Weakest Nation',
  bench:          'Bench',
}

function fmtSlot(slot: string): string {
  return DRAFT_SLOT_LABELS[slot] ?? slot.replace(/_/g, ' ')
}

function ordinal(n: number): string {
  if (n === 1) return '1st'
  if (n === 2) return '2nd'
  if (n === 3) return '3rd'
  return `${n}th`
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ManagerProfilePage() {
  const { profileId } = useParams<{ profileId: string }>()

  const [profile, setProfile]           = useState<Profile | null>(null)
  const [seasonRecords, setSeasonRecords] = useState<SeasonRecord[]>([])
  const [draftedPlayers, setDraftedPlayers] = useState<DraftedPlayer[]>([])
  const [loading, setLoading]           = useState(true)
  const [notFound, setNotFound]         = useState(false)

  useEffect(() => {
    if (!profileId) return

    async function load() {
      // 1. Profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, display_name, team_name')
        .eq('id', profileId)
        .maybeSingle()

      if (!profileData) { setNotFound(true); setLoading(false); return }
      setProfile(profileData as Profile)

      // 2. All standings in parallel with draft picks
      const [standingsRes, picksRes] = await Promise.all([
        // Manager's own standings + season year
        supabase
          .from('season_standings')
          .select('season_id, total_points, rounds_played, seasons!season_id(year)')
          .eq('profile_id', profileId),

        // All their draft picks across all seasons
        supabase
          .from('draft_picks')
          .select('season_id, pick_number, draft_slot, players!player_id(display_name, nation, canonical_position), seasons!season_id(year)')
          .eq('profile_id', profileId)
          .order('season_id', { ascending: false })
          .order('pick_number'),
      ])

      type RawStanding = {
        season_id: number; total_points: number; rounds_played: number
        seasons: { year: number } | null
      }
      const myStandings = (standingsRes.data ?? []) as unknown as RawStanding[]

      // Fetch all standings for seasons this manager played in (to compute their position)
      const seasonIds = myStandings.map(s => s.season_id)
      if (seasonIds.length > 0) {
        const { data: allStandingsData } = await supabase
          .from('season_standings')
          .select('season_id, profile_id, total_points')
          .in('season_id', seasonIds)

        type RawAllStanding = { season_id: number; profile_id: string; total_points: number }
        const allStandings = (allStandingsData ?? []) as unknown as RawAllStanding[]

        // Compute rank per season
        const rankMap = new Map<number, number>()
        for (const sid of seasonIds) {
          const inSeason = allStandings
            .filter(s => s.season_id === sid)
            .sort((a, b) => b.total_points - a.total_points)
          const pos = inSeason.findIndex(s => s.profile_id === profileId) + 1
          rankMap.set(sid, pos > 0 ? pos : 99)
        }

        const records: SeasonRecord[] = myStandings
          .map(s => ({
            season_id:     s.season_id,
            year:          s.seasons?.year ?? 0,
            total_points:  Number(s.total_points),
            rounds_played: s.rounds_played,
            position:      rankMap.get(s.season_id) ?? 99,
          }))
          .sort((a, b) => b.year - a.year)

        setSeasonRecords(records)
      }

      // Draft picks
      type RawPick = {
        season_id: number; pick_number: number; draft_slot: string
        players: { display_name: string; nation: string; canonical_position: string } | null
        seasons: { year: number } | null
      }
      setDraftedPlayers(
        ((picksRes.data ?? []) as unknown as RawPick[]).map(p => ({
          season_id:          p.season_id,
          year:               p.seasons?.year ?? 0,
          pick_number:        p.pick_number,
          draft_slot:         p.draft_slot,
          display_name:       p.players?.display_name ?? 'Unknown',
          nation:             p.players?.nation ?? '',
          canonical_position: p.players?.canonical_position ?? '',
        }))
      )

      setLoading(false)
    }

    load()
  }, [profileId])

  // All-time summary stats
  const allTimeStats = useMemo(() => {
    if (seasonRecords.length === 0) return null
    const total   = seasonRecords.reduce((sum, r) => sum + r.total_points, 0)
    const avg     = total / seasonRecords.length
    const best    = Math.min(...seasonRecords.map(r => r.position))
    const wins    = seasonRecords.filter(r => r.position === 1).length
    return { total, avg, best, wins, seasons: seasonRecords.length }
  }, [seasonRecords])

  // Draft picks grouped by season (already sorted by season desc, then pick_number)
  const picksBySeason = useMemo(() => {
    const order: number[] = []
    const byYear = new Map<number, { season_id: number; year: number; picks: DraftedPlayer[] }>()
    for (const p of draftedPlayers) {
      if (!byYear.has(p.year)) {
        order.push(p.year)
        byYear.set(p.year, { season_id: p.season_id, year: p.year, picks: [] })
      }
      byYear.get(p.year)!.picks.push(p)
    }
    return order.map(y => byYear.get(y)!)
  }, [draftedPlayers])

  if (loading) return <p className="text-spal-muted text-sm">Loading…</p>

  if (notFound || !profile) {
    return (
      <EmptyState
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10">
            <circle cx="12" cy="8" r="4" strokeLinecap="round" strokeLinejoin="round" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        }
        title="Manager not found"
        body="This profile doesn't exist or hasn't played in any recorded seasons."
      />
    )
  }

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <Link to="/alltime" className="text-xs text-spal-muted hover:text-spal-text transition-colors">
          ← All-Time Table
        </Link>
        <h1 className="text-2xl font-bold text-spal-yellow mt-2">{profile.display_name}</h1>
        {profile.team_name && (
          <p className="text-spal-muted text-sm mt-0.5">{profile.team_name}</p>
        )}
      </div>

      {/* All-time summary */}
      {allTimeStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Seasons" value={String(allTimeStats.seasons)} />
          <StatCard label="Total points" value={allTimeStats.total.toFixed(1)} />
          <StatCard label="Avg / season" value={allTimeStats.avg.toFixed(1)} />
          <StatCard label="Best finish" value={ordinal(allTimeStats.best)} highlight={allTimeStats.best === 1} />
          {allTimeStats.wins > 0 && (
            <StatCard label="Seasons won" value={String(allTimeStats.wins)} highlight />
          )}
        </div>
      )}

      {/* Season record */}
      {seasonRecords.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">Season record</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-spal-muted border-b border-white/10">
                <th className="pb-2 pr-6 font-normal">Season</th>
                <th className="pb-2 pr-4 font-normal text-right tabular-nums">Position</th>
                <th className="pb-2 pr-4 font-normal text-right tabular-nums">Points</th>
                <th className="pb-2 font-normal text-right tabular-nums hidden sm:table-cell">Rounds</th>
              </tr>
            </thead>
            <tbody>
              {seasonRecords.map(rec => (
                <tr key={rec.season_id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-2 pr-6 text-spal-text font-medium">
                    <Link to={`/history/${rec.year}`} className="hover:text-spal-cerulean transition-colors">
                      {rec.year}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    <span className={rec.position === 1 ? 'text-spal-yellow font-semibold' : 'text-spal-text'}>
                      {ordinal(rec.position)}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-spal-text">{rec.total_points.toFixed(1)}</td>
                  <td className="py-2 text-right tabular-nums text-spal-muted hidden sm:table-cell">{rec.rounds_played}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Draft history */}
      {picksBySeason.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-4">Draft history</h2>
          <div className="space-y-8">
            {picksBySeason.map(group => (
              <div key={group.year}>
                <p className="text-sm font-semibold text-spal-text mb-2">
                  <Link to={`/history/${group.year}`} className="hover:text-spal-cerulean transition-colors">
                    {group.year} season
                  </Link>
                </p>
                <div className="space-y-0.5">
                  {group.picks.map(pick => (
                    <div key={pick.pick_number} className="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0">
                      <span className="text-xs text-spal-muted tabular-nums w-6 shrink-0">#{pick.pick_number}</span>
                      <span className="text-xs text-spal-muted shrink-0 w-24 truncate">{fmtSlot(pick.draft_slot)}</span>
                      <span className="text-sm text-spal-text flex-1">{pick.display_name}</span>
                      <span className="text-xs text-spal-muted shrink-0 hidden sm:inline">{pick.canonical_position}</span>
                      <NationBadge nation={pick.nation} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function StatCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-spal-surface border border-white/5 rounded-lg p-4">
      <p className="text-xs text-spal-muted uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${highlight ? 'text-spal-yellow' : 'text-spal-text'}`}>{value}</p>
    </div>
  )
}
