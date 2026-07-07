import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { EmptyState } from '../components/EmptyState'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorCard from '../components/ErrorCard'

interface Season { id: number; year: number }

interface StandingRow {
  profile_id: string
  display_name: string
  rounds_played: number
  total_points: number
  last_updated_round: number | null
}

interface DraftRow {
  managerId: string
  managerName: string
  firstPickNumber: number
}

type View = 'summary' | 'rounds'

export default function StandingsPage() {
  useEffect(() => { document.title = 'Standings — SPAL' }, [])
  const { user } = useAuth()
  const [seasons, setSeasons]           = useState<Season[]>([])
  const [seasonId, setSeasonId]         = useState<number | null>(null)
  const [standingRows, setStandingRows] = useState<StandingRow[]>([])
  const [draftRows, setDraftRows]       = useState<DraftRow[]>([])
  const [roundScores, setRoundScores]   = useState<Map<string, Map<number, number>>>(new Map())
  const [allRounds, setAllRounds]       = useState<number[]>([])
  const [view, setView]                 = useState<View>('summary')
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState(false)
  const [retryKey, setRetryKey]         = useState(0)

  useEffect(() => {
    supabase
      .from('seasons')
      .select('id, year, status')
      .order('year', { ascending: false })
      .then(({ data }) => {
        const list = (data ?? []) as (Season & { status: string })[]
        setSeasons(list)
        const preferred = list.find(s => s.status === 'active') ?? list[0]
        if (preferred) setSeasonId(preferred.id)
      })
  }, [])

  useEffect(() => {
    if (seasonId == null) return
    setLoading(true)
    setError(false)
    setStandingRows([])
    setDraftRows([])
    setRoundScores(new Map())
    setAllRounds([])

    async function load() {
      const [standingsRes, picksRes, scoreRes] = await Promise.all([
        supabase
          .from('season_standings')
          .select('profile_id, rounds_played, total_points, last_updated_round, profiles!profile_id(display_name)')
          .eq('season_id', seasonId!)
          .order('total_points', { ascending: false }),

        supabase
          .from('draft_picks')
          .select('profile_id, pick_number, profiles!profile_id(display_name)')
          .eq('season_id', seasonId!),

        supabase
          .from('manager_match_scores')
          .select('profile_id, final_points, matches!match_id(round_number)')
          .eq('season_id', seasonId!),
      ])

      if (standingsRes.error || picksRes.error || scoreRes.error) {
        setError(true)
        setLoading(false)
        return
      }

      type RawStanding = {
        profile_id: string
        rounds_played: number
        total_points: number
        last_updated_round: number | null
        profiles: { display_name: string } | null
      }
      const standings = (standingsRes.data ?? []) as unknown as RawStanding[]
      setStandingRows(standings.map(s => ({
        profile_id:         s.profile_id,
        display_name:       s.profiles?.display_name ?? 'Unknown',
        rounds_played:      s.rounds_played,
        total_points:       s.total_points,
        last_updated_round: s.last_updated_round,
      })))

      type RawPick = { profile_id: string; pick_number: number; profiles: { display_name: string } | null }
      const picks = (picksRes.data ?? []) as unknown as RawPick[]
      const byManager = new Map<string, { name: string; firstPick: number }>()
      for (const pick of picks) {
        const name = pick.profiles?.display_name ?? 'Unknown'
        const cur = byManager.get(pick.profile_id)
        if (!cur) byManager.set(pick.profile_id, { name, firstPick: pick.pick_number })
        else cur.firstPick = Math.min(cur.firstPick, pick.pick_number)
      }
      setDraftRows(
        Array.from(byManager.entries())
          .map(([id, { name, firstPick }]) => ({ managerId: id, managerName: name, firstPickNumber: firstPick }))
          .sort((a, b) => a.firstPickNumber - b.firstPickNumber)
      )

      type RawScore = { profile_id: string; final_points: number; matches: { round_number: number } | null }
      const scores = (scoreRes.data ?? []) as unknown as RawScore[]
      const roundMap = new Map<string, Map<number, number>>()
      const roundSet = new Set<number>()
      for (const s of scores) {
        const rn = s.matches?.round_number
        if (rn == null) continue
        roundSet.add(rn)
        if (!roundMap.has(s.profile_id)) roundMap.set(s.profile_id, new Map())
        const byRound = roundMap.get(s.profile_id)!
        byRound.set(rn, (byRound.get(rn) ?? 0) + s.final_points)
      }
      setRoundScores(roundMap)
      setAllRounds(Array.from(roundSet).sort((a, b) => a - b))

      setLoading(false)
    }

    load()
  }, [seasonId, retryKey])

  const lastRound = standingRows.reduce<number | null>((acc, r) => {
    if (r.last_updated_round == null) return acc
    return acc == null ? r.last_updated_round : Math.max(acc, r.last_updated_round)
  }, null)

  // Per-round maximum scores for gold highlight
  const maxByRound = new Map<number, number>()
  for (const rn of allRounds) {
    let max = -Infinity
    for (const byRound of roundScores.values()) {
      const v = byRound.get(rn)
      if (v != null && v > max) max = v
    }
    if (max > -Infinity) maxByRound.set(rn, max)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-spal-yellow mb-6">Standings</h1>

      <div className="flex items-center gap-4 mb-8 flex-wrap">
        <div className="flex items-center gap-3">
          <label className="text-sm text-spal-muted">Season</label>
          <select
            value={seasonId ?? ''}
            onChange={e => setSeasonId(Number(e.target.value))}
            className={selectClass}
          >
            {seasons.map(s => <option key={s.id} value={s.id}>{s.year}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => setView('summary')}
            className={`px-3 py-1 rounded text-sm transition-colors ${view === 'summary' ? 'bg-spal-cerulean/20 text-spal-cerulean' : 'text-spal-muted hover:text-spal-text'}`}
          >
            Summary
          </button>
          <button
            onClick={() => setView('rounds')}
            className={`px-3 py-1 rounded text-sm transition-colors ${view === 'rounds' ? 'bg-spal-cerulean/20 text-spal-cerulean' : 'text-spal-muted hover:text-spal-text'}`}
          >
            Round by Round
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorCard onRetry={() => setRetryKey(k => k + 1)} />
      ) : (
        <>
          {standingRows.length === 0 ? (
            <div className="mb-10">
              <EmptyState
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10">
                    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M6 9v11M18 9v11M6 4h12M3 20h18" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                }
                title="No scores yet"
                body="Scores will appear here after the first round is calculated"
              />
            </div>
          ) : view === 'summary' ? (
            <div className="mb-10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-spal-muted border-b border-white/10">
                    <th className="pb-2 pr-4 font-normal w-8">#</th>
                    <th className="pb-2 pr-6 font-normal">Manager</th>
                    <th className="pb-2 pr-4 font-normal text-right tabular-nums">Pts</th>
                    <th className="pb-2 font-normal text-right tabular-nums">Rounds</th>
                  </tr>
                </thead>
                <tbody>
                  {standingRows.map((row, i) => {
                    const isMe = user?.id === row.profile_id
                    return (
                      <tr
                        key={row.profile_id}
                        className={`border-b border-white/5 ${isMe ? 'bg-spal-cerulean/10' : ''}`}
                      >
                        <td className="py-3 pr-4 text-spal-muted tabular-nums">{i + 1}</td>
                        <td className={`py-3 pr-6 font-medium ${isMe ? 'text-spal-cerulean' : 'text-spal-text'}`}>
                          <Link to={`/manager/${row.profile_id}`} className="hover:text-spal-cerulean transition-colors">
                            {row.display_name}
                          </Link>
                          {isMe && <span className="ml-1 text-xs opacity-60">you</span>}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-spal-text">
                          {Number(row.total_points).toFixed(1)}
                        </td>
                        <td className="py-3 text-right tabular-nums text-spal-muted">
                          {row.rounds_played}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {lastRound != null && (
                <p className="text-xs text-spal-muted mt-3">Last updated: Round {lastRound}</p>
              )}
            </div>
          ) : (
            // Round-by-round view
            <div className="mb-10 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-spal-muted border-b border-white/10">
                    <th className="pb-2 pr-6 font-normal">Manager</th>
                    {allRounds.map(rn => (
                      <th key={rn} className="pb-2 pr-4 font-normal text-right tabular-nums">R{rn}</th>
                    ))}
                    <th className="pb-2 font-normal text-right tabular-nums">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {standingRows.map(row => {
                    const isMe = user?.id === row.profile_id
                    const byRound = roundScores.get(row.profile_id)
                    return (
                      <tr
                        key={row.profile_id}
                        className={`border-b border-white/5 ${isMe ? 'bg-spal-cerulean/10' : ''}`}
                      >
                        <td className={`py-3 pr-6 font-medium ${isMe ? 'text-spal-cerulean' : 'text-spal-text'}`}>
                          <Link to={`/manager/${row.profile_id}`} className="hover:text-spal-cerulean transition-colors">
                            {row.display_name}
                          </Link>
                          {isMe && <span className="ml-1 text-xs opacity-60">you</span>}
                        </td>
                        {allRounds.map(rn => {
                          const pts = byRound?.get(rn)
                          const isGold = pts != null && pts === maxByRound.get(rn)
                          return (
                            <td
                              key={rn}
                              className={`py-3 pr-4 text-right tabular-nums ${
                                isGold ? 'text-spal-yellow font-semibold' : 'text-spal-text'
                              }`}
                            >
                              {pts != null ? pts.toFixed(1) : <span className="text-spal-muted">—</span>}
                            </td>
                          )
                        })}
                        <td className="py-3 text-right tabular-nums text-spal-text font-medium">
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
            </div>
          )}

          {/* Draft order */}
          {draftRows.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">
                Draft order
              </h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-spal-muted border-b border-white/10">
                    <th className="pb-2 pr-4 font-normal w-8">#</th>
                    <th className="pb-2 font-normal">Manager</th>
                  </tr>
                </thead>
                <tbody>
                  {draftRows.map((row, i) => {
                    const isMe = user?.id === row.managerId
                    return (
                      <tr key={row.managerId} className={`border-b border-white/5 ${isMe ? 'bg-spal-cerulean/10' : ''}`}>
                        <td className="py-2 pr-4 text-spal-muted tabular-nums">{i + 1}</td>
                        <td className={`py-2 font-medium ${isMe ? 'text-spal-cerulean' : 'text-spal-text'}`}>
                          {row.managerName}{isMe && <span className="ml-1 text-xs opacity-60">you</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const selectClass =
  'bg-spal-surface border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
