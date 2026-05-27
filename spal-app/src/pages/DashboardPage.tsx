import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import NationBadge from '../components/NationBadge'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Season { id: number; year: number }

interface SquadPlayer {
  player_id:          number
  role:               string
  is_captain:         boolean
  display_name:       string
  nation:             string
  canonical_position: string
  price:              number
}

interface DraftPick {
  pick_number: number
  draft_slot:  string
  players: { display_name: string; nation: string; canonical_position: string } | null
}

interface Standing {
  profile_id:         string
  display_name:       string
  team_name:          string
  total_points:       number
  rounds_played:      number
  last_updated_round: number | null
}

interface MySquad {
  id:        number
  status:    string
  locked_at: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DRAFT_SLOT_LABELS: Record<string, string> = {
  front_row:      'Front Row',
  back_row:       'Back Row',
  outside_back:   'Outside Back',
  weakest_nation: 'Weakest Nation',
  bench:          'Bench',
}

const SQUAD_GROUPS: { label: string; test: (p: SquadPlayer) => boolean }[] = [
  { label: 'Props',         test: p => p.role === 'starter' && p.canonical_position === 'Prop' },
  { label: 'Hooker',        test: p => p.role === 'starter' && p.canonical_position === 'Hooker' },
  { label: 'Second Rows',   test: p => p.role === 'starter' && p.canonical_position === 'Second Row' },
  { label: 'Back Row',      test: p => p.role === 'starter' && ['Flanker', 'Number 8'].includes(p.canonical_position) },
  { label: 'Scrum-half',    test: p => p.role === 'starter' && p.canonical_position === 'Scrum-half' },
  { label: 'Fly-half',      test: p => p.role === 'starter' && p.canonical_position === 'Fly-half' },
  { label: 'Centres',       test: p => p.role === 'starter' && p.canonical_position === 'Centre' },
  { label: 'Outside Backs', test: p => p.role === 'starter' && ['Wing', 'Fullback'].includes(p.canonical_position) },
  { label: 'Supersub',      test: p => p.role === 'supersub' },
]

function fmtSlot(slot: string): string {
  return DRAFT_SLOT_LABELS[slot] ?? slot.replace(/_/g, ' ')
}

function fmtDeadline(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).replace(',', '')
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth()

  const [loading, setLoading]             = useState(true)
  const [season, setSeason]               = useState<Season | null>(null)
  const [isFallbackSeason, setIsFallbackSeason] = useState(false)
  const [currentRound, setCurrentRound]   = useState<number | null>(null)
  const [roundDeadline, setRoundDeadline] = useState<string | null>(null)
  const [mySquad, setMySquad]             = useState<MySquad | null>(null)
  const [budgetUsed, setBudgetUsed]       = useState<number | null>(null)
  const [budgetLimit, setBudgetLimit]     = useState<number | null>(null)
  const [playerCount, setPlayerCount]     = useState(0)
  const [squadPlayers, setSquadPlayers]   = useState<SquadPlayer[]>([])
  const [draftPicks, setDraftPicks]       = useState<DraftPick[]>([])
  const [standings, setStandings]         = useState<Standing[]>([])
  const [draftComplete, setDraftComplete] = useState(false)
  const [scoresExist, setScoresExist]     = useState(false)

