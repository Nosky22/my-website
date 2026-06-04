import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/Toast'
import NationBadge from '../components/NationBadge'
import { EmptyState } from '../components/EmptyState'
import ErrorCard from '../components/ErrorCard'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SeasonOption { id: number; year: number; status: string }
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
  h2h_wins:           number
  h2h_draws:          number
  h2h_losses:         number
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

function ordinal(n: number): string {
  if (n === 1) return '1st'
  if (n === 2) return '2nd'
  if (n === 3) return '3rd'
  return `${n}th`
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, profile } = useAuth()
  const { addToast } = useToast()

  // Season selector
  const [allSeasons, setAllSeasons]         = useState<SeasonOption[]>([])
  const [selectedSeasonId, setSelectedSeasonId] = useState<number | null>(null)
  const [activeSeasonId, setActiveSeasonId] = useState<number | null>(null)

  // Page data
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState(false)
  const [season, setSeason]               = useState<Season | null>(null)
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
  const [predoPoints, setPredoPoints]     = useState<number | null>(null)

  // Inline team_name editing
  const [teamName, setTeamName]           = useState(profile?.team_name ?? '')
  const [editingTeamName, setEditingTeamName] = useState(false)
  const [teamNameDraft, setTeamNameDraft] = useState('')
  const [teamNameSaving, setTeamNameSaving] = useState(false)

  // Sync teamName when profile resolves
  useEffect(() => {
    if (profile?.team_name !== undefined) setTeamName(profile.team_name)
  }, [profile])

  // Load all seasons once when user is ready; default to active or most recent
  useEffect(() => {
    if (!user) return
    supabase
      .from('seasons')
      .select('id, year, status')
      .order('year', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        const rows = (data ?? []) as SeasonOption[]
        setAllSeasons(rows)
        const active = rows.find(s => s.status === 'active') ?? rows[0]
        if (active) {
          setActiveSeasonId(active.id)
          setSelectedSeasonId(active.id)
        } else {
          setLoading(false)
        }
      })
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reload data whenever the selected season changes
  useEffect(() => {
    if (!user || selectedSeasonId == null) return
    load(selectedSeasonId)
  }, [user, selectedSeasonId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load(seasonId: number) {
    setLoading(true)
    setError(false)

    const seasonMeta = allSeasons.find(s => s.id === seasonId)
    if (!seasonMeta) {
      // allSeasons may not be set yet on first run — fetch inline
      const { data } = await supabase
        .from('seasons')
        .select('id, year')
        .eq('id', seasonId)
        .single()
      if (!data) { setLoading(false); return }
      setSeason(data as Season)
    } else {
      setSeason({ id: seasonMeta.id, year: seasonMeta.year })
    }

    // ── Parallel fetches ──────────────────────────────────────────────────
    const [
      { data: matchRows, error: err1 },
      { data: pickRows, error: err2 },
      { data: standingsRows, error: err3 },
      { data: mySquads, error: err4 },
      { data: draftSessionRow, error: err5 },
      { data: rulesRow, error: err6 },
      { data: predoRows, error: err7 },
    ] = await Promise.all([
      supabase
        .from('matches')
        .select('round_number, kickoff_at')
        .eq('season_id', seasonId)
        .order('round_number')
        .order('kickoff_at'),
      supabase
        .from('draft_picks')
        .select('pick_number, draft_slot, players(display_name, nation, canonical_position)')
        .eq('season_id', seasonId)
        .eq('profile_id', user!.id)
        .order('pick_number'),
      supabase
        .from('season_standings')
        .select('profile_id, total_points, rounds_played, last_updated_round, h2h_wins, h2h_draws, h2h_losses, profiles(display_name, team_name)')
        .eq('season_id', seasonId)
        .order('total_points', { ascending: false }),
      supabase
        .from('manager_round_squads')
        .select('id, round_number, status, locked_at')
        .eq('season_id', seasonId)
        .eq('profile_id', user!.id),
      supabase
        .from('draft_sessions')
        .select('status')
        .eq('season_id', seasonId)
        .maybeSingle(),
      supabase
        .from('season_rules')
        .select('rules')
        .eq('season_id', seasonId)
        .maybeSingle(),
      supabase
        .from('predo_scores')
        .select('total_points')
        .eq('season_id', seasonId)
        .eq('profile_id', user!.id),
    ])

    if (err1 || err2 || err3 || err4 || err5 || err6 || err7) { setError(true); setLoading(false); return }

    // ── Derive current round ──────────────────────────────────────────────
    const now = new Date()
    const rounds = [...new Set((matchRows ?? []).map(m => m.round_number as number))].sort((a, b) => a - b)

    let activeRound = rounds[rounds.length - 1] ?? 1
    for (const r of rounds) {
      const kickoffs = (matchRows ?? [])
        .filter(m => m.round_number === r)
        .map(m => new Date(m.kickoff_at as string))
        .sort((a, b) => a.getTime() - b.getTime())
      if (kickoffs[0] && kickoffs[0] > now) { activeRound = r; break }
    }
    setCurrentRound(activeRound)

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
      h2h_wins:           Number((s as unknown as { h2h_wins: number }).h2h_wins ?? 0),
      h2h_draws:          Number((s as unknown as { h2h_draws: number }).h2h_draws ?? 0),
      h2h_losses:         Number((s as unknown as { h2h_losses: number }).h2h_losses ?? 0),
    }))
    setStandings(standingsList)

    const myStanding = standingsList.find(s => s.profile_id === user!.id)
    setScoresExist((myStanding?.last_updated_round ?? 0) >= activeRound && (myStanding?.rounds_played ?? 0) > 0)

    // ── Predo points ──────────────────────────────────────────────────────
    const predoTotal = (predoRows ?? []).reduce((sum, r) => sum + Number((r as { total_points: number }).total_points ?? 0), 0)
    setPredoPoints(predoRows && predoRows.length > 0 ? predoTotal : null)

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
          .eq('season_id', seasonId)
          .in('player_id', playerIds)

        const basePrices  = new Map<number, number>()
        const roundPrices = new Map<number, number>()
        for (const p of priceRows ?? []) {
          if (p.round_number === null)             basePrices.set(Number(p.player_id), Number(p.final_price))
          else if (p.round_number === activeRound) roundPrices.set(Number(p.player_id), Number(p.final_price))
        }

        type RawPlayer = { display_name: string; nation: string; canonical_position: string }
        const full: SquadPlayer[] = (rawSquadPlayers ?? []).map(sp => {
          const pid  = Number(sp.player_id)
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
    } else {
      setSquadPlayers([])
      setBudgetUsed(null)
      setPlayerCount(0)
    }

    setLoading(false)
  }

  // ── Team name editing ──────────────────────────────────────────────────────

  function startEditTeamName() {
    setTeamNameDraft(teamName)
    setEditingTeamName(true)
  }

  async function saveTeamName() {
    const trimmed = teamNameDraft.trim()
    setTeamNameSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({ team_name: trimmed })
      .eq('id', user!.id)
    setTeamNameSaving(false)
    if (error) {
      addToast('Failed to save team name', 'error')
    } else {
      setTeamName(trimmed)
      setEditingTeamName(false)
      addToast('Team name saved', 'success')
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const isActiveSeason    = selectedSeasonId === activeSeasonId
  const deadlinePassed    = roundDeadline ? new Date(roundDeadline) < new Date() : false
  const isLocked          = !!mySquad?.locked_at || deadlinePassed

  const squadStatusKey: 'none' | 'draft' | 'submitted' | 'locked' =
    !mySquad            ? 'none'
    : mySquad.locked_at ? 'locked'
    : mySquad.status === 'submitted' ? 'submitted'
    : 'draft'

  const ctaLabel =
    !isActiveSeason                     ? 'View Squad'  :
    squadStatusKey === 'locked'         ? 'View Squad'  :
    squadStatusKey === 'submitted'      ? 'Edit Squad'  :
    squadStatusKey === 'draft'          ? 'Edit Draft'  :
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

  const hasScores  = standings.some(s => s.rounds_played > 0)
  const myStanding = standings.find(s => s.profile_id === user?.id) ?? null
  const myPosition = myStanding ? standings.indexOf(myStanding) + 1 : null

  // ── Loading / no-season states ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 rounded-full border-2 border-spal-cerulean border-t-transparent animate-spin" />
      </div>
    )
  }

  if (error) {
    return <ErrorCard onRetry={() => { if (selectedSeasonId != null) load(selectedSeasonId) }} />
  }

  if (!season) {
    return (
      <EmptyState
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        }
        title="No active season"
        body="Check back when a season is active"
      />
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Season selector ──────────────────────────────────────────────── */}
      {allSeasons.length > 1 && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-spal-muted">Season</label>
          <select
            value={selectedSeasonId ?? ''}
            onChange={e => setSelectedSeasonId(Number(e.target.value))}
            className="bg-spal-surface border border-white/10 text-spal-text text-sm rounded px-2.5 py-1 focus:outline-none focus:border-spal-cerulean"
          >
            {allSeasons.map(s => (
              <option key={s.id} value={s.id}>
                {s.year}{s.status === 'active' ? ' (active)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ── Profile summary card ─────────────────────────────────────────── */}
      <div className="bg-spal-surface rounded-lg px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">

          {/* Identity */}
          <div>
            <p className="text-lg font-bold text-spal-yellow">{profile?.display_name ?? '—'}</p>
            {editingTeamName ? (
              <div className="flex items-center gap-2 mt-1">
                <input
                  value={teamNameDraft}
                  onChange={e => setTeamNameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveTeamName(); if (e.key === 'Escape') setEditingTeamName(false) }}
                  className="bg-spal-bg border border-spal-cerulean/50 text-spal-text text-sm rounded px-2 py-1 w-44 focus:outline-none focus:border-spal-cerulean"
                  placeholder="Team name"
                  autoFocus
                  maxLength={60}
                />
                <button
                  onClick={saveTeamName}
                  disabled={teamNameSaving}
                  className="text-xs text-spal-cerulean hover:text-spal-cerulean-light transition-colors disabled:opacity-50"
                >
                  {teamNameSaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => setEditingTeamName(false)}
                  className="text-xs text-spal-muted hover:text-spal-text transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 mt-0.5">
                <p className="text-sm text-spal-muted">{teamName || 'No team name set'}</p>
                <button
                  onClick={startEditTeamName}
                  className="text-spal-muted/40 hover:text-spal-muted transition-colors text-xs leading-none"
                  title="Edit team name"
                >
                  ✎
                </button>
              </div>
            )}
          </div>

          {/* Stats row */}
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {myPosition && (
              <div className="text-center">
                <p className="text-xs text-spal-muted">Position</p>
                <p className="text-lg font-bold text-spal-yellow">{ordinal(myPosition)}</p>
              </div>
            )}
            {myStanding && (
              <div className="text-center">
                <p className="text-xs text-spal-muted">Points</p>
                <p className="text-lg font-bold text-spal-text tabular-nums">{myStanding.total_points.toFixed(1)}</p>
              </div>
            )}
            {myStanding && myStanding.rounds_played > 0 && (
              <div className="text-center">
                <p className="text-xs text-spal-muted">Rounds</p>
                <p className="text-lg font-bold text-spal-text tabular-nums">{myStanding.rounds_played}</p>
              </div>
            )}
            {myStanding && (myStanding.h2h_wins + myStanding.h2h_draws + myStanding.h2h_losses) > 0 && (
              <div className="text-center">
                <p className="text-xs text-spal-muted">H2H</p>
                <p className="text-sm font-medium tabular-nums mt-1">
                  <span className="text-emerald-400">{myStanding.h2h_wins}W</span>
                  {' '}
                  <span className="text-spal-muted">{myStanding.h2h_draws}D</span>
                  {' '}
                  <span className="text-red-400">{myStanding.h2h_losses}L</span>
                </p>
              </div>
            )}
            {predoPoints !== null && (
              <div className="text-center">
                <p className="text-xs text-spal-muted">Predo pts</p>
                <p className="text-lg font-bold text-spal-text tabular-nums">{predoPoints.toFixed(1)}</p>
              </div>
            )}
          </div>

        </div>
      </div>

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
        {!isActiveSeason && (
          <p className="text-spal-muted text-xs mt-1">
            Viewing {season.year} — historical data only
          </p>
        )}
        {roundDeadline && !deadlinePassed && isActiveSeason && (
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
            {isActiveSeason && (
              <Link to={ctaTo} className="text-sm text-spal-cerulean hover:text-spal-cerulean-light transition-colors">
                Build squad →
              </Link>
            )}
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
