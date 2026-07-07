import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NationBadge from '../components/NationBadge'
import { EmptyState } from '../components/EmptyState'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorCard from '../components/ErrorCard'

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
  position: number
  predo_points: number | null
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

interface H2HRecord {
  opponent_id: string
  opponent_name: string
  wins: number
  draws: number
  losses: number
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

  const [profile, setProfile]               = useState<Profile | null>(null)
  useEffect(() => { document.title = profile ? `${profile.display_name} — SPAL` : 'Manager — SPAL' }, [profile])
  const [seasonRecords, setSeasonRecords]   = useState<SeasonRecord[]>([])
  const [draftedPlayers, setDraftedPlayers] = useState<DraftedPlayer[]>([])
  const [h2hRecords, setH2hRecords]         = useState<H2HRecord[]>([])
  const [bestRoundScore, setBestRoundScore] = useState<number | null>(null)
  const [loading, setLoading]               = useState(true)
  const [notFound, setNotFound]             = useState(false)
  const [error, setError]                   = useState(false)
  const [retryKey, setRetryKey]             = useState(0)

  useEffect(() => {
    if (!profileId) return

    async function load() {
      setError(false)

      // 1. Profile
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, display_name, team_name')
        .eq('id', profileId)
        .maybeSingle()

      if (profileError) { setError(true); setLoading(false); return }
      if (!profileData) { setNotFound(true); setLoading(false); return }
      setProfile(profileData as Profile)

      // 2. Parallel: standings, draft picks, match scores, H2H group membership, predo scores
      const [standingsRes, picksRes, matchScoresRes, myGroupsRes, predoScoresRes] = await Promise.all([
        supabase
          .from('season_standings')
          .select('season_id, total_points, rounds_played, seasons!season_id(year)')
          .eq('profile_id', profileId),

        supabase
          .from('draft_picks')
          .select('season_id, pick_number, draft_slot, players!player_id(display_name, nation, canonical_position), seasons!season_id(year)')
          .eq('profile_id', profileId)
          .order('season_id', { ascending: false })
          .order('pick_number'),

        supabase
          .from('manager_match_scores')
          .select('final_points, season_id, matches!match_id(round_number)')
          .eq('profile_id', profileId),

        supabase
          .from('fixture_group_members')
          .select('fixture_group_id, group_place')
          .eq('profile_id', profileId),

        supabase
          .from('predo_scores')
          .select('season_id, total_points')
          .eq('profile_id', profileId),
      ])

      if (standingsRes.error || picksRes.error) { setError(true); setLoading(false); return }

      // Process match scores → best single round score
      type RawMatchScore = { final_points: number; season_id: number; matches: { round_number: number } | null }
      const matchScores = (matchScoresRes.data ?? []) as unknown as RawMatchScore[]
      const roundTotals = new Map<string, number>()
      for (const s of matchScores) {
        const rn = s.matches?.round_number
        if (rn == null) continue
        const key = `${s.season_id}-${rn}`
        roundTotals.set(key, (roundTotals.get(key) ?? 0) + s.final_points)
      }
      const maxRound = roundTotals.size > 0 ? Math.max(...Array.from(roundTotals.values())) : null
      setBestRoundScore(maxRound)

      // Process predo scores → per-season totals
      type RawPredoScore = { season_id: number; total_points: string | number }
      const predoScores = (predoScoresRes.data ?? []) as unknown as RawPredoScore[]
      const predoMap = new Map<number, number>()
      for (const ps of predoScores) {
        predoMap.set(ps.season_id, (predoMap.get(ps.season_id) ?? 0) + Number(ps.total_points))
      }

      // Build my fixture_group_id → my group_place map
      type RawMyGroup = { fixture_group_id: number; group_place: number }
      const myGroups = (myGroupsRes.data ?? []) as unknown as RawMyGroup[]
      const myGroupMap = new Map<number, number>()
      for (const g of myGroups) myGroupMap.set(g.fixture_group_id, g.group_place)
      const myGroupIds = Array.from(myGroupMap.keys())

      // 3. Parallel: all standings in my seasons + opponents in my fixture groups
      type RawStanding = {
        season_id: number; total_points: number; rounds_played: number
        seasons: { year: number } | null
      }
      const myStandings = (standingsRes.data ?? []) as unknown as RawStanding[]
      const seasonIds = myStandings.map(s => s.season_id)

      const [allStandingsRes, oppMembersRes] = await Promise.all([
        seasonIds.length > 0
          ? supabase
              .from('season_standings')
              .select('season_id, profile_id, total_points')
              .in('season_id', seasonIds)
          : Promise.resolve({ data: [], error: null }),

        myGroupIds.length > 0
          ? supabase
              .from('fixture_group_members')
              .select('fixture_group_id, profile_id, group_place, profiles!profile_id(display_name)')
              .in('fixture_group_id', myGroupIds)
              .neq('profile_id', profileId)
          : Promise.resolve({ data: [], error: null }),
      ])

      // Compute ranks in each season
      type RawAllStanding = { season_id: number; profile_id: string; total_points: number }
      const allStandings = (allStandingsRes.data ?? []) as unknown as RawAllStanding[]
      const rankMap = new Map<number, number>()
      for (const sid of seasonIds) {
        const inSeason = allStandings
          .filter(s => s.season_id === sid)
          .sort((a, b) => b.total_points - a.total_points)
        const pos = inSeason.findIndex(s => s.profile_id === profileId) + 1
        rankMap.set(sid, pos > 0 ? pos : 99)
      }

      setSeasonRecords(
        myStandings
          .map(s => ({
            season_id:     s.season_id,
            year:          s.seasons?.year ?? 0,
            total_points:  Number(s.total_points),
            rounds_played: s.rounds_played,
            position:      rankMap.get(s.season_id) ?? 99,
            predo_points:  predoMap.has(s.season_id) ? (predoMap.get(s.season_id) ?? null) : null,
          }))
          .sort((a, b) => b.year - a.year)
      )

      // Compute H2H record vs each opponent
      type RawOpp = { fixture_group_id: number; profile_id: string; group_place: number; profiles: { display_name: string } | null }
      const opponents = (oppMembersRes.data ?? []) as unknown as RawOpp[]
      const h2hMap = new Map<string, { name: string; w: number; d: number; l: number }>()
      for (const opp of opponents) {
        const myPlace = myGroupMap.get(opp.fixture_group_id)
        if (myPlace == null) continue
        if (!h2hMap.has(opp.profile_id)) {
          h2hMap.set(opp.profile_id, { name: opp.profiles?.display_name ?? 'Unknown', w: 0, d: 0, l: 0 })
        }
        const rec = h2hMap.get(opp.profile_id)!
        if (myPlace < opp.group_place)      rec.w++
        else if (myPlace === opp.group_place) rec.d++
        else                                  rec.l++
      }
      setH2hRecords(
        Array.from(h2hMap.entries())
          .map(([id, r]) => ({ opponent_id: id, opponent_name: r.name, wins: r.w, draws: r.d, losses: r.l }))
          .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
      )

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
  }, [profileId, retryKey])

  // All-time summary stats
  const allTimeStats = useMemo(() => {
    if (seasonRecords.length === 0) return null
    const total   = seasonRecords.reduce((sum, r) => sum + r.total_points, 0)
    const avg     = total / seasonRecords.length
    const best    = Math.min(...seasonRecords.map(r => r.position))
    const wins    = seasonRecords.filter(r => r.position === 1).length
    return { total, avg, best, wins, seasons: seasonRecords.length }
  }, [seasonRecords])

  // Draft picks grouped by season
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

  // Most drafted canonical player (needs > 1 draft to be interesting)
  const mostDraftedPlayer = useMemo(() => {
    const counts = new Map<string, { name: string; nation: string; count: number }>()
    for (const p of draftedPlayers) {
      const key = `${p.display_name}|${p.nation}`
      if (!counts.has(key)) counts.set(key, { name: p.display_name, nation: p.nation, count: 0 })
      counts.get(key)!.count++
    }
    let best: { name: string; nation: string; count: number } | null = null
    for (const v of counts.values()) {
      if (!best || v.count > best.count) best = v
    }
    return best && best.count > 1 ? best : null
  }, [draftedPlayers])

  // Favourite nation (most drafted)
  const favouriteNation = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of draftedPlayers) {
      counts.set(p.nation, (counts.get(p.nation) ?? 0) + 1)
    }
    let best: { nation: string; count: number } | null = null
    for (const [nation, count] of counts) {
      if (!best || count > best.count) best = { nation, count }
    }
    return best
  }, [draftedPlayers])

  const hasPredoData = seasonRecords.some(r => r.predo_points != null)

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorCard onRetry={() => setRetryKey(k => k + 1)} />

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

      {/* No history state */}
      {seasonRecords.length === 0 && (
        <div className="bg-spal-surface border border-white/5 rounded-lg px-6 py-8 text-center">
          <p className="text-spal-muted text-sm">No season history on record.</p>
          <p className="text-spal-muted text-xs mt-1">
            This manager hasn't appeared in any recorded seasons yet.
          </p>
        </div>
      )}

      {/* All-time summary */}
      {allTimeStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Seasons" value={String(allTimeStats.seasons)} />
          <StatCard label="Total points" value={allTimeStats.total.toFixed(1)} />
          <StatCard label="Avg / season" value={allTimeStats.avg.toFixed(1)} />
          <StatCard label="Best finish" value={ordinal(allTimeStats.best)} highlight={allTimeStats.best === 1} />
          {bestRoundScore != null && (
            <StatCard label="Best round" value={bestRoundScore.toFixed(1)} />
          )}
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
                <th className="pb-2 pr-4 font-normal text-right tabular-nums">Pos</th>
                <th className="pb-2 pr-4 font-normal text-right tabular-nums">Pts</th>
                {hasPredoData && (
                  <th className="pb-2 pr-4 font-normal text-right tabular-nums">Predo pts</th>
                )}
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
                  {hasPredoData && (
                    <td className="py-2 pr-4 text-right tabular-nums text-spal-muted">
                      {rec.predo_points != null ? rec.predo_points.toFixed(1) : '—'}
                    </td>
                  )}
                  <td className="py-2 text-right tabular-nums text-spal-muted hidden sm:table-cell">{rec.rounds_played}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* H2H record */}
      {h2hRecords.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">H2H record</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-spal-muted border-b border-white/10">
                <th className="pb-2 pr-6 font-normal">Opponent</th>
                <th className="pb-2 pr-3 font-normal text-right tabular-nums">W</th>
                <th className="pb-2 pr-3 font-normal text-right tabular-nums">D</th>
                <th className="pb-2 font-normal text-right tabular-nums">L</th>
              </tr>
            </thead>
            <tbody>
              {h2hRecords.map(rec => {
                const total = rec.wins + rec.draws + rec.losses
                const winPct = total > 0 ? rec.wins / total : 0
                return (
                  <tr key={rec.opponent_id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="py-2 pr-6 text-spal-text font-medium">
                      <Link to={`/manager/${rec.opponent_id}`} className="hover:text-spal-cerulean transition-colors">
                        {rec.opponent_name}
                      </Link>
                    </td>
                    <td className={`py-2 pr-3 text-right tabular-nums font-medium ${winPct > 0.5 ? 'text-spal-cerulean' : 'text-spal-text'}`}>
                      {rec.wins}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-spal-muted">{rec.draws}</td>
                    <td className={`py-2 text-right tabular-nums font-medium ${winPct < 0.5 ? 'text-red-400' : 'text-spal-text'}`}>
                      {rec.losses}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* Draft tendencies */}
      {(mostDraftedPlayer != null || favouriteNation != null) && (
        <section>
          <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">Draft tendencies</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {favouriteNation && (
              <div className="bg-spal-surface border border-white/5 rounded-lg p-4">
                <p className="text-xs text-spal-muted uppercase tracking-wider mb-2">Favourite nation</p>
                <div className="flex items-center gap-2">
                  <NationBadge nation={favouriteNation.nation} />
                  <span className="text-sm text-spal-text font-medium">{favouriteNation.nation}</span>
                </div>
              </div>
            )}
            {mostDraftedPlayer && (
              <div className="bg-spal-surface border border-white/5 rounded-lg p-4 sm:col-span-2">
                <p className="text-xs text-spal-muted uppercase tracking-wider mb-2">Most drafted player</p>
                <div className="flex items-center gap-2">
                  <NationBadge nation={mostDraftedPlayer.nation} />
                  <span className="text-sm text-spal-text font-medium">{mostDraftedPlayer.name}</span>
                  <span className="text-xs text-spal-muted">×{mostDraftedPlayer.count}</span>
                </div>
              </div>
            )}
          </div>
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
