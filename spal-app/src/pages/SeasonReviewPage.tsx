import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NationBadge from '../components/NationBadge'
import { EmptyState } from '../components/EmptyState'

// ── Types ─────────────────────────────────────────────────────────────────────

interface StandingRow {
  profile_id: string
  display_name: string
  total_points: number
  rounds_played: number
}

interface DraftPick {
  pick_number: number
  draft_slot: string
  profile_id: string
  manager_name: string
  player_display_name: string
  player_position: string
  player_nation: string
}

interface PlayerScore {
  player_id: number
  display_name: string
  nation: string
  canonical_position: string
  total_points: number
}

// manager_match_scores row joined to matches for round_number
interface MatchScoreRow {
  profile_id: string
  final_points: number
  round_number: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">
      {title}
    </h2>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SeasonReviewPage() {
  const { year } = useParams<{ year: string }>()

  const [standings, setStandings]           = useState<StandingRow[]>([])
  const [draftPicks, setDraftPicks]         = useState<DraftPick[]>([])
  const [topPlayers, setTopPlayers]         = useState<PlayerScore[]>([])
  const [matchScores, setMatchScores]       = useState<MatchScoreRow[]>([])
  const [priceMap, setPriceMap]             = useState<Map<number, number>>(new Map())
  const [loading, setLoading]               = useState(true)
  const [notFound, setNotFound]             = useState(false)
  const [seasonYear, setSeasonYear]         = useState<number | null>(null)

  useEffect(() => {
    if (!year) return
    const yearNum = Number(year)
    if (isNaN(yearNum)) { setNotFound(true); setLoading(false); return }

    async function load() {
      // 1. Resolve season
      const { data: seasonRow } = await supabase
        .from('seasons')
        .select('id, year')
        .eq('year', yearNum)
        .in('status', ['historical', 'complete'])
        .maybeSingle()

      if (!seasonRow) { setNotFound(true); setLoading(false); return }
      const seasonId: number = seasonRow.id
      setSeasonYear(seasonRow.year)

      // 2. All queries in parallel
      const [standingsRes, picksRes, scoresRes, matchScoresRes, pricesRes] = await Promise.all([
        supabase
          .from('season_standings')
          .select('profile_id, total_points, rounds_played, profiles!profile_id(display_name)')
          .eq('season_id', seasonId)
          .order('total_points', { ascending: false }),

        supabase
          .from('draft_picks')
          .select('pick_number, draft_slot, profile_id, profiles!profile_id(display_name), players!player_id(display_name, canonical_position, nation)')
          .eq('season_id', seasonId)
          .order('pick_number'),

        supabase
          .from('player_match_scores')
          .select('player_id, final_points, players!player_id(display_name, nation, canonical_position)')
          .eq('season_id', seasonId),

        supabase
          .from('manager_match_scores')
          .select('profile_id, final_points, matches!match_id(round_number)')
          .eq('season_id', seasonId),

        supabase
          .from('player_prices')
          .select('player_id, final_price')
          .eq('season_id', seasonId)
          .is('round_number', null),
      ])

      // Standings
      type RawStanding = { profile_id: string; total_points: number; rounds_played: number; profiles: { display_name: string } | null }
      setStandings(
        ((standingsRes.data ?? []) as unknown as RawStanding[]).map(s => ({
          profile_id:    s.profile_id,
          display_name:  s.profiles?.display_name ?? 'Unknown',
          total_points:  s.total_points,
          rounds_played: s.rounds_played,
        }))
      )

      // Draft picks
      type RawPick = {
        pick_number: number; draft_slot: string; profile_id: string
        profiles: { display_name: string } | null
        players: { display_name: string; canonical_position: string; nation: string } | null
      }
      setDraftPicks(
        ((picksRes.data ?? []) as unknown as RawPick[]).map(p => ({
          pick_number:         p.pick_number,
          draft_slot:          p.draft_slot,
          profile_id:          p.profile_id,
          manager_name:        p.profiles?.display_name ?? 'Unknown',
          player_display_name: p.players?.display_name ?? 'Unknown',
          player_position:     p.players?.canonical_position ?? '',
          player_nation:       p.players?.nation ?? '',
        }))
      )

      // Player scores — aggregate per player, keep top 10
      type RawScore = {
        player_id: number; final_points: number | null
        players: { display_name: string; nation: string; canonical_position: string } | null
      }
      const playerTotals = new Map<number, { display_name: string; nation: string; canonical_position: string; total: number }>()
      for (const row of (scoresRes.data ?? []) as unknown as RawScore[]) {
        if (!row.players) continue
        const existing = playerTotals.get(row.player_id) ?? { ...row.players, total: 0 }
        existing.total += row.final_points ?? 0
        playerTotals.set(row.player_id, existing)
      }
      const top10 = Array.from(playerTotals.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 10)
        .map(([player_id, v]) => ({ player_id, display_name: v.display_name, nation: v.nation, canonical_position: v.canonical_position, total_points: v.total }))
      setTopPlayers(top10)

      // Manager match scores — flatten to { profile_id, final_points, round_number }
      type RawMMS = { profile_id: string; final_points: number | null; matches: { round_number: number } | null }
      const mmsRows: MatchScoreRow[] = []
      for (const row of (matchScoresRes.data ?? []) as unknown as RawMMS[]) {
        if (!row.matches) continue
        mmsRows.push({ profile_id: row.profile_id, final_points: row.final_points ?? 0, round_number: row.matches.round_number })
      }
      setMatchScores(mmsRows)

      // Prices
      const pMap = new Map<number, number>()
      for (const row of (pricesRes.data ?? []) as Array<{ player_id: number; final_price: number }>) {
        pMap.set(row.player_id, row.final_price)
      }
      setPriceMap(pMap)

      setLoading(false)
    }

    load()
  }, [year])

  // ── Derived: per-manager round-by-round totals ────────────────────────────

  const { rounds, managerRoundTotals } = useMemo(() => {
    // Group: manager → round → total points across all matches that round
    const mgRound = new Map<string, Map<number, number>>()
    const roundSet = new Set<number>()

    for (const row of matchScores) {
      roundSet.add(row.round_number)
      const mg = mgRound.get(row.profile_id) ?? new Map<number, number>()
      mg.set(row.round_number, (mg.get(row.round_number) ?? 0) + row.final_points)
      mgRound.set(row.profile_id, mg)
    }

    const rounds = [...roundSet].sort((a, b) => a - b)
    return { rounds, managerRoundTotals: mgRound }
  }, [matchScores])

  // ── Derived: summary stats ────────────────────────────────────────────────

  const summaryStats = useMemo(() => {
    if (standings.length === 0) return null

    // Highest single-round score (any manager)
    let highRoundScore = 0
    let highRoundManager = ''
    let highRoundNum = 0
    for (const [profileId, roundMap] of managerRoundTotals.entries()) {
      const name = standings.find(s => s.profile_id === profileId)?.display_name ?? 'Unknown'
      for (const [rn, pts] of roundMap.entries()) {
        if (pts > highRoundScore) { highRoundScore = pts; highRoundManager = name; highRoundNum = rn }
      }
    }

    // Most consistent: lowest variance in round scores
    let lowestVariance = Infinity
    let mostConsistentManager = ''
    for (const [profileId, roundMap] of managerRoundTotals.entries()) {
      const name = standings.find(s => s.profile_id === profileId)?.display_name ?? 'Unknown'
      const vals = [...roundMap.values()]
      if (vals.length < 2) continue
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length
      const variance = vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / vals.length
      if (variance < lowestVariance) { lowestVariance = variance; mostConsistentManager = name }
    }

    // Best value player: pts / price — from topPlayers (already have all season scores aggregated)
    const allPlayerTotals = topPlayers  // already computed
    let bestValueName = ''
    let bestValueRatio = 0
    let bestValuePts = 0
    let bestValuePrice = 0
    for (const p of allPlayerTotals) {
      const price = priceMap.get(p.player_id)
      if (!price || price === 0) continue
      const ratio = p.total_points / price
      if (ratio > bestValueRatio) {
        bestValueRatio = ratio
        bestValueName  = p.display_name
        bestValuePts   = p.total_points
        bestValuePrice = price
      }
    }

    return {
      highRoundScore: highRoundScore > 0 ? { score: highRoundScore, manager: highRoundManager, round: highRoundNum } : null,
      mostConsistent: mostConsistentManager || null,
      bestValue: bestValueName ? { name: bestValueName, pts: bestValuePts, price: bestValuePrice, ratio: bestValueRatio } : null,
    }
  }, [standings, managerRoundTotals, topPlayers, priceMap])

  // ── Derived: draft board grouped by manager ───────────────────────────────

  const draftByManager = useMemo(() => {
    const order: string[] = []
    const byId = new Map<string, { name: string; picks: DraftPick[] }>()
    for (const pick of draftPicks) {
      if (!byId.has(pick.profile_id)) {
        order.push(pick.profile_id)
        byId.set(pick.profile_id, { name: pick.manager_name, picks: [] })
      }
      byId.get(pick.profile_id)!.picks.push(pick)
    }
    return order.map(id => ({ id, ...byId.get(id)! }))
  }, [draftPicks])

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <p className="text-spal-muted text-sm">Loading…</p>

  if (notFound) {
    return (
      <EmptyState
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
          </svg>
        }
        title="Season not found"
        body="This season either doesn't exist or isn't marked as complete yet."
      />
    )
  }

