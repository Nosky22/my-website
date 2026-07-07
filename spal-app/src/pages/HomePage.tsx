import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import type { InsightPayload } from '../components/InsightsPanel'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorCard from '../components/ErrorCard'

interface Season { id: number; year: number }

interface Post {
  id: number
  title: string
  slug: string
  body: string
  created_at: string
}

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

// ── Simple nav card used for League and More groups ───────────────────────────

function NavCard({ to, label, desc }: { to: string; label: string; desc: string }) {
  return (
    <Link
      to={to}
      className="block p-4 bg-spal-surface rounded-lg border border-white/5 hover:border-spal-cerulean/30 transition-colors group"
    >
      <p className="text-sm font-medium text-spal-text group-hover:text-spal-cerulean transition-colors">
        {label}
      </p>
      <p className="text-xs text-spal-muted mt-0.5">{desc}</p>
    </Link>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function HomePage() {
  useEffect(() => { document.title = 'SPAL — Sergio Parisse Appreciation League' }, [])
  const { user, profile, loading: authLoading } = useAuth()

  const [hubLoading, setHubLoading]     = useState(true)
  const [error, setError]               = useState(false)
  const [season, setSeason]             = useState<Season | null>(null)
  const [currentRound, setCurrentRound] = useState<number | null>(null)
  const [deadlineIso, setDeadlineIso]   = useState<string | null>(null)
  const [posts, setPosts]               = useState<Post[]>([])
  const [insights, setInsights]         = useState<InsightPayload | null>(null)
  const [insightsRound, setInsightsRound] = useState<number | null>(null)
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
      { data: postRows, error: err2 },
      { data: insightRow, error: err3 },
    ] = await Promise.all([
      supabase
        .from('matches')
        .select('round_number, kickoff_at')
        .eq('season_id', seasonData.id)
        .order('round_number').order('kickoff_at'),

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

    if (err1 || err2 || err3) { setError(true); setHubLoading(false); return }

    // Derive current round
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

    // Fetch round match IDs for action item checks
    const { data: roundMatchRows } = await supabase
      .from('matches')
      .select('id')
      .eq('season_id', seasonData.id)
      .eq('round_number', activeRound)
    const roundIds = (roundMatchRows ?? []).map(m => m.id as number)

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
        .eq('round_number', activeRound)
        .maybeSingle(),
      roundIds.length > 0
        ? supabase.from('predo_predictions').select('id').eq('profile_id', user!.id).in('match_id', roundIds).limit(1)
        : Promise.resolve({ data: [] }),
      roundIds.length > 0
        ? supabase.from('matchday_squads').select('id').in('match_id', roundIds).limit(1)
        : Promise.resolve({ data: [] }),
      roundIds.length > 0
        ? supabase.from('manager_match_scores').select('id').in('match_id', roundIds).limit(1)
        : Promise.resolve({ data: [] }),
    ])

    const sq = mySquadRow as { status: string; locked_at: string | null } | null
    const sqStatus: 'none' | 'draft' | 'submitted' | 'locked' =
      !sq            ? 'none'
      : sq.locked_at ? 'locked'
      : sq.status === 'submitted' ? 'submitted'
      : 'draft'
    setSquadStatus(sqStatus)
    setPredosSubmitted((myPredoRows?.length ?? 0) > 0)
    setTeamSheetsAvail((tsRows?.length ?? 0) > 0)
    setRoundScored((scoredRows?.length ?? 0) > 0)

    setPosts((postRows ?? []) as Post[])
    if (insightRow) {
      setInsights(insightRow.payload as InsightPayload)
      setInsightsRound(insightRow.round_number as number)
    }

    setHubLoading(false)
  }

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
        ? { label: squadStatus === 'draft' ? 'Finish squad' : 'Build squad', to: `/squad?season=${season.id}&round=${currentRound}` }
        : undefined,
    },
    {
      key: 'predos',
      label: predosSubmitted ? 'Predictions submitted' : 'Enter your predictions',
      done: predosSubmitted || deadlinePassed,
      cta: !predosSubmitted && !deadlinePassed ? { label: 'Enter predos', to: '/predos' } : undefined,
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
      cta: roundScored ? { label: 'View standings', to: '/standings' } : undefined,
    },
  ]
  const pendingItems = actionItems.filter(a => !a.done || a.cta)

  const squadTo = `/squad?season=${season.id}&round=${currentRound}`

  return (
    <div className="space-y-6 max-w-3xl">

      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-spal-yellow">
          Welcome back, {profile?.display_name ?? 'manager'}
        </h1>
        {profile?.team_name && (
          <p className="text-spal-muted text-sm mt-0.5">{profile.team_name}</p>
        )}
      </div>

      {/* Season at a glance */}
      <div className="bg-spal-surface rounded-lg px-5 py-4">
        <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">
          {season.year} Season · Round {currentRound}
        </h2>
        {deadlineIso ? (
          <div className="flex justify-between text-sm">
            <span className="text-spal-muted">Squad deadline</span>
            <span className={`font-medium tabular-nums ${deadlinePassed ? 'text-spal-muted' : 'text-emerald-400'}`}>
              {deadlinePassed ? 'Passed' : countdown(deadlineIso)}
            </span>
          </div>
        ) : (
          <p className="text-sm text-spal-muted">No kickoff times set yet.</p>
        )}
      </div>

      {/* Action items panel */}
      <div className="bg-spal-surface rounded-lg px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider">
            Round {currentRound} — status
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

      {/* ── Quick links: This Round ────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">This Round</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

          {/* Squad */}
          <Link
            to={squadTo}
            className="block p-4 bg-spal-surface rounded-lg border border-white/5 hover:border-spal-cerulean/30 transition-colors group"
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <span className="text-sm font-medium text-spal-text group-hover:text-spal-cerulean transition-colors">
                {squadDone ? 'View Squad' : squadStatus === 'draft' ? 'Edit Squad' : 'Submit Squad'}
              </span>
              {squadStatus === 'locked' && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-spal-muted shrink-0">Locked</span>
              )}
              {squadStatus === 'submitted' && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 shrink-0">Submitted ✓</span>
              )}
              {squadStatus === 'draft' && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 shrink-0">Draft saved</span>
              )}
              {squadStatus === 'none' && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-spal-cerulean/15 text-spal-cerulean shrink-0">To do</span>
              )}
            </div>
            <p className="text-xs text-spal-muted">Build your starting XV for Round {currentRound}</p>
          </Link>

          {/* Predos */}
          <Link
            to="/predos"
            className="block p-4 bg-spal-surface rounded-lg border border-white/5 hover:border-spal-cerulean/30 transition-colors group"
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <span className="text-sm font-medium text-spal-text group-hover:text-spal-cerulean transition-colors">
                Enter Predos
              </span>
              {predosSubmitted ? (
                <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 shrink-0">Submitted ✓</span>
              ) : deadlinePassed ? (
                <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-spal-muted shrink-0">Closed</span>
              ) : (
                <span className="text-xs px-1.5 py-0.5 rounded bg-spal-cerulean/15 text-spal-cerulean shrink-0">To do</span>
              )}
            </div>
            <p className="text-xs text-spal-muted">Predict this round's results</p>
          </Link>

          {/* Team Sheets */}
          <Link
            to={currentRound ? `/teamsheets?round=${currentRound}` : '/teamsheets'}
            className="block p-4 bg-spal-surface rounded-lg border border-white/5 hover:border-spal-cerulean/30 transition-colors group"
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <span className="text-sm font-medium text-spal-text group-hover:text-spal-cerulean transition-colors">
                Team Sheets
              </span>
              {teamSheetsAvail ? (
                <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 shrink-0">Available ✓</span>
              ) : (
                <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-spal-muted shrink-0">Not yet</span>
              )}
            </div>
            <p className="text-xs text-spal-muted">See who's playing for each nation</p>
          </Link>

        </div>
      </div>

      {/* ── Quick links: League ────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">League</h2>
        <div className="grid grid-cols-3 gap-3">
          <NavCard to="/standings" label="Standings" desc="Season league table" />
          <NavCard to="/h2h"       label="H2H Cup"   desc="Head-to-head results" />
          <NavCard to="/players"   label="Players"   desc="Player pool and prices" />
        </div>
      </div>

      {/* ── Quick links: More ──────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">More</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <NavCard to="/draft"     label="Draft Board" desc="Full draft order" />
          <NavCard to="/history"   label="History"     desc="Previous seasons" />
          <NavCard to="/chronicle" label="Chronicle"   desc="League posts" />
          <NavCard to="/insights"  label="Insights"    desc="Round highlights" />
        </div>
      </div>

      {/* ── Chronicle & Insights ──────────────────────────────────────────── */}
      {(posts.length > 0 || insights) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">

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
      )}
    </div>
  )
}
