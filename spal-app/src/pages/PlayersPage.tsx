import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import NationBadge from '../components/NationBadge'
import { EmptyState } from '../components/EmptyState'

interface Season { id: number; year: number }
interface Player {
  id: number
  display_name: string
  nation: string
  canonical_position: string
  position_group: string
}

interface PlayerStats {
  totalPts: number | null    // null = no score entries
  value: number | null       // pts per star; null if no scores or no price
  form: number | null        // avg over last 3 rounds; null if no scored rounds
  ownership: number | null   // 0–1 fraction; null if not loaded
  ownerCount: number         // raw count for tooltip
}

const NATIONS = ['England', 'Ireland', 'Scotland', 'Wales', 'France', 'Italy']
const DRAFT_POSITION_GROUPS = ['Front Row', 'Back Row', 'Outside Back', 'Other']
const CANONICAL_POSITIONS = ['Prop', 'Hooker', 'Second Row', 'Flanker', 'Number 8', 'Scrum-half', 'Fly-half', 'Centre', 'Wing', 'Fullback']

type SortKey = 'pts' | 'value'

export default function PlayersPage() {
  const { user } = useAuth()

  const [seasons, setSeasons]     = useState<Season[]>([])
  const [seasonId, setSeasonId]   = useState<number | null>(null)
  const [players, setPlayers]     = useState<Player[]>([])
  const [draftedBy, setDraftedBy] = useState<Map<number, string>>(new Map())
  const [scoreMap, setScoreMap]   = useState<Map<number, { total: number; byRound: Record<number, number> }>>(new Map())
  const [priceMap, setPriceMap]   = useState<Map<number, number>>(new Map())
  const [ownership, setOwnership] = useState<{ counts: Map<number, number>; total: number; round: number | null } | null>(null)
  const [loading, setLoading]     = useState(false)

  const [searchQuery, setSearchQuery]   = useState('')
  const [nationFilter, setNationFilter] = useState('')
  const [draftPosFilter, setDraftPosFilter] = useState('')
  const [canonPosFilter, setCanonPosFilter] = useState('')
  const [sortBy, setSortBy]   = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

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

  // Main data load: players, draft picks, scores, base prices
  useEffect(() => {
    if (seasonId == null) return
    setLoading(true)
    Promise.all([
      supabase
        .from('players')
        .select('id, display_name, nation, canonical_position, position_group')
        .eq('season_id', seasonId)
        .order('display_name'),
      supabase
        .from('draft_picks')
        .select('player_id, profiles!profile_id(display_name)')
        .eq('season_id', seasonId),
      supabase
        .from('player_match_scores')
        .select('player_id, final_points, matches!match_id(round_number)')
        .eq('season_id', seasonId),
      supabase
        .from('player_prices')
        .select('player_id, final_price')
        .eq('season_id', seasonId)
        .is('round_number', null),
    ]).then(([playersRes, picksRes, scoresRes, pricesRes]) => {
      setPlayers(playersRes.data ?? [])

      const draftMap = new Map<number, string>()
      for (const pick of (picksRes.data ?? []) as unknown as Array<{
        player_id: number; profiles: { display_name: string } | null
      }>) {
        if (pick.profiles?.display_name) draftMap.set(pick.player_id, pick.profiles.display_name)
      }
      setDraftedBy(draftMap)

      const sMap = new Map<number, { total: number; byRound: Record<number, number> }>()
      for (const row of (scoresRes.data ?? []) as unknown as Array<{
        player_id: number; final_points: number | null
        matches: { round_number: number } | null
      }>) {
        const rn = row.matches?.round_number
        if (rn == null) continue
        const pts = row.final_points ?? 0
        const entry = sMap.get(row.player_id) ?? { total: 0, byRound: {} }
        entry.total += pts
        entry.byRound[rn] = (entry.byRound[rn] ?? 0) + pts
        sMap.set(row.player_id, entry)
      }
      setScoreMap(sMap)

      const pMap = new Map<number, number>()
      for (const row of (pricesRes.data ?? []) as Array<{ player_id: number; final_price: number }>) {
        pMap.set(row.player_id, row.final_price)
      }
      setPriceMap(pMap)

      setLoading(false)
    })
  }, [seasonId])

  // Ownership: authenticated-only (manager_round_squads has authenticated-only RLS)
  useEffect(() => {
    if (seasonId == null || !user) { setOwnership(null); return }

    supabase
      .from('manager_round_squads')
      .select('id, round_number')
      .eq('season_id', seasonId)
      .then(async ({ data: squads }) => {
        if (!squads || squads.length === 0) {
          setOwnership({ counts: new Map(), total: 0, round: null })
          return
        }
        const maxRound = Math.max(...squads.map(s => s.round_number as number))
        const latest = squads.filter(s => (s.round_number as number) === maxRound)
        const ids = latest.map(s => s.id as number)

        const { data: playerRows } = await supabase
          .from('manager_round_squad_players')
          .select('player_id')
          .in('squad_id', ids)

        const counts = new Map<number, number>()
        for (const r of playerRows ?? []) {
          const pid = r.player_id as number
          counts.set(pid, (counts.get(pid) ?? 0) + 1)
        }
        setOwnership({ counts, total: latest.length, round: maxRound })
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId, user])

  // Compute per-player stats from raw maps
  const statsMap = useMemo(() => {
    const map = new Map<number, PlayerStats>()
    for (const p of players) {
      const scores = scoreMap.get(p.id)
      const price  = priceMap.get(p.id) ?? null
      const totalPts = scores != null ? scores.total : null

      const value =
        totalPts != null && price != null && price > 0
          ? totalPts / price
          : null

      let form: number | null = null
      if (scores && Object.keys(scores.byRound).length > 0) {
        const rounds = Object.entries(scores.byRound)
          .map(([r, pts]) => ({ round: Number(r), pts }))
          .sort((a, b) => b.round - a.round)
          .slice(0, 3)
        form = rounds.reduce((sum, r) => sum + r.pts, 0) / rounds.length
      }

      let ownerFraction: number | null = null
      const ownerCount = ownership?.counts.get(p.id) ?? 0
      if (ownership != null) {
        ownerFraction = ownership.total > 0 ? ownerCount / ownership.total : 0
      }

      map.set(p.id, { totalPts, value, form, ownership: ownerFraction, ownerCount })
    }
    return map
  }, [players, scoreMap, priceMap, ownership])

  // Max scored round → "Stats current to Round N"
  const statsRound = useMemo(() => {
    let max: number | null = null
    for (const { byRound } of scoreMap.values()) {
      for (const r of Object.keys(byRound).map(Number)) {
        if (max == null || r > max) max = r
      }
    }
    return max
  }, [scoreMap])

  function handleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy(key)
      setSortDir('desc')
    }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortBy !== k) return <span className="text-white/20 ml-1">↕</span>
    return <span className="text-spal-cerulean ml-1">{sortDir === 'desc' ? '↓' : '↑'}</span>
  }

  const visible = useMemo(() => players.filter(p => {
    const q = searchQuery.trim().toLowerCase()
    return (
      (!q || p.display_name.toLowerCase().includes(q)) &&
      (!nationFilter || p.nation === nationFilter) &&
      (!draftPosFilter || p.position_group === draftPosFilter) &&
      (!canonPosFilter || p.canonical_position === canonPosFilter)
    )
  }), [players, searchQuery, nationFilter, draftPosFilter, canonPosFilter])

  const sorted = useMemo(() => {
    if (!sortBy) return visible
    return [...visible].sort((a, b) => {
      const as_ = statsMap.get(a.id)
      const bs_ = statsMap.get(b.id)
      const av = sortBy === 'pts' ? (as_?.totalPts ?? null) : (as_?.value ?? null)
      const bv = sortBy === 'pts' ? (bs_?.totalPts ?? null) : (bs_?.value ?? null)
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [visible, sortBy, sortDir, statsMap])

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-spal-yellow">Players</h1>
        {statsRound != null && (
          <span className="text-xs text-spal-muted">Stats current to Round {statsRound}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <label className="text-sm text-spal-muted">Season</label>
        <select
          value={seasonId ?? ''}
          onChange={e => setSeasonId(Number(e.target.value))}
          className={selectClass}
        >
          {seasons.map(s => <option key={s.id} value={s.id}>{s.year}</option>)}
        </select>

        <span className="text-white/20">|</span>

        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search players..."
          className={`${selectClass} w-44`}
        />

        <select
          value={nationFilter}
          onChange={e => setNationFilter(e.target.value)}
          className={selectClass}
        >
          <option value="">All nations</option>
          {NATIONS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>

        <select
          value={draftPosFilter}
          onChange={e => setDraftPosFilter(e.target.value)}
          className={selectClass}
        >
          <option value="">All draft positions</option>
          {DRAFT_POSITION_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>

        <select
          value={canonPosFilter}
          onChange={e => setCanonPosFilter(e.target.value)}
          className={selectClass}
        >
          <option value="">All positions</option>
          {CANONICAL_POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        {(searchQuery || nationFilter || draftPosFilter || canonPosFilter) && (
          <button
            onClick={() => { setSearchQuery(''); setNationFilter(''); setDraftPosFilter(''); setCanonPosFilter('') }}
            className="text-xs text-spal-muted hover:text-spal-text transition-colors underline"
          >
            Clear
          </button>
        )}

        <span className="text-xs text-spal-muted ml-auto">{sorted.length} players</span>
      </div>

      {loading ? (
        <p className="text-spal-muted text-sm">Loading…</p>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35M8 11h6M11 8v6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
          title="No players found"
          body="Try adjusting your filters"
        />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-spal-muted border-b border-white/10">
              <th className="pb-2 pr-4 font-normal">Player</th>
              <th className="pb-2 pr-4 font-normal">Nation</th>
              <th className="pb-2 pr-4 font-normal hidden md:table-cell">Position</th>
              <th
                className="pb-2 pr-4 font-normal hidden md:table-cell cursor-pointer select-none whitespace-nowrap"
                onClick={() => handleSort('pts')}
              >
                Pts <SortIcon k="pts" />
              </th>
              <th
                className="pb-2 pr-4 font-normal hidden md:table-cell cursor-pointer select-none whitespace-nowrap"
                onClick={() => handleSort('value')}
              >
                Value <SortIcon k="value" />
              </th>
              <th className="pb-2 pr-4 font-normal hidden md:table-cell">Form</th>
              {user && (
                <th className="pb-2 pr-4 font-normal hidden md:table-cell whitespace-nowrap">
                  Ownership
                  {ownership?.round != null && (
                    <span className="text-white/30 font-normal ml-1">(R{ownership.round})</span>
                  )}
                </th>
              )}
              <th className="pb-2 font-normal">Draft status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => {
              const stats   = statsMap.get(p.id) ?? { totalPts: null, value: null, form: null, ownership: null, ownerCount: 0 }
              const manager = draftedBy.get(p.id)
              return (
                <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-2 pr-4 text-spal-text font-medium">{p.display_name}</td>
                  <td className="py-2 pr-4"><NationBadge nation={p.nation} /></td>
                  <td className="py-2 pr-4 text-spal-muted hidden md:table-cell">{p.canonical_position}</td>
                  <td className="py-2 pr-4 tabular-nums hidden md:table-cell text-spal-text">
                    {stats.totalPts != null ? stats.totalPts : '—'}
                  </td>
                  <td className="py-2 pr-4 tabular-nums hidden md:table-cell text-spal-text">
                    {stats.value != null ? `${stats.value.toFixed(1)}pts/★` : '—'}
                  </td>
                  <td className="py-2 pr-4 tabular-nums hidden md:table-cell text-spal-text">
                    {stats.form != null ? stats.form.toFixed(1) : '—'}
                  </td>
                  {user && (
                    <td className="py-2 pr-4 tabular-nums hidden md:table-cell text-spal-text">
                      {stats.ownership != null ? (
                        <span title={`${stats.ownerCount} / ${ownership?.total ?? 0} managers`}>
                          {Math.round(stats.ownership * 100)}%
                        </span>
                      ) : '—'}
                    </td>
                  )}
                  <td className="py-2">
                    {manager
                      ? <span className="text-spal-cerulean">{manager}</span>
                      : <span className="text-spal-muted text-xs">Available</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

const selectClass =
  'bg-spal-surface border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
