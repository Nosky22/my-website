import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { EmptyState } from '../components/EmptyState'

interface Season { id: number; year: number }

interface Match {
  id: string
  round_number: number
  home_nation: string
  away_nation: string
  kickoff_at: string | null
}

interface PublicSquadPlayer {
  player_id: number
  match_id: string
  status: string
  display_name: string
  nation: string
  canonical_position: string
}

const ROUNDS = [1, 2, 3, 4, 5] as const

const NATION_BADGE: Record<string, { abbr: string; cls: string }> = {
  England:  { abbr: 'ENG', cls: 'bg-red-900/40 text-red-300' },
  Ireland:  { abbr: 'IRE', cls: 'bg-green-900/40 text-green-300' },
  Scotland: { abbr: 'SCO', cls: 'bg-blue-900/40 text-blue-300' },
  Wales:    { abbr: 'WAL', cls: 'bg-rose-900/40 text-rose-300' },
  France:   { abbr: 'FRA', cls: 'bg-indigo-900/40 text-indigo-300' },
  Italy:    { abbr: 'ITA', cls: 'bg-sky-900/40 text-sky-300' },
}

const POSITION_ORDER: Record<string, number> = {
  'Prop': 1, 'Hooker': 2, 'Second Row': 3, 'Flanker': 4, 'Number 8': 5,
  'Scrum-half': 6, 'Fly-half': 7, 'Centre': 8, 'Wing': 9, 'Fullback': 10,
}

function NationBadge({ nation }: { nation: string }) {
  const info = NATION_BADGE[nation]
  return (
    <span className={`text-xs font-mono rounded px-1.5 py-0.5 ${info?.cls ?? 'bg-white/10 text-spal-muted'}`}>
      {info?.abbr ?? nation.slice(0, 3).toUpperCase()}
    </span>
  )
}