  useEffect(() => {
    if (!user) return
    load()
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)

    // ── Active season ─────────────────────────────────────────────────────
    // Prefer a season explicitly marked active; fall back to the most recent.
    const { data: seasonRows } = await supabase
      .from('seasons')
      .select('id, year, status')
      .order('year', { ascending: false })
      .limit(10)

    const rows = (seasonRows ?? []) as (Season & { status: string })[]
    const explicitlyActive = rows.find(s => s.status === 'active')
    const activeSeason     = explicitlyActive ?? rows[0]

    if (!activeSeason) {
      setSeason(null)
      setLoading(false)
      return
    }
    setSeason(activeSeason)
    setIsFallbackSeason(!explicitlyActive)

    // ── Parallel fetches ──────────────────────────────────────────────────
    const [
      { data: matchRows },
      { data: pickRows },
      standingsResult,
      { data: mySquads },
      { data: draftSessionRow },
      { data: rulesRow },
    ] = await Promise.all([
      supabase
        .from('matches')
        .select('round_number, kickoff_at')
        .eq('season_id', activeSeason.id)
        .order('round_number')
        .order('kickoff_at'),
      supabase
        .from('draft_picks')
        .select('pick_number, draft_slot, players(display_name, nation, canonical_position)')
        .eq('season_id', activeSeason.id)
        .eq('profile_id', user!.id)
        .order('pick_number'),
      supabase
        .from('season_standings')
        .select('profile_id, total_points, rounds_played, last_updated_round, profiles(display_name, team_name)')
        .eq('season_id', activeSeason.id)
        .order('total_points', { ascending: false }),
      supabase
        .from('manager_round_squads')
        .select('id, round_number, status, locked_at')
        .eq('season_id', activeSeason.id)
        .eq('profile_id', user!.id),
      supabase
        .from('draft_sessions')
        .select('status')
        .eq('season_id', activeSeason.id)
        .maybeSingle(),
      supabase
        .from('season_rules')
        .select('rules')
        .eq('season_id', activeSeason.id)
        .maybeSingle(),
    ])
    const standingsRows = standingsResult.data
    console.log('[Dashboard standings]', { data: standingsRows, error: standingsResult.error, seasonId: activeSeason.id })

    // ── Derive current round ──────────────────────────────────────────────
    const now = new Date()
    const rounds = [...new Set((matchRows ?? []).map(m => m.round_number as number))].sort((a, b) => a - b)

    // First round that still has a future kickoff; fallback to last round.
    let activeRound = rounds[rounds.length - 1] ?? 1
    for (const r of rounds) {
      const kickoffs = (matchRows ?? [])
        .filter(m => m.round_number === r)
        .map(m => new Date(m.kickoff_at as string))
        .sort((a, b) => a.getTime() - b.getTime())
      if (kickoffs[0] && kickoffs[0] > now) { activeRound = r; break }
    }
    setCurrentRound(activeRound)

    // Round deadline = earliest kickoff in the active round.
    const currentRoundKickoffs = (matchRows ?? [])
      .filter(m => m.round_number === activeRound)
      .map(m => m.kickoff_at as string)
      .sort()
    setRoundDeadline(currentRoundKickoffs[0] ?? null)

    // ── My squad for current round ────────────────────────────────────────
    const myCurrentSquad = ((mySquads ?? []) as MySquad[]).find(s => (s as unknown as { round_number: number }).round_number === activeRound) ?? null
    setMySquad(myCurrentSquad)

    // ── Draft picks ───────────────────────────────────────────────────────
    const picks = (pickRows as unknown as DraftPick[]) ?? []
    setDraftPicks(picks)
    setDraftComplete(picks.length > 0 || draftSessionRow?.status === 'completed')

    // ── Standings ─────────────────────────────────────────────────────────
    const standingsList: Standing[] = (standingsRows ?? []).map(s => ({
      profile_id:         s.profile_id as string,
      display_name:       (s.profiles as unknown as { display_name: string } | null)?.display_name ?? 'Unknown',
      team_name:          (s.profiles as unknown as { team_name: string } | null)?.team_name ?? '',
      total_points:       Number(s.total_points ?? 0),
      rounds_played:      Number(s.rounds_played ?? 0),
      last_updated_round: s.last_updated_round as number | null,
    }))
    setStandings(standingsList)

    // Scores exist if the standings row for the current manager has been
    // updated at or past the active round.
    const myStanding = standingsList.find(s => s.profile_id === user!.id)
    setScoresExist((myStanding?.last_updated_round ?? 0) >= activeRound && (myStanding?.rounds_played ?? 0) > 0)

    // ── Budget ────────────────────────────────────────────────────────────
    const rules = rulesRow?.rules as Record<string, unknown> | undefined
    setBudgetLimit(Number(rules?.budget_limit ?? 200))

    if (myCurrentSquad) {
      const { data: rawSquadPlayers } = await supabase
        .from('manager_round_squad_players')
        .select('player_id, role, is_captain, players(display_name, nation, canonical_position)')
        .eq('squad_id', myCurrentSquad.id)

      const count = rawSquadPlayers?.length ?? 0
      setPlayerCount(count)

      if (count > 0) {
        const playerIds = (rawSquadPlayers ?? []).map(sp => Number(sp.player_id))
        const { data: priceRows } = await supabase
          .from('player_prices')
          .select('player_id, final_price, round_number')
          .eq('season_id', activeSeason.id)
          .in('player_id', playerIds)

        const basePrices  = new Map<number, number>()
        const roundPrices = new Map<number, number>()
        for (const p of priceRows ?? []) {
          if (p.round_number === null)             basePrices.set(Number(p.player_id), Number(p.final_price))
          else if (p.round_number === activeRound) roundPrices.set(Number(p.player_id), Number(p.final_price))
        }

        type RawPlayer = { display_name: string; nation: string; canonical_position: string }
        const full: SquadPlayer[] = (rawSquadPlayers ?? []).map(sp => {
          const pid = Number(sp.player_id)
          const info = sp.players as unknown as RawPlayer | null
          return {
            player_id:          pid,
            role:               sp.role as string,
            is_captain:         sp.is_captain as boolean,
            display_name:       info?.display_name ?? '',
            nation:             info?.nation ?? '',
            canonical_position: info?.canonical_position ?? '',
            price:              roundPrices.get(pid) ?? basePrices.get(pid) ?? 0,
          }
        })
        setSquadPlayers(full)
        setBudgetUsed(full.reduce((sum, p) => sum + p.price, 0))
      } else {
        setSquadPlayers([])
        setBudgetUsed(0)
      }
    }

    setLoading(false)
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const deadlinePassed = roundDeadline ? new Date(roundDeadline) < new Date() : false
  const isLocked       = !!mySquad?.locked_at || deadlinePassed

  const squadStatusKey: 'none' | 'draft' | 'submitted' | 'locked' =
    !mySquad            ? 'none'
    : mySquad.locked_at ? 'locked'
    : mySquad.status === 'submitted' ? 'submitted'
    : 'draft'

  const ctaLabel =
    squadStatusKey === 'locked'    ? 'View Squad'  :
    squadStatusKey === 'submitted' ? 'Edit Squad'  :
    squadStatusKey === 'draft'     ? 'Edit Draft'  :
    'Submit Squad'

  const ctaTo = season && currentRound
    ? `/squad?season=${season.id}&round=${currentRound}`
    : '/squad'

  const squadSubmitted = squadStatusKey === 'submitted' || squadStatusKey === 'locked'

  const workflowSteps = [
    { label: 'Draft complete',    done: draftComplete  },
    { label: 'Squad submitted',   done: squadSubmitted },
    { label: 'Round locked',      done: isLocked       },
    { label: 'Scores calculated', done: scoresExist    },
  ]
  const firstUndone = workflowSteps.findIndex(s => !s.done)

  const hasScores = standings.some(s => s.rounds_played > 0)

  // ── Loading / no-season states ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 rounded-full border-2 border-spal-cerulean border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!season) {
    return <p className="text-spal-muted text-sm py-8">No active season.</p>
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── 1. Season header ─────────────────────────────────────────────── */}
      <div className="bg-spal-surface rounded-lg px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-bold text-spal-yellow">{season.year} Six Nations</h1>
          {currentRound && (
            <span className="text-spal-muted text-sm">
              Round {currentRound}
              <span className={`ml-2 text-xs font-medium px-1.5 py-0.5 rounded ${
                deadlinePassed
                  ? 'bg-white/10 text-spal-muted'
                  : 'bg-emerald-500/15 text-emerald-400'
              }`}>
                {deadlinePassed ? 'Locked' : 'Open'}
              </span>
            </span>
          )}
        </div>
        {isFallbackSeason && (
          <p className="text-spal-muted text-xs mt-1">
            No active season — showing {season.year}
          </p>
        )}
        {roundDeadline && !deadlinePassed && (
          <p className="text-spal-muted text-sm mt-1">
            Squad deadline: {fmtDeadline(roundDeadline)}
          </p>
        )}
      </div>

