import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { EmptyState } from '../components/EmptyState'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorCard from '../components/ErrorCard'

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

interface FixtureMember {
  profile_id: string
  display_name: string
  round_points: number | null
  group_place: number | null
}

interface FixtureGroup {
  id: number
  round_number: number
  members: FixtureMember[]
}

export default function H2HPage() {
  const { user } = useAuth()
  const [seasons, setSeasons]     = useState<Season[]>([])
  const [seasonId, setSeasonId]   = useState<number | null>(null)
  const [rows, setRows]           = useState<H2HRow[]>([])
  const [fixtures, setFixtures]   = useState<FixtureGroup[]>([])
  const [hasFixtures, setHasFixtures] = useState(true)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(false)
  const [retryKey, setRetryKey]   = useState(0)

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
        .select('id, round_number, fixture_group_members(profile_id, round_points, group_place, profiles!profile_id(display_name))')
        .eq('season_id', seasonId)
        .order('round_number'),
    ]).then(([standingsRes, fixturesRes]) => {
      if (standingsRes.error || fixturesRes.error) { setError(true); setLoading(false); return }
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

      type RawMember = {
        profile_id: string
        round_points: number | null
        group_place: number | null
        profiles: { display_name: string } | null
      }
      type RawGroup = {
        id: number
        round_number: number
        fixture_group_members: RawMember[]
      }
      const rawGroups = (fixturesRes.data ?? []) as unknown as RawGroup[]
      setFixtures(rawGroups.map(g => ({
        id: g.id,
        round_number: g.round_number,
        members: g.fixture_group_members.map(m => ({
          profile_id:   m.profile_id,
          display_name: m.profiles?.display_name ?? 'Unknown',
          round_points: m.round_points,
          group_place:  m.group_place,
        })),
      })))

      setHasFixtures(rawGroups.length > 0)
      setLoading(false)
    })
  }, [seasonId, retryKey])

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
        <LoadingSpinner />
      ) : error ? (
        <ErrorCard onRetry={() => setRetryKey(k => k + 1)} />
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

          {fixtures.length > 0 && (
            <div className="mt-10">
              <h2 className="text-lg font-semibold text-spal-text mb-1">Cup Results</h2>
              <p className="text-xs text-spal-muted mb-6">Round-by-round fixtures for the H2H Cup.</p>
              <div className="space-y-6">
                {Array.from(new Set(fixtures.map(f => f.round_number))).sort((a, b) => a - b).map(round => {
                  const roundFixtures = fixtures.filter(f => f.round_number === round)
                  const isPlayed = roundFixtures.some(f => f.members.some(m => m.round_points != null))
                  return (
                    <div key={round}>
                      <div className="flex items-center gap-3 mb-3">
                        <h3 className="text-sm font-semibold text-spal-text">Round {round}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                          isPlayed
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-white/10 text-spal-muted'
                        }`}>
                          {isPlayed ? 'Played' : 'Upcoming'}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {roundFixtures.map(group => (
                          <FixtureGroupCard key={group.id} group={group} userId={user?.id ?? null} />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FixtureGroupCard({ group, userId }: { group: FixtureGroup; userId: string | null }) {
  const played = group.members.some(m => m.round_points != null)
  const sorted = played
    ? [...group.members].sort((a, b) => (b.round_points ?? 0) - (a.round_points ?? 0))
    : group.members

  return (
    <div className="bg-spal-surface rounded-lg px-4 py-3 border border-white/5">
      <div className="flex flex-wrap gap-2 items-center">
        {sorted.map((m, i) => {
          const isMe = m.profile_id === userId
          const outcomeColor =
            !played            ? 'text-spal-muted' :
            m.group_place === 1 ? 'text-emerald-400' :
            m.group_place === 2 ? 'text-spal-muted' :
                                  'text-red-400'
          const outcomeLabel =
            !played            ? '' :
            m.group_place === 1 ? 'W' :
            m.group_place === 2 ? 'D' :
                                  'L'

          return (
            <div key={m.profile_id} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-spal-muted/40 text-xs">vs</span>}
              <div className="flex items-center gap-1.5">
                <span className={`text-sm font-medium ${isMe ? 'text-spal-cerulean' : 'text-spal-text'}`}>
                  {m.display_name}{isMe && <span className="ml-1 text-xs opacity-60">you</span>}
                </span>
                {played && m.round_points != null && (
                  <span className="text-xs tabular-nums text-spal-muted">
                    ({Number(m.round_points).toFixed(1)})
                  </span>
                )}
                {played && (
                  <span className={`text-xs font-semibold ${outcomeColor}`}>{outcomeLabel}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const selectClass =
  'bg-spal-surface border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