  return (
    <div className="space-y-12">
      {/* Page header */}
      <div>
        <Link to="/history" className="text-xs text-spal-muted hover:text-spal-text transition-colors">
          ← History
        </Link>
        <h1 className="text-2xl font-bold text-spal-yellow mt-2">{seasonYear} Season</h1>
      </div>

      {/* ── 1. Final standings ─────────────────────────────────────── */}
      <section>
        <SectionHeader title="Final standings" />
        {standings.length === 0 ? (
          <p className="text-spal-muted text-sm">No standings recorded.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-spal-muted border-b border-white/10">
                <th className="pb-2 pr-4 font-normal w-8">#</th>
                <th className="pb-2 pr-6 font-normal">Manager</th>
                <th className="pb-2 pr-4 font-normal text-right tabular-nums">Points</th>
                <th className="pb-2 font-normal text-right tabular-nums">Rounds</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row, i) => (
                <tr key={row.profile_id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-3 pr-4 text-spal-muted tabular-nums">{i + 1}</td>
                  <td className="py-3 pr-6 font-medium text-spal-text">
                    <Link to={`/manager/${row.profile_id}`} className="hover:text-spal-cerulean transition-colors">
                      {row.display_name}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-spal-text">{Number(row.total_points).toFixed(1)}</td>
                  <td className="py-3 text-right tabular-nums text-spal-muted">{row.rounds_played}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── 2. Round by round ──────────────────────────────────────── */}
      {rounds.length > 0 && (
        <section>
          <SectionHeader title="Round by round" />
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr className="text-left text-spal-muted border-b border-white/10">
                  <th className="pb-2 pr-6 font-normal whitespace-nowrap">Manager</th>
                  {rounds.map(r => (
                    <th key={r} className="pb-2 pr-4 font-normal text-right tabular-nums whitespace-nowrap">R{r}</th>
                  ))}
                  <th className="pb-2 font-normal text-right tabular-nums">Total</th>
                </tr>
              </thead>
              <tbody>
                {standings.map(row => {
                  const roundMap = managerRoundTotals.get(row.profile_id)
                  return (
                    <tr key={row.profile_id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="py-2 pr-6 text-spal-text font-medium whitespace-nowrap">
                        <Link to={`/manager/${row.profile_id}`} className="hover:text-spal-cerulean transition-colors">
                          {row.display_name}
                        </Link>
                      </td>
                      {rounds.map(r => (
                        <td key={r} className="py-2 pr-4 text-right tabular-nums text-spal-text">
                          {roundMap?.has(r) ? Number(roundMap.get(r)!).toFixed(1) : '—'}
                        </td>
                      ))}
                      <td className="py-2 text-right tabular-nums text-spal-cerulean font-medium">
                        {Number(row.total_points).toFixed(1)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── 3. Top 10 players ──────────────────────────────────────── */}
      {topPlayers.length > 0 && (
        <section>
          <SectionHeader title="Top 10 players" />
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-spal-muted border-b border-white/10">
                <th className="pb-2 pr-4 font-normal w-8">#</th>
                <th className="pb-2 pr-4 font-normal">Player</th>
                <th className="pb-2 pr-4 font-normal hidden sm:table-cell">Nation</th>
                <th className="pb-2 pr-4 font-normal hidden sm:table-cell">Position</th>
                <th className="pb-2 font-normal text-right tabular-nums">Points</th>
              </tr>
            </thead>
            <tbody>
              {topPlayers.map((p, i) => (
                <tr key={p.player_id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-2 pr-4 text-spal-muted tabular-nums">{i + 1}</td>
                  <td className="py-2 pr-4 text-spal-text font-medium">{p.display_name}</td>
                  <td className="py-2 pr-4 hidden sm:table-cell"><NationBadge nation={p.nation} /></td>
                  <td className="py-2 pr-4 text-spal-muted hidden sm:table-cell">{p.canonical_position}</td>
                  <td className="py-2 text-right tabular-nums text-spal-text">{Number(p.total_points).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── 4. Summary stats ───────────────────────────────────────── */}
      {summaryStats && (
        <section>
          <SectionHeader title="Season stats" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {summaryStats.highRoundScore && (
              <div className="bg-spal-surface border border-white/5 rounded-lg p-4">
                <p className="text-xs text-spal-muted uppercase tracking-wider mb-2">Highest round score</p>
                <p className="text-2xl font-bold text-spal-yellow tabular-nums">
                  {Number(summaryStats.highRoundScore.score).toFixed(1)}
                </p>
                <p className="text-sm text-spal-text mt-1">{summaryStats.highRoundScore.manager}</p>
                <p className="text-xs text-spal-muted">Round {summaryStats.highRoundScore.round}</p>
              </div>
            )}
            {summaryStats.mostConsistent && (
              <div className="bg-spal-surface border border-white/5 rounded-lg p-4">
                <p className="text-xs text-spal-muted uppercase tracking-wider mb-2">Most consistent</p>
                <p className="text-sm text-spal-text font-semibold mt-1">{summaryStats.mostConsistent}</p>
                <p className="text-xs text-spal-muted">Lowest variance in round scores</p>
              </div>
            )}
            {summaryStats.bestValue && (
              <div className="bg-spal-surface border border-white/5 rounded-lg p-4">
                <p className="text-xs text-spal-muted uppercase tracking-wider mb-2">Best value player</p>
                <p className="text-sm text-spal-text font-semibold mt-1">{summaryStats.bestValue.name}</p>
                <p className="text-spal-cerulean text-sm tabular-nums">
                  {Number(summaryStats.bestValue.ratio).toFixed(1)} pts/★
                </p>
                <p className="text-xs text-spal-muted">
                  {Number(summaryStats.bestValue.pts).toFixed(1)} pts · ★{summaryStats.bestValue.price}
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── 5. Draft board ─────────────────────────────────────────── */}
      {draftByManager.length > 0 && (
        <section>
          <SectionHeader title="Draft board" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {draftByManager.map(mg => (
              <div key={mg.id}>
                <p className="text-sm font-semibold text-spal-text mb-2">
                  <Link to={`/manager/${mg.id}`} className="hover:text-spal-cerulean transition-colors">
                    {mg.name}
                  </Link>
                </p>
                <div className="space-y-0.5">
                  {mg.picks.map(pick => (
                    <div key={pick.pick_number} className="flex items-center gap-2 py-1 border-b border-white/5 last:border-0">
                      <span className="text-xs text-spal-muted tabular-nums w-6 shrink-0">#{pick.pick_number}</span>
                      <span className="text-xs text-spal-muted shrink-0 w-20 truncate">{fmtSlot(pick.draft_slot)}</span>
                      <span className="text-sm text-spal-text flex-1 truncate">{pick.player_display_name}</span>
                      <NationBadge nation={pick.player_nation} />
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