      {/* ── 2 + 5. Squad status card + Workflow indicator ────────────────── */}
      <div className="flex flex-col md:flex-row gap-4 items-start">

        {/* Squad status card */}
        <div className="flex-1 bg-spal-surface rounded-lg px-5 py-4">
          <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wide mb-3">Squad Status</h2>

          <div className="flex items-center gap-3 mb-4">
            {squadStatusKey === 'none' && (
              <span className="px-2.5 py-1 rounded bg-white/10 text-spal-muted text-sm">Not started</span>
            )}
            {squadStatusKey === 'draft' && (
              <span className="px-2.5 py-1 rounded bg-amber-500/20 text-amber-400 text-sm font-medium">Draft saved</span>
            )}
            {squadStatusKey === 'submitted' && (
              <span className="px-2.5 py-1 rounded bg-spal-cerulean/20 text-spal-cerulean text-sm font-medium">Submitted</span>
            )}
            {squadStatusKey === 'locked' && (
              <span className="px-2.5 py-1 rounded bg-white/10 text-spal-muted text-sm font-medium">Locked</span>
            )}
          </div>

          {mySquad && budgetUsed !== null && budgetLimit !== null && (
            <p className="text-sm text-spal-muted mb-4">
              Budget:{' '}
              <span className="text-spal-text font-medium tabular-nums">{budgetUsed}★</span>
              {' / '}{budgetLimit}★
              <span className="ml-2 text-xs">({playerCount}/16 players)</span>
            </p>
          )}

          <Link
            to={ctaTo}
            className="inline-block px-4 py-2 rounded bg-spal-cerulean text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {ctaLabel}
          </Link>
        </div>

