// Renders a round_insights payload. Used by both InsightsPage (/insights)
// and SeasonReviewPage (/history/:year section 7).

interface ManagerRef { profile_id: string; name: string; score?: number }
interface PlayerRef  { player_id: number; name: string; nation?: string; position?: string; points?: number; total_points?: number }

interface RoundPayload {
  highest_scoring_manager: ManagerRef | null
  lowest_scoring_manager:  ManagerRef | null
  closest_margin: { manager_a: ManagerRef & { score: number }; manager_b: ManagerRef & { score: number }; gap: number } | null
  most_improved:  { profile_id: string; name: string; prev_rank: number; new_rank: number; positions_gained: number } | null
}

interface PlayersPayload {
  highest_scorer:           PlayerRef | null
  highest_per_position:     Record<string, { player_id: number; name: string; nation: string; points: number }>
  best_supersub:            { player_id: number; name: string; nation: string; manager_name: string; raw_points: number; multiplied_points: number; multiplier: number } | null
  most_selected:            { player_id: number; name: string; nation: string; position: string; squad_count: number; total_managers: number } | null
  one_that_got_away:        PlayerRef | null
  points_pct_by_nation:     Record<string, number>
  points_pct_by_position:   Record<string, number>
}

interface DraftPayload {
  best_drafted_player: { player_id: number; name: string; drafted_by_name: string; points: number } | null
  best_draft_manager:  { profile_id: string; name: string; total_drafted_points: number } | null
  best_value:          { player_id: number; name: string; points: number; price_stars: number; points_per_star: number } | null
  zero_scorers:        Array<{ player_id: number; name: string; drafted_by_name: string; played: boolean }>
}

interface SeasonPayload {
  leader:            { profile_id: string; name: string; total_points: number; lead_over_second: number } | null
  most_consistent:   { profile_id: string; name: string; score_variance: number; round_scores: number[] } | null
  best_draft:        { profile_id: string; name: string; total_drafted_points: number } | null
  top_season_player: PlayerRef | null
}

export interface InsightPayload {
  round:          RoundPayload
  players:        PlayersPayload
  draft:          DraftPayload
  season_to_date: SeasonPayload
}

const POSITION_ORDER = [
  'Prop', 'Hooker', 'Second Row', 'Flanker', 'Number 8',
  'Scrum-half', 'Fly-half', 'Centre', 'Wing', 'Fullback',
]

function Tooltip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex items-center ml-1 group/tip align-middle">
      <span className="text-spal-cerulean text-[10px] cursor-help leading-none select-none">ⓘ</span>
      <span className="
        absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56
        bg-spal-surface border border-white/15 shadow-lg
        text-spal-text text-xs rounded px-2.5 py-1.5
        opacity-0 group-hover/tip:opacity-100
        pointer-events-none transition-opacity duration-150
        z-50 leading-relaxed normal-case tracking-normal font-normal
      ">
        {text}
      </span>
    </span>
  )
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h3 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">
      {title}
    </h3>
  )
}

function Card({ label, tooltip, children }: { label: string; tooltip?: string; children: React.ReactNode }) {
  return (
    <div className="bg-spal-surface border border-white/5 rounded-lg p-4">
      <p className="text-xs text-spal-muted uppercase tracking-wider mb-2">
        {label}{tooltip && <Tooltip text={tooltip} />}
      </p>
      {children}
    </div>
  )
}

function fmt(n: number) { return Number(n).toFixed(1) }

