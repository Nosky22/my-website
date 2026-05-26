import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

interface Season { id: number; year: number }

interface StandingRow {
  profile_id: string
  display_name: string
  rounds_played: number
  total_points: number
  h2h_points: number
  h2h_wins: number
  h2h_draws: number
  h2h_losses: number
  last_updated_round: number | null
}

interface DraftRow {
  managerId: string
  managerName: string
  firstPickNumber: number
}

export default function StandingsPage() {
  const { user } = useAuth()
  const [seasons, setSeasons]           = useState<Season[]>([])
  const [seasonId, setSeasonId]         = useState<number | null>(null)
  const [standingRows, setStandingRows] = useState<StandingRow[]>([])
  const [draftRows, setDraftRows]       = useState<DraftRow[]>([])
  const [loading, setLoading]           = useState(false)

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
    setStandingRows([])
    setDraftRows([])

    Promise.all([
      supabase
        .from('season_standings')
        .select('profile_id, rounds_played, total_points, h2h_points, h2h_wins, h2h_draws, h2h_losses, last_updated_round, profiles!profile_id(display_name)')
        .eq('season_id', seasonId)
        .order('h2h_points', { ascending: false })
        .order('total_points', { ascending: false }),

      supabase
        .from('draft_picks')
        .select('profile_id, pick_number, profiles!profile_id(display_name)')
        .eq('season_id', seasonId),
    ]).then(([standingsRes, picksRes]) => {
      type RawStanding = {
        profile_id: string
        rounds_played: number
        total_points: number
        h2h_points: number
        h2h_wins: number
        h2h_draws: number
        h2h_losses: number
        last_updated_round: number | null
        profiles: { display_name: string } | null
      }
      const standings = (standingsRes.data ?? []) as unknown as RawStanding[]
      setStandingRows(standings.map(s => ({
        profile_id:         s.profile_id,
        display_name:       s.profiles?.display_name ?? 'Unknown',
        rounds_played:      s.rounds_played,
        total_points:       s.total_points,
        h2h_points:         s.h2h_points,
        h2h_wins:           s.h2h_wins,
        h2h_draws:          s.h2h_draws,
        h2h_losses:         s.h2h_losses,
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

      setLoading(false)
    })
  }, [seasonId])

  const lastRound = standingRows.reduce<number | null>((acc, r) => {
    if (r.last_updated_round == null) return acc
    return acc == null ? r.last_updated_round : Math.max(acc, r.last_updated_round)
  }, null)

  return (
    <div>
      <h1 className="text-2xl font-bold text-spal-yellow mb-6">Standings</h1>

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
      ) : (
        <>
          {/* ── Score standings ──────────────────────────────────────────── */}
          {standingRows.length === 0 ? (
            <div className="bg-spal-surface rounded p-5 mb-10 text-sm text-spal-muted">
              No scores yet for this season.
            </div>
          ) : (
            <div className="mb-10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-spal-muted border-b border-white/10">
                    <th className="pb-2 pr-4 font-normal w-8">#</th>
                    <th className="pb-2 pr-6 font-normal">Manager</th>
                    <th className="pb-2 pr-4 font-normal text-right tabular-nums">Pts</th>
                    <th className="pb-2 pr-4 font-normal text-right tabular-nums">H2H</th>
                    <th className="pb-2 pr-4 font-normal text-right">W/D/L</th>
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
                          {row.display_name}{isMe && <span className="ml-1 text-xs opacity-60">you</span>}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-spal-text">
                          {Number(row.total_points).toFixed(1)}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-spal-text font-medium">
                          {row.h2h_points}
                        </td>
                        <td className="py-3 pr-4 text-right text-spal-muted tabular-nums">
                          {row.h2h_wins}W&nbsp;{row.h2h_draws}D&nbsp;{row.h2h_losses}L
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
          )}

          {/* ── Draft order ──────────────────────────────────────────────── */}
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