        {/* Workflow indicator */}
        <div className="md:w-52 md:shrink-0 bg-spal-surface rounded-lg px-5 py-4">
          <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wide mb-4">Round progress</h2>
          <ol className="space-y-3">
            {workflowSteps.map((step, i) => {
              const isCurrent = i === firstUndone
              return (
                <li key={step.label} className="flex items-center gap-2.5">
                  <div className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-xs font-bold transition-colors ${
                    step.done
                      ? 'bg-emerald-500 text-white'
                      : isCurrent
                        ? 'border-2 border-spal-cerulean'
                        : 'border border-white/20'
                  }`}>
                    {step.done ? '✓' : null}
                  </div>
                  <span className={`text-sm ${
                    step.done    ? 'text-spal-muted line-through decoration-white/20'
                    : isCurrent  ? 'text-spal-text font-medium'
                    : 'text-spal-muted'
                  }`}>
                    {step.label}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>

      </div>

      {/* ── My Squad grid ────────────────────────────────────────────────── */}
      <div className="bg-spal-surface rounded-lg px-5 py-4">
        <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wide mb-3">
          My Squad — Round {currentRound}
        </h2>

        {squadPlayers.length === 0 ? (
          <div className="flex items-center gap-3">
            <p className="text-sm text-spal-muted">No squad submitted yet.</p>
            <Link to={ctaTo} className="text-sm text-spal-cerulean hover:text-spal-cerulean-light transition-colors">
              Build squad →
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {SQUAD_GROUPS.map(group => {
              const players = squadPlayers.filter(group.test)
              if (players.length === 0) return null
              return (
                <div key={group.label} className="flex flex-col md:flex-row md:items-start gap-1 md:gap-4 py-2.5">
                  <span className="md:w-28 md:shrink-0 text-xs text-spal-muted md:pt-1.5">{group.label}</span>
                  <div className="flex flex-wrap gap-2">
                    {players.map(p => (
                      <div
                        key={p.player_id}
                        className="flex items-center gap-1.5 bg-spal-surface-raised rounded px-2.5 py-1.5"
                      >
                        <NationBadge nation={p.nation} />
                        <span className="text-xs text-spal-text font-medium">{p.display_name}</span>
                        {p.price > 0 && (
                          <span className="text-xs text-spal-muted tabular-nums">{p.price}★</span>
                        )}
                        {p.is_captain && (
                          <span className="text-xs font-bold text-spal-yellow ml-0.5">C</span>
                        )}
                        {p.role === 'supersub' && (
                          <span className="text-xs font-bold text-spal-cerulean ml-0.5">S</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── 3 + 4. Draft picks + Standings ───────────────────────────────── */}
      <div className="flex flex-col md:flex-row gap-4 items-start">

        {/* Draft picks */}
        <div className="flex-1 bg-spal-surface rounded-lg px-5 py-4">
          <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wide mb-3">My Picks</h2>
          {draftPicks.length === 0 ? (
            <p className="text-spal-muted text-sm">No picks yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-white/5">
                  <th className="pb-2 pr-3 text-spal-muted font-medium w-6">#</th>
                  <th className="pb-2 pr-3 text-spal-muted font-medium">Player</th>
                  <th className="pb-2 pr-3 text-spal-muted font-medium">Position</th>
                  <th className="pb-2 text-spal-muted font-medium">Slot</th>
                </tr>
              </thead>
              <tbody>
                {draftPicks.map(pick => (
                  <tr key={pick.pick_number} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-3 text-spal-muted tabular-nums">{pick.pick_number}</td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        {pick.players && <NationBadge nation={pick.players.nation} />}
                        <span className="text-spal-text">{pick.players?.display_name ?? '—'}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-spal-muted">{pick.players?.canonical_position ?? '—'}</td>
                    <td className="py-2 text-spal-muted">{fmtSlot(pick.draft_slot)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Standings */}
        <div className="flex-1 bg-spal-surface rounded-lg px-5 py-4">
          <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wide mb-3">Standings</h2>
          {standings.length === 0 ? (
            <p className="text-spal-muted text-sm">No standings yet.</p>
          ) : !hasScores ? (
            <p className="text-spal-muted text-sm">Scores pending.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-white/5">
                  <th className="pb-2 pr-2 text-spal-muted font-medium w-6">#</th>
                  <th className="pb-2 pr-2 text-spal-muted font-medium">Manager</th>
                  <th className="pb-2 text-spal-muted font-medium text-right">Pts</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s, i) => {
                  const isMe = s.profile_id === user?.id
                  return (
                    <tr
                      key={s.profile_id}
                      className={`border-b border-white/5 last:border-0 ${isMe ? 'text-spal-yellow' : ''}`}
                    >
                      <td className="py-2 pr-2 text-spal-muted tabular-nums">{i + 1}</td>
                      <td className="py-2 pr-2">
                        <div className={isMe ? 'font-semibold' : 'text-spal-text'}>{s.display_name}</div>
                        <div className="text-xs text-spal-muted">{s.team_name}</div>
                      </td>
                      <td className="py-2 text-right tabular-nums font-medium">{s.total_points}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  )
}