function formatKickoff(ts: string): string {
  return new Date(ts).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function TeamSheetsPage() {
  const { user } = useAuth()

  const [activeSeason, setActiveSeason]   = useState<Season | null>(null)
  const [allMatches, setAllMatches]       = useState<Match[]>([])
  const [selectedRound, setSelectedRound] = useState<number>(1)
  const [squadMap, setSquadMap]           = useState<Map<string, PublicSquadPlayer[]>>(new Map())
  const [ownershipMap, setOwnershipMap]   = useState<Map<number, number>>(new Map())
  const [loading, setLoading]             = useState(true)

  // Load active season + all matches to determine available rounds and current round
  useEffect(() => {
    async function init() {
      const { data: seasonData } = await supabase
        .from('seasons')
        .select('id, year')
        .eq('status', 'active')
        .maybeSingle()

      if (!seasonData) { setLoading(false); return }
      setActiveSeason(seasonData)

      const { data: matchData } = await supabase
        .from('matches')
        .select('id, round_number, home_nation, away_nation, kickoff_at')
        .eq('season_id', seasonData.id)
        .order('round_number')
        .order('kickoff_at')

      const matches = (matchData ?? []) as Match[]
      setAllMatches(matches)

      // Default to first round whose earliest kickoff is in the future;
      // fall back to the highest round if all kickoffs have passed.
      const now = new Date().toISOString()
      const roundsWithFutureKickoff = matches
        .filter(m => m.kickoff_at && m.kickoff_at > now)
        .map(m => m.round_number)

      const rounds = [...new Set(matches.map(m => m.round_number))].sort((a, b) => a - b)
      const defaultRound = roundsWithFutureKickoff.length > 0
        ? Math.min(...roundsWithFutureKickoff)
        : (rounds[rounds.length - 1] ?? 1)

      setSelectedRound(defaultRound)
    }
    init()
  }, [])

  // Load squads when season + round changes
  useEffect(() => {
    if (!activeSeason) return
    loadRound(activeSeason.id, selectedRound)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSeason, selectedRound])

  async function loadRound(seasonId: number, round: number) {
    setLoading(true)

    const roundMatches = allMatches.filter(m => m.round_number === round)
    if (roundMatches.length === 0) {
      // Matches for this round haven't loaded yet — fetch them
      const { data } = await supabase
        .from('matches')
        .select('id, round_number, home_nation, away_nation, kickoff_at')
        .eq('season_id', seasonId)
        .eq('round_number', round)
        .order('kickoff_at')
      const newMatches = (data ?? []) as Match[]
      if (newMatches.length === 0) { setSquadMap(new Map()); setLoading(false); return }
      await loadSquadsForMatches(newMatches)
    } else {
      await loadSquadsForMatches(roundMatches)
    }

    if (user) await loadOwnership(seasonId, round)

    setLoading(false)
  }

  async function loadSquadsForMatches(matches: Match[]) {
    const matchIds = matches.map(m => m.id)
    const { data: mdData } = await supabase
      .from('matchday_squads')
      .select('match_id, status, player_id, players!player_id(display_name, nation, canonical_position)')
      .in('match_id', matchIds)

    const map = new Map<string, PublicSquadPlayer[]>()
    for (const m of matches) map.set(m.id, [])

    for (const row of (mdData ?? []) as unknown as Array<{
      match_id: string; status: string; player_id: number
      players: { display_name: string; nation: string; canonical_position: string } | null
    }>) {
      if (!row.players) continue
      const entry: PublicSquadPlayer = {
        player_id:          row.player_id,
        match_id:           row.match_id,
        status:             row.status,
        display_name:       row.players.display_name,
        nation:             row.players.nation,
        canonical_position: row.players.canonical_position,
      }
      const list = map.get(row.match_id) ?? []
      list.push(entry)
      map.set(row.match_id, list)
    }
    setSquadMap(map)
  }

  async function loadOwnership(seasonId: number, round: number) {
    const { data: squadData } = await supabase
      .from('manager_round_squads')
      .select('id')
      .eq('season_id', seasonId)
      .eq('round_number', round)

    const squadIds = (squadData ?? []).map(s => s.id as string)
    if (squadIds.length === 0) { setOwnershipMap(new Map()); return }

    const { data: playerData } = await supabase
      .from('manager_round_squad_players')
      .select('player_id')
      .in('squad_id', squadIds)

    const counts = new Map<number, number>()
    for (const row of playerData ?? []) {
      const pid = row.player_id as number
      counts.set(pid, (counts.get(pid) ?? 0) + 1)
    }
    setOwnershipMap(counts)
  }

  const availableRounds = useMemo(
    () => [...new Set(allMatches.map(m => m.round_number))].sort((a, b) => a - b),
    [allMatches]
  )

  const roundMatches = useMemo(
    () => allMatches.filter(m => m.round_number === selectedRound),
    [allMatches, selectedRound]
  )

  if (!activeSeason && !loading) {
    return (
      <EmptyState
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        }
        title="No active season"
        body="Team sheets will appear here when a season is active."
      />
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-spal-yellow">Team Sheets</h1>
        {availableRounds.length > 0 && (
          <div className="flex items-center gap-1">
            {(availableRounds.length > 0 ? availableRounds : (ROUNDS as unknown as number[])).map(r => (
              <button
                key={r}
                onClick={() => setSelectedRound(r)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
                  selectedRound === r
                    ? 'border-spal-cerulean bg-spal-cerulean/10 text-spal-cerulean'
                    : 'border-white/10 text-spal-muted hover:border-white/30 hover:text-spal-text'
                }`}
              >
                R{r}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-spal-muted text-sm">Loading…</p>
      ) : roundMatches.length === 0 ? (
        <EmptyState
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
          title="No fixtures for this round"
          body="Check back when the schedule is confirmed."
        />
      ) : (
        <div className="space-y-6">
          {roundMatches.map(match => {
            const players  = squadMap.get(match.id) ?? []
            const starters = players
              .filter(p => p.status === 'starting')
              .sort((a, b) => (POSITION_ORDER[a.canonical_position] ?? 99) - (POSITION_ORDER[b.canonical_position] ?? 99))
            const bench = players.filter(p => p.status === 'bench')

            return (
              <div key={match.id} className="bg-spal-surface rounded-lg p-5 border border-white/5">
                {/* Match header */}
                <div className="flex items-center gap-2 mb-5">
                  <NationBadge nation={match.home_nation} />
                  <span className="text-spal-text font-semibold">
                    {match.home_nation} vs {match.away_nation}
                  </span>
                  <NationBadge nation={match.away_nation} />
                  {match.kickoff_at && (
                    <span className="text-xs text-spal-muted ml-auto">{formatKickoff(match.kickoff_at)}</span>
                  )}
                </div>

                {players.length === 0 ? (
                  <p className="text-sm text-spal-muted italic">Not yet announced</p>
                ) : (
                  <>
                    <PublicPlayerList title="Starters" players={starters} ownershipMap={user ? ownershipMap : null} />
                    {bench.length > 0 && (
                      <PublicPlayerList title="Bench" players={bench} ownershipMap={user ? ownershipMap : null} />
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {user && (
        <p className="text-xs text-spal-muted mt-8">
          Cerulean dots indicate players selected in at least one manager's squad this round.
        </p>
      )}
    </div>
  )
}

// ── PublicPlayerList ──────────────────────────────────────────────────────────

interface PublicPlayerListProps {
  title: string
  players: PublicSquadPlayer[]
  ownershipMap: Map<number, number> | null
}

function PublicPlayerList({ title, players, ownershipMap }: PublicPlayerListProps) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-spal-muted uppercase tracking-wider">{title}</span>
        <span className="text-xs text-spal-muted">{players.length}</span>
      </div>
      {players.map(p => {
        const owned = ownershipMap?.has(p.player_id)
        return (
          <div key={p.player_id} className="flex items-center gap-3 py-1.5 border-b border-white/5 last:border-0">
            <span className={`text-xs font-mono rounded px-1.5 py-0.5 ${NATION_BADGE[p.nation]?.cls ?? 'bg-white/10 text-spal-muted'}`}>
              {NATION_BADGE[p.nation]?.abbr ?? p.nation.slice(0, 3).toUpperCase()}
            </span>
            <span className="text-spal-text text-sm flex-1">{p.display_name}</span>
            <span className="text-spal-muted text-xs">{p.canonical_position}</span>
            {ownershipMap != null && owned && (
              <span
                title={`In ${ownershipMap.get(p.player_id)} manager squad(s)`}
                className="w-2 h-2 rounded-full bg-spal-cerulean ml-1 shrink-0"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