export default function InsightsPanel({ payload }: { payload: InsightPayload }) {
  const { round, players, draft, season_to_date } = payload

  // Sorted position list (only positions that have data)
  const posEntries = POSITION_ORDER
    .filter(p => players.highest_per_position[p])
    .map(p => ({ pos: p, ...players.highest_per_position[p] }))

  // Nation/position pct bars — sorted descending
  const nationBars = Object.entries(players.points_pct_by_nation ?? {}).sort((a, b) => b[1] - a[1])
  const posBars    = Object.entries(players.points_pct_by_position ?? {}).sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-10">

      {/* ── Round performance ─────────────────────────────────── */}
      <div>
        <SectionTitle title="Round performance" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {round.highest_scoring_manager && (
            <Card
              label="Highest score"
              tooltip="The manager who scored the most fantasy points this round across all three matches"
            >
              <p className="text-2xl font-bold text-spal-yellow tabular-nums">
                {fmt(round.highest_scoring_manager.score ?? 0)}
              </p>
              <p className="text-sm text-spal-text mt-1">{round.highest_scoring_manager.name}</p>
            </Card>
          )}
          {round.lowest_scoring_manager && (
            <Card
              label="Lowest score"
              tooltip="The manager who scored the fewest fantasy points this round"
            >
              <p className="text-2xl font-bold text-spal-muted tabular-nums">
                {fmt(round.lowest_scoring_manager.score ?? 0)}
              </p>
              <p className="text-sm text-spal-text mt-1">{round.lowest_scoring_manager.name}</p>
            </Card>
          )}
          {round.closest_margin && (
            <Card
              label="Closest margin"
              tooltip="The two managers whose round scores were closest to each other"
            >
              <p className="text-2xl font-bold text-spal-cerulean tabular-nums">
                {fmt(round.closest_margin.gap)}
              </p>
              <p className="text-xs text-spal-muted mt-1">
                {round.closest_margin.manager_a.name} <span className="tabular-nums">({fmt(round.closest_margin.manager_a.score)})</span>
                {' vs '}
                {round.closest_margin.manager_b.name} <span className="tabular-nums">({fmt(round.closest_margin.manager_b.score)})</span>
              </p>
            </Card>
          )}
          {round.most_improved && (
            <Card
              label="Most improved"
              tooltip="The manager who moved up the most positions in the league table this round"
            >
              <p className="text-lg font-bold text-spal-success">
                ↑{round.most_improved.positions_gained}
              </p>
              <p className="text-sm text-spal-text mt-1">{round.most_improved.name}</p>
              <p className="text-xs text-spal-muted">
                {ordinal(round.most_improved.prev_rank)} → {ordinal(round.most_improved.new_rank)}
              </p>
            </Card>
          )}
          {!round.highest_scoring_manager && !round.closest_margin && (
            <p className="text-spal-muted text-sm col-span-full">No manager scores recorded for this round yet.</p>
          )}
        </div>
      </div>

      {/* ── Player highlights ─────────────────────────────────── */}
      <div>
        <SectionTitle title="Player highlights" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          {players.highest_scorer && (
            <Card
              label="Top scorer"
              tooltip="The player who scored the most official fantasy points across all matches this round"
            >
              <p className="text-2xl font-bold text-spal-yellow tabular-nums">{fmt(players.highest_scorer.points ?? 0)}</p>
              <p className="text-sm text-spal-text mt-1">{players.highest_scorer.name}</p>
              <p className="text-xs text-spal-muted">{players.highest_scorer.nation} · {players.highest_scorer.position}</p>
            </Card>
          )}
          {players.most_selected && (
            <Card
              label="Most selected"
              tooltip="The player chosen by the most managers in their squad this round"
            >
              <p className="text-2xl font-bold text-spal-cerulean tabular-nums">
                {players.most_selected.squad_count}/{players.most_selected.total_managers}
              </p>
              <p className="text-sm text-spal-text mt-1">{players.most_selected.name}</p>
              <p className="text-xs text-spal-muted">{players.most_selected.nation} · {players.most_selected.position}</p>
            </Card>
          )}
          {players.one_that_got_away && (
            <Card
              label="One that got away"
              tooltip="The highest scoring player this round who was not selected by any manager"
            >
              <p className="text-2xl font-bold text-red-400 tabular-nums">{fmt(players.one_that_got_away.points ?? 0)}</p>
              <p className="text-sm text-spal-text mt-1">{players.one_that_got_away.name}</p>
              <p className="text-xs text-spal-muted">{players.one_that_got_away.nation} · {players.one_that_got_away.position}</p>
            </Card>
          )}
          {players.best_supersub && (
            <Card
              label="Best supersub"
              tooltip="The supersub who delivered the biggest points boost — supersubs score 3x points if they come off the bench"
            >
              <p className="text-2xl font-bold text-spal-yellow tabular-nums">{fmt(players.best_supersub.multiplied_points)}</p>
              <p className="text-sm text-spal-text mt-1">{players.best_supersub.name}</p>
              <p className="text-xs text-spal-muted">
                {players.best_supersub.raw_points} pts × {players.best_supersub.multiplier} · {players.best_supersub.manager_name}
              </p>
            </Card>
          )}
        </div>

        {/* Top per position */}
        {posEntries.length > 0 && (
          <div className="bg-spal-surface border border-white/5 rounded-lg">
            <p className="text-xs text-spal-muted uppercase tracking-wider px-4 pt-3 pb-2">
              Best per position
              <Tooltip text="The top scoring player in each position for this round" />
            </p>
            <table className="w-full text-sm">
              <tbody>
                {posEntries.map(({ pos, name, nation, points }) => (
                  <tr key={pos} className="border-t border-white/5">
                    <td className="py-2 pl-4 pr-4 text-spal-muted text-xs w-28">{pos}</td>
                    <td className="py-2 pr-4 text-spal-text font-medium">{name}</td>
                    <td className="py-2 pr-4 text-spal-muted text-xs hidden sm:table-cell">{nation}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-spal-text">{fmt(points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Points % bars */}
        {(nationBars.length > 0 || posBars.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            {nationBars.length > 0 && (
              <div className="bg-spal-surface border border-white/5 rounded-lg p-4">
                <p className="text-xs text-spal-muted uppercase tracking-wider mb-3">
                  Points share by nation
                  <Tooltip text="Share of total SPAL fantasy points contributed by each nation's players this round" />
                </p>
                <div className="space-y-2">
                  {nationBars.map(([nation, pct]) => (
                    <div key={nation}>
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="text-spal-text">{nation}</span>
                        <span className="text-spal-muted tabular-nums">{fmt(pct)}%</span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-spal-cerulean rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {posBars.length > 0 && (
              <div className="bg-spal-surface border border-white/5 rounded-lg p-4">
                <p className="text-xs text-spal-muted uppercase tracking-wider mb-3">
                  Points share by position
                  <Tooltip text="Share of total SPAL fantasy points contributed by each position group this round" />
                </p>
                <div className="space-y-2">
                  {posBars.map(([pos, pct]) => (
                    <div key={pos}>
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="text-spal-text">{pos}</span>
                        <span className="text-spal-muted tabular-nums">{fmt(pct)}%</span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-spal-yellow rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Draft ─────────────────────────────────────────────── */}
      <div>
        <SectionTitle title="Draft" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {draft.best_drafted_player && (
            <Card
              label="Best drafted player"
              tooltip="The highest scoring player this round who was selected in the draft"
            >
              <p className="text-2xl font-bold text-spal-yellow tabular-nums">{fmt(draft.best_drafted_player.points)}</p>
              <p className="text-sm text-spal-text mt-1">{draft.best_drafted_player.name}</p>
              <p className="text-xs text-spal-muted">Drafted by {draft.best_drafted_player.drafted_by_name}</p>
            </Card>
          )}
          {draft.best_draft_manager && (
            <Card
              label="Best draft return"
              tooltip="The manager whose drafted players combined for the most points this round"
            >
              <p className="text-2xl font-bold text-spal-cerulean tabular-nums">{fmt(draft.best_draft_manager.total_drafted_points)}</p>
              <p className="text-sm text-spal-text mt-1">{draft.best_draft_manager.name}</p>
              <p className="text-xs text-spal-muted">Total from drafted players</p>
            </Card>
          )}
          {draft.best_value && (
            <Card
              label="Best value"
              tooltip="The player who delivered the most points per star of their price this round"
            >
              <p className="text-2xl font-bold text-spal-success tabular-nums">{fmt(draft.best_value.points_per_star)}</p>
              <p className="text-xs text-spal-muted">pts/★</p>
              <p className="text-sm text-spal-text mt-1">{draft.best_value.name}</p>
              <p className="text-xs text-spal-muted">{fmt(draft.best_value.points)} pts · ★{draft.best_value.price_stars}</p>
            </Card>
          )}
          {!draft.best_drafted_player && !draft.best_draft_manager && (
            <p className="text-spal-muted text-sm col-span-full">No draft data for this round.</p>
          )}
        </div>
        {draft.zero_scorers.length > 0 && (
          <div className="mt-3 bg-spal-surface border border-white/5 rounded-lg p-4">
            <p className="text-xs text-spal-muted uppercase tracking-wider mb-2">
              Drafted players who scored 0 ({draft.zero_scorers.length})
              <Tooltip text="Drafted players who scored zero points this round — either didn't play or had a poor game" />
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {draft.zero_scorers.map(z => (
                <span key={z.player_id} className="text-sm">
                  <span className="text-spal-text">{z.name}</span>
                  <span className="text-spal-muted text-xs ml-1">
                    ({z.drafted_by_name}{z.played ? ', played' : ', no appearance'})
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Season to date ────────────────────────────────────── */}
      <div>
        <SectionTitle title="Season to date" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {season_to_date.leader && (
            <Card
              label="League leader"
              tooltip="Current leader and their points advantage over second place"
            >
              <p className="text-2xl font-bold text-spal-yellow tabular-nums">{fmt(season_to_date.leader.total_points)}</p>
              <p className="text-sm text-spal-text mt-1">{season_to_date.leader.name}</p>
              {season_to_date.leader.lead_over_second > 0 && (
                <p className="text-xs text-spal-muted">Leads by {fmt(season_to_date.leader.lead_over_second)}</p>
              )}
            </Card>
          )}
          {season_to_date.most_consistent && (
            <Card
              label="Most consistent"
              tooltip="The manager with the smallest variation in their round scores — consistently solid rather than feast or famine"
            >
              <p className="text-sm text-spal-text font-semibold mt-1">{season_to_date.most_consistent.name}</p>
              <p className="text-xs text-spal-muted">
                Variance {fmt(season_to_date.most_consistent.score_variance)}
              </p>
              <p className="text-xs text-spal-muted mt-1 tabular-nums">
                {season_to_date.most_consistent.round_scores.map(s => fmt(s)).join(' · ')}
              </p>
            </Card>
          )}
          {season_to_date.best_draft && (
            <Card
              label="Best draft portfolio"
              tooltip="The manager whose drafted players have contributed the most total points across all rounds so far"
            >
              <p className="text-2xl font-bold text-spal-cerulean tabular-nums">{fmt(season_to_date.best_draft.total_drafted_points)}</p>
              <p className="text-sm text-spal-text mt-1">{season_to_date.best_draft.name}</p>
              <p className="text-xs text-spal-muted">Draft pts across all rounds</p>
            </Card>
          )}
          {season_to_date.top_season_player && (
            <Card
              label="Top season player"
              tooltip="The player who has scored the most fantasy points across all rounds this season"
            >
              <p className="text-2xl font-bold text-spal-yellow tabular-nums">{fmt(season_to_date.top_season_player.total_points ?? 0)}</p>
              <p className="text-sm text-spal-text mt-1">{season_to_date.top_season_player.name}</p>
              <p className="text-xs text-spal-muted">{season_to_date.top_season_player.nation} · {season_to_date.top_season_player.position}</p>
            </Card>
          )}
          {!season_to_date.leader && (
            <p className="text-spal-muted text-sm col-span-full">Season-to-date data will appear once rounds have been scored.</p>
          )}
        </div>
      </div>

    </div>
  )
}

function ordinal(n: number): string {
  if (n === 1) return '1st'
  if (n === 2) return '2nd'
  if (n === 3) return '3rd'
  return `${n}th`
}
