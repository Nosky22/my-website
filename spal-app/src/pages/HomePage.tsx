import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ClipboardList, Shield, Target } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import type { InsightPayload } from '../components/InsightsPanel'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorCard from '../components/ErrorCard'

interface Season { id: number; year: number }

interface StandingRow {
  profile_id: string
  display_name: string
  total_points: number
}

interface MyStanding {
  total_points: number
  h2h_wins: number
  h2h_draws: number
  h2h_losses: number
  rounds_played: number
}

interface Post {
  id: number
  title: string
  slug: string
  body: string
  created_at: string
}

// Status item shown in the action items panel
interface ActionItem {
  key: string
  label: string
  done: boolean
  cta?: { label: string; to: string }
}

function countdown(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'Passed'
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 24) return `${hours}h remaining`
  const days = Math.floor(hours / 24)
  const rem = hours % 24
  return rem > 0 ? `${days}d ${rem}h remaining` : `${days}d remaining`
}

function ordinal(n: number): string {
  if (n === 1) return '1st'
  if (n === 2) return '2nd'
  if (n === 3) return '3rd'
  return `${n}th`
}

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`[^`]+`/g, '')
    .replace(/\n+/g, ' ')
    .trim()
}

// ── Logged-out landing page ────────────────────────────────────────────────────

function LandingPage() {
  return (
    <div className="max-w-xl">
      <h1 className="text-4xl font-bold text-spal-yellow mb-3">
        Sergio Parisse Appreciation League
      </h1>
      <p className="text-spal-muted text-lg mb-8">
        A private fantasy rugby draft league for the Men's Six Nations.
      </p>

      <div className="flex gap-3 mb-14">
        <Link
          to="/standings"
          className="px-5 py-2.5 bg-spal-cerulean text-white rounded text-sm font-medium hover:bg-spal-cerulean-light transition-colors"
        >
          View League
        </Link>
        <Link
          to="/login"
          className="px-5 py-2.5 bg-spal-surface border border-white/10 text-spal-text rounded text-sm font-medium hover:border-spal-cerulean transition-colors"
        >
          Manager Login
        </Link>
      </div>

      <div className="border-t border-white/10 pt-10">
        <h2 className="text-sm font-semibold text-spal-muted uppercase tracking-wider mb-3">What is SPAL?</h2>
        <p className="text-spal-text leading-relaxed">
          SPAL is an invite-only fantasy rugby league built around the Six Nations. Each manager drafts
          a squad of international players before the tournament begins, then picks a starting XV each
          round to score points based on real match performance. At the end of the Six Nations, the
          manager with the most points wins.
        </p>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function HomePage() {
  const { user, profile, loading: authLoading } = useAuth()

  const [hubLoading, setHubLoading]     = useState(true)
  const [error, setError]               = useState(false)
  const [season, setSeason]             = useState<Season | null>(null)
  const [currentRound, setCurrentRound] = useState<number | null>(null)
  const [deadlineIso, setDeadlineIso]   = useState<string | null>(null)
  const [myStanding, setMyStanding]     = useState<MyStanding | null>(null)
  const [myPosition, setMyPosition]     = useState<number | null>(null)
  const [allStandings, setAllStandings] = useState<StandingRow[]>([])
  const [trend, setTrend]               = useState<'up' | 'down' | null>(null)
  const [posts, setPosts]               = useState<Post[]>([])
  const [insights, setInsights]         = useState<InsightPayload | null>(null)
  const [insightsRound, setInsightsRound] = useState<number | null>(null)
  // Action items state
  const [squadStatus, setSquadStatus]         = useState<'none' | 'draft' | 'submitted' | 'locked'>('none')
  const [predosSubmitted, setPredosSubmitted] = useState(false)
  const [teamSheetsAvail, setTeamSheetsAvail] = useState(false)
  const [roundScored, setRoundScored]         = useState(false)

  useEffect(() => {
    if (authLoading || !user) return
    loadHub()
  }, [authLoading, user]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadHub() {
    setHubLoading(true)
    setError(false)

    const { data: seasonData, error: seasonError } = await supabase
      .from('seasons')
      .select('id, year')
      .eq('status', 'active')
      .maybeSingle()

    if (seasonError) { setError(true); setHubLoading(false); return }
    if (!seasonData) { setHubLoading(false); return }
    setSeason(seasonData)

    const [
      { data: matchRows, error: err1 },
      { data: standingsRows, error: err2 },
      { data: myScoreRows, error: err3 },
      { data: postRows, error: err4 },
      { data: insightRow, error: err5 },
    ] = await Promise.all([
      supabase
        .from('matches')
        .select('round_number, kickoff_at')
        .eq('season_id', seasonData.id)
        .order('round_number').order('kickoff_at'),

      supabase
        .from('season_standings')
        .select('profile_id, total_points, h2h_wins, h2h_draws, h2h_losses, rounds_played, profiles!profile_id(display_name)')
        .eq('season_id', seasonData.id)
        .order('total_points', { ascending: false }),

      supabase
        .from('manager_match_scores')
        .select('adjusted_points, matches!match_id(round_number)')
        .eq('season_id', seasonData.id)
        .eq('profile_id', user!.id),

      supabase
        .from('chronicle_posts')
        .select('id, title, slug, body, created_at')
        .eq('published', true)
        .order('created_at', { ascending: false })
        .limit(3),

      supabase
        .from('round_insights')
        .select('round_number, payload')
        .eq('season_id', seasonData.id)
        .order('round_number', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (err1 || err2 || err3 || err4 || err5) { setError(true); setHubLoading(false); return }

    // Derive current round early (needed for action item fetches below)
    const nowForRound = new Date()
    const allRoundsEarly = [...new Set((matchRows ?? []).map(m => m.round_number as number))].sort((a, b) => a - b)
    let activeRoundEarly = allRoundsEarly[allRoundsEarly.length - 1] ?? 1
    for (const r of allRoundsEarly) {
      const ko = (matchRows ?? [])
        .filter(m => m.round_number === r)
        .map(m => new Date(m.kickoff_at as string))
        .sort((a, b) => a.getTime() - b.getTime())
      if (ko[0] && ko[0] > nowForRound) { activeRoundEarly = r; break }
    }
    const roundMatchIds = (matchRows ?? [])
      .filter(m => m.round_number === activeRoundEarly)
      .map(m => (m as unknown as { id?: number }).id)
      .filter((id): id is number => id != null)

    // Fetch the round's match IDs (with id column) to check action items
    const { data: roundMatchRows } = await supabase
      .from('matches')
      .select('id')
      .eq('season_id', seasonData.id)
      .eq('round_number', activeRoundEarly)

    const roundIds = (roundMatchRows ?? []).map(m => m.id as number)
    void roundMatchIds // not used further

    const [
      { data: mySquadRow },
      { data: myPredoRows },
      { data: tsRows },
      { data: scoredRows },
    ] = await Promise.all([
      supabase
        .from('manager_round_squads')
        .select('id, status, locked_at')
        .eq('season_id', seasonData.id)
        .eq('profile_id', user!.id)
        .eq('round_number', activeRoundEarly)
        .maybeSingle(),
      roundIds.length > 0
        ? supabase
            .from('predo_predictions')
            .select('id')
            .eq('profile_id', user!.id)
            .in('match_id', roundIds)
            .limit(1)
        : Promise.resolve({ data: [] }),
      roundIds.length > 0
        ? supabase
            .from('matchday_squads')
            .select('id')
            .in('match_id', roundIds)
            .limit(1)
        : Promise.resolve({ data: [] }),
      roundIds.length > 0
        ? supabase
            .from('manager_match_scores')
            .select('id')
            .in('match_id', roundIds)
            .limit(1)
        : Promise.resolve({ data: [] }),
    ])

    const sq = mySquadRow as { status: string; locked_at: string | null } | null
    const sqStatus: 'none' | 'draft' | 'submitted' | 'locked' =
      !sq           ? 'none'
      : sq.locked_at ? 'locked'
      : sq.status === 'submitted' ? 'submitted'
      : 'draft'
    setSquadStatus(sqStatus)
    setPredosSubmitted((myPredoRows?.length ?? 0) > 0)
    setTeamSheetsAvail((tsRows?.length ?? 0) > 0)
    setRoundScored((scoredRows?.length ?? 0) > 0)

    // Derive current round (first round with a future kickoff; fallback to last)
    const now = new Date()
    const allRounds = [...new Set((matchRows ?? []).map(m => m.round_number as number))].sort((a, b) => a - b)
    let activeRound = allRounds[allRounds.length - 1] ?? 1
    for (const r of allRounds) {
      const kickoffs = (matchRows ?? [])
        .filter(m => m.round_number === r)
        .map(m => new Date(m.kickoff_at as string))
        .sort((a, b) => a.getTime() - b.getTime())
      if (kickoffs[0] && kickoffs[0] > now) { activeRound = r; break }
    }
    setCurrentRound(activeRound)

    const roundKickoffs = (matchRows ?? [])
      .filter(m => m.round_number === activeRound && m.kickoff_at)
      .map(m => m.kickoff_at as string)
      .sort()
    setDeadlineIso(roundKickoffs[0] ?? null)

    // Standings
    type RawStanding = {
      profile_id: string
      total_points: number
      h2h_wins: number
      h2h_draws: number
      h2h_losses: number
      rounds_played: number
      profiles: { display_name: string } | null
    }
    const standings = (standingsRows ?? []) as unknown as RawStanding[]
    const standingList: StandingRow[] = standings.map(s => ({
      profile_id:   s.profile_id,
      display_name: s.profiles?.display_name ?? 'Unknown',
      total_points: Number(s.total_points ?? 0),
    }))
    setAllStandings(standingList)

    const myIdx = standings.findIndex(s => s.profile_id === user!.id)
    if (myIdx !== -1) {
      const myRaw = standings[myIdx]
      setMyStanding({
        total_points: Number(myRaw.total_points ?? 0),
        h2h_wins:     Number(myRaw.h2h_wins ?? 0),
        h2h_draws:    Number(myRaw.h2h_draws ?? 0),
        h2h_losses:   Number(myRaw.h2h_losses ?? 0),
        rounds_played: Number(myRaw.rounds_played ?? 0),
      })
      setMyPosition(myIdx + 1)
    }

    // Trend: sum adjusted_points by round, compare last two
    type RawScore = { adjusted_points: number; matches: { round_number: number } | null }
    const byRound = new Map<number, number>()
    for (const row of (myScoreRows ?? []) as unknown as RawScore[]) {
      const rn = row.matches?.round_number
      if (rn != null) byRound.set(rn, (byRound.get(rn) ?? 0) + Number(row.adjusted_points ?? 0))
    }
    const scoredRounds = [...byRound.keys()].sort((a, b) => a - b)
    if (scoredRounds.length >= 2) {
      const prev = byRound.get(scoredRounds[scoredRounds.length - 2])!
      const last = byRound.get(scoredRounds[scoredRounds.length - 1])!
      setTrend(last >= prev ? 'up' : 'down')
    }

    setPosts((postRows ?? []) as Post[])

    if (insightRow) {
      setInsights(insightRow.payload as InsightPayload)
      setInsightsRound(insightRow.round_number as number)
    }

    setHubLoading(false)
  }

  // ── Render branch: not yet resolved ───────────────────────────────────────
  if (authLoading) return <LoadingSpinner />

  if (!user) return <LandingPage />

  if (hubLoading) return <LoadingSpinner />

  if (error) return <ErrorCard onRetry={loadHub} />

  if (!season) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-spal-yellow mb-1">
          Welcome back, {profile?.display_name ?? 'manager'}
        </h1>
        <p className="text-spal-muted text-sm mt-1">No active season at the moment.</p>
      </div>
    )
  }

  const deadlinePassed = deadlineIso ? new Date(deadlineIso) < new Date() : false
  const hasH2H = myStanding && (myStanding.h2h_wins + myStanding.h2h_draws + myStanding.h2h_losses) > 0

  // Build action items for the current round
  const squadDone = squadStatus === 'submitted' || squadStatus === 'locked'
  const actionItems: ActionItem[] = [
    {
      key: 'squad',
      label: squadStatus === 'locked'    ? 'Squad locked in'
           : squadStatus === 'submitted' ? 'Squad submitted'
           : squadStatus === 'draft'     ? 'Squad started (not yet submitted)'
           : 'Submit your squad',
      done: squadDone,
      cta: !squadDone
        ? { label: squadStatus === 'draft' ? 'Finish squad' : 'Build squad', to: season && currentRound ? `/squad?season=${season.id}&round=${currentRound}` : '/squad' }
        : undefined,
    },
    {
      key: 'predos',
      label: predosSubmitted ? 'Predictions submitted' : 'Enter your predictions',
      done: predosSubmitted || deadlinePassed,
      cta: !predosSubmitted && !deadlinePassed
        ? { label: 'Enter predos', to: '/predos' }
        : undefined,
    },
    {
      key: 'teamsheets',
      label: teamSheetsAvail ? 'Team sheets available' : 'Team sheets not yet available',
      done: teamSheetsAvail,
      cta: teamSheetsAvail
        ? { label: 'View team sheets', to: currentRound ? `/teamsheets?round=${currentRound}` : '/teamsheets' }
        : undefined,
    },
    {
      key: 'results',
      label: roundScored ? 'Round results available' : 'Round results pending',
      done: roundScored,
      cta: roundScored
        ? { label: 'View standings', to: '/standings' }
        : undefined,
    },
  ]
  // Only show pending items (plus a summary tick if everything is done)
  const pendingItems = actionItems.filter(a => !a.done || a.cta)

  // ── Logged-in hub ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 max-w-3xl">

      {/* Welcome header */}
      <div>
        <h1 className="text-2xl font-bold text-spal-yellow">
          Welcome back, {profile?.display_name ?? 'manager'}
        </h1>
        {profile?.team_name && (
          <p className="text-spal-muted text-sm mt-0.5">{profile.team_name}</p>
        )}
      </div>

      {/* Season at a glance + My position */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        <div className="bg-spal-surface rounded-lg px-5 py-4">
          <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">
            {season.year} Season
          </h2>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-spal-muted">Current round</span>
              <span className="text-spal-text font-medium">Round {currentRound}</span>
            </div>
            {deadlineIso && (
              <div className="flex justify-between text-sm">
                <span className="text-spal-muted">Squad deadline</span>
                <span className={`font-medium tabular-nums ${deadlinePassed ? 'text-spal-muted' : 'text-emerald-400'}`}>
                  {deadlinePassed ? 'Passed' : countdown(deadlineIso)}
                </span>
              </div>
            )}
          </div>
        </div>

        {myStanding ? (
          <div className="bg-spal-surface rounded-lg px-5 py-4">
            <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">
              My Position
            </h2>
            <div className="flex items-start justify-between">
              <div className="space-y-1.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-spal-yellow">
                    {myPosition ? ordinal(myPosition) : '—'}
                  </span>
                  {trend && (
                    <span className={`text-sm font-bold ${trend === 'up' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {trend === 'up' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
                <div className="text-sm">
                  <span className="text-spal-text font-medium tabular-nums">
                    {myStanding.total_points.toFixed(1)}
                  </span>
                  <span className="text-spal-muted"> pts</span>
                </div>
              </div>
              {hasH2H && (
                <div className="text-right">
                  <p className="text-xs text-spal-muted mb-1">H2H</p>
                  <p className="text-sm tabular-nums">
                    <span className="text-emerald-400">{myStanding.h2h_wins}W</span>
                    {' '}
                    <span className="text-spal-muted">{myStanding.h2h_draws}D</span>
                    {' '}
                    <span className="text-red-400">{myStanding.h2h_losses}L</span>
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-spal-surface rounded-lg px-5 py-4 flex items-center">
            <p className="text-sm text-spal-muted">No scores yet this season.</p>
          </div>
        )}
      </div>

      {/* Action items panel */}
      <div className="bg-spal-surface rounded-lg px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider">
            Round {currentRound} — this round
          </h2>
          {deadlineIso && !deadlinePassed && (
            <span className="text-xs text-emerald-400 font-medium tabular-nums">
              {countdown(deadlineIso)} until lock
            </span>
          )}
          {deadlinePassed && (
            <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-spal-muted font-medium">
              Deadline passed
            </span>
          )}
        </div>

        {pendingItems.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle2 size={16} />
            <span>All done for this round</span>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {actionItems.map(item => (
              <li key={item.key} className="flex items-center gap-3">
                {item.done ? (
                  <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-spal-cerulean shrink-0" />
                )}
                <span className={`text-sm flex-1 ${item.done ? 'text-spal-muted line-through decoration-white/20' : 'text-spal-text'}`}>
                  {item.label}
                </span>
                {item.cta && (
                  <Link
                    to={item.cta.to}
                    className="text-xs text-spal-cerulean hover:text-spal-cerulean-light transition-colors whitespace-nowrap font-medium"
                  >
                    {item.cta.label} →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-3">
        <Link
          to={season && currentRound ? `/squad?season=${season.id}&round=${currentRound}` : '/squad'}
          className="flex flex-col items-center gap-2 bg-spal-surface rounded-lg px-3 py-4 text-center border border-white/5 hover:border-spal-cerulean/40 transition-colors"
        >
          <Shield size={18} className="text-spal-cerulean" />
          <span className="text-sm font-medium text-spal-text">Submit Squad</span>
        </Link>
        <Link
          to="/predos"
          className="flex flex-col items-center gap-2 bg-spal-surface rounded-lg px-3 py-4 text-center border border-white/5 hover:border-spal-cerulean/40 transition-colors"
        >
          <Target size={18} className="text-spal-cerulean" />
          <span className="text-sm font-medium text-spal-text">Enter Predos</span>
        </Link>
        <Link
          to={currentRound ? `/teamsheets?round=${currentRound}` : '/teamsheets'}
          className="flex flex-col items-center gap-2 bg-spal-surface rounded-lg px-3 py-4 text-center border border-white/5 hover:border-spal-cerulean/40 transition-colors"
        >
          <ClipboardList size={18} className="text-spal-cerulean" />
          <span className="text-sm font-medium text-spal-text">Team Sheets</span>
        </Link>
      </div>

      {/* Mini standings + Chronicle/Insights */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">

        {allStandings.length > 0 && (
          <div className="bg-spal-surface rounded-lg px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider">Standings</h2>
              <Link to="/standings" className="text-xs text-spal-cerulean hover:text-spal-cerulean-light transition-colors">
                Full table →
              </Link>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {allStandings.map((s, i) => {
                  const isMe = s.profile_id === user?.id
                  return (
                    <tr key={s.profile_id} className={`border-b border-white/5 last:border-0 ${isMe ? 'text-spal-yellow' : ''}`}>
                      <td className="py-1.5 pr-2 text-spal-muted tabular-nums w-5">{i + 1}</td>
                      <td className={`py-1.5 pr-2 ${isMe ? 'font-semibold' : 'text-spal-text'}`}>
                        {s.display_name}
                      </td>
                      <td className="py-1.5 text-right tabular-nums font-medium">
                        {s.total_points.toFixed(1)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="space-y-4">

          {posts.length > 0 && (
            <div className="bg-spal-surface rounded-lg px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider">Chronicle</h2>
                <Link to="/chronicle" className="text-xs text-spal-cerulean hover:text-spal-cerulean-light transition-colors">
                  All posts →
                </Link>
              </div>
              <div className="space-y-3">
                {posts.map(post => (
                  <div key={post.id} className="border-b border-white/5 last:border-0 pb-3 last:pb-0">
                    <Link
                      to={`/chronicle/${post.slug}`}
                      className="text-sm font-medium text-spal-text hover:text-spal-cerulean transition-colors block"
                    >
                      {post.title}
                    </Link>
                    <p className="text-xs text-spal-muted mt-0.5">
                      {stripMarkdown(post.body).slice(0, 100)}…
                    </p>
                    <p className="text-xs text-spal-muted/60 mt-1">
                      {new Date(post.created_at).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {insights && (
            <div className="bg-spal-surface rounded-lg px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider">
                  Round {insightsRound} Insights
                </h2>
                <Link to="/insights" className="text-xs text-spal-cerulean hover:text-spal-cerulean-light transition-colors">
                  Full insights →
                </Link>
              </div>
              <div className="space-y-2">
                {insights.round.highest_scoring_manager && (
                  <div className="text-sm">
                    <span className="text-spal-muted">Top manager: </span>
                    <span className="text-spal-text font-medium">
                      {insights.round.highest_scoring_manager.name}
                    </span>
                    {insights.round.highest_scoring_manager.score != null && (
                      <span className="text-spal-muted">
                        {' '}— {insights.round.highest_scoring_manager.score.toFixed(1)} pts
                      </span>
                    )}
                  </div>
                )}
                {insights.players.one_that_got_away && (
                  <div className="text-sm">
                    <span className="text-spal-muted">One that got away: </span>
                    <span className="text-spal-text font-medium">
                      {insights.players.one_that_got_away.name}
                    </span>
                    {insights.players.one_that_got_away.points != null && (
                      <span className="text-spal-muted">
                        {' '}— {insights.players.one_that_got_away.points.toFixed(1)} pts
                      </span>
                    )}
                  </div>
                )}
                {insights.draft.best_value && (
                  <div className="text-sm">
                    <span className="text-spal-muted">Best value: </span>
                    <span className="text-spal-text font-medium">{insights.draft.best_value.name}</span>
                    <span className="text-spal-muted">
                      {' '}— {insights.draft.best_value.points_per_star.toFixed(1)} pts/★
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
