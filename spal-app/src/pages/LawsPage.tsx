import { useEffect } from 'react'

export default function LawsPage() {
  useEffect(() => { document.title = 'The Laws — SPAL' }, [])
  return (
    <div className="max-w-2xl prose-spal">
      <h1 className="text-2xl font-bold text-spal-yellow mb-1">The Laws</h1>
      <p className="text-spal-muted text-sm mb-8">
        All rules are configurable by season unless marked locked.
      </p>

      {/* ── 1. Draft ──────────────────────────────────────────────────── */}
      <Section title="1. Draft">
        <p>
          SPAL uses a <strong>linear draft</strong> — managers pick in a fixed order,
          which is set by the admin in reverse order of the previous year's standings.
        </p>

        <h3 className="text-base font-semibold text-spal-text mt-5 mb-2">Draft slots</h3>
        <p className="text-spal-muted text-sm mb-2">Each manager drafts 4 players, one per slot:</p>
        <table>
          <thead>
            <tr>
              <th>Slot</th>
              <th>Eligible positions</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Front Row</td><td>Prop, Hooker</td></tr>
            <tr><td>Back Row</td><td>Flanker, Number 8</td></tr>
            <tr><td>Outside Back</td><td>Wing, Fullback</td></tr>
            <tr><td>Weakest Nation (Wales)</td><td>Any position</td></tr>
          </tbody>
        </table>
        <p className="text-spal-muted text-sm mt-2">
          Second Rows, Scrum-halves, Fly-halves, and Centres have no dedicated draft slot —
          any manager can pick them freely in their weekly squad.
        </p>

        <h3 className="text-base font-semibold text-spal-text mt-5 mb-2">Rules</h3>
        <ul>
          <li>Drafted players are <strong>exclusive</strong> — no other manager may pick them.</li>
          <li>Maximum <strong>4 drafted players from one nation</strong> per manager.</li>
          <li>Pick timer: <strong>2 minutes</strong> (configurable by admin).</li>
          <li>A player eligible for multiple slots is assigned to whichever slot the manager chooses.</li>
        </ul>
      </Section>

      {/* ── 2. Squad ──────────────────────────────────────────────────── */}
      <Section title="2. Weekly squad">
        <p>
          Each round, every manager submits a squad of <strong>15 starters + 1 Supersub</strong>.
        </p>

        <h3 className="text-base font-semibold text-spal-text mt-5 mb-2">Position structure</h3>
        <table>
          <thead>
            <tr><th>Position</th><th>Count</th></tr>
          </thead>
          <tbody>
            <tr><td>Props</td><td>2</td></tr>
            <tr><td>Hooker</td><td>1</td></tr>
            <tr><td>Second Rows</td><td>2</td></tr>
            <tr><td>Back Rows</td><td>3</td></tr>
            <tr><td>Scrum-half</td><td>1</td></tr>
            <tr><td>Fly-half</td><td>1</td></tr>
            <tr><td>Centres</td><td>2</td></tr>
            <tr><td>Outside Backs</td><td>3</td></tr>
            <tr><td className="font-semibold">Total starters</td><td className="font-semibold">15</td></tr>
            <tr><td>Supersub</td><td>1 (any position)</td></tr>
          </tbody>
        </table>

        <h3 className="text-base font-semibold text-spal-text mt-5 mb-2">Selection rules</h3>
        <ul>
          <li>
            <strong>Italian starter rule</strong> — at least 1 Italian player must appear in the
            starting 15. This reflects the spirit of the league.
          </li>
          <li>
            <strong>Nation limit</strong> — max 4 players from one nation across the full
            16-player squad.
          </li>
          <li>
            <strong>Ownership</strong> — you may select your own drafted players and any
            undrafted players. You may not pick another manager's drafted players.
          </li>
          <li>No player may appear more than once in your squad.</li>
          <li>
            <strong>Budget</strong> — squads must stay within the season budget limit
            (default: 200 stars, matching the official game).
          </li>
          <li>
            <strong>Squad lock</strong> — squads lock at the first match kickoff of the round.
            Late submissions are blocked.
          </li>
        </ul>
      </Section>

      {/* ── 3. Captain ────────────────────────────────────────────────── */}
      <Section title="3. Captain">
        <p>
          Choose exactly <strong>1 Captain</strong> from your 15 starters.
          The captain's score is multiplied by <strong>×2</strong>.
        </p>
      </Section>

      {/* ── 4. Supersub ───────────────────────────────────────────────── */}
      <Section title="4. Supersub">
        <p>
          Your Supersub is a 16th player who sits outside the starting 15. Their points
          depend on what happens in real life:
        </p>
        <table>
          <thead>
            <tr><th>Real-life outcome</th><th>Points applied</th></tr>
          </thead>
          <tbody>
            <tr><td>Comes off the bench</td><td>score × <strong>3</strong></td></tr>
            <tr><td>Starts</td><td>score × <strong>0.5</strong></td></tr>
            <tr><td>Does not play</td><td>0</td></tr>
          </tbody>
        </table>
        <p className="text-spal-muted text-sm mt-2">
          Picking a Supersub who comes off the bench is the high-risk, high-reward play.
        </p>
      </Section>

      {/* ── 5. Scoring ────────────────────────────────────────────────── */}
      <Section title="5. Scoring">
        <p>
          Player points are imported from the official Six Nations Fantasy game and may be
          overridden by the admin. Your round score is the sum of:
        </p>
        <ul>
          <li>Each starter's final score (captain's score doubled)</li>
          <li>Supersub score with the appropriate multiplier</li>
          <li>Any admin penalties</li>
        </ul>
      </Section>

      {/* ── 6. Standings ──────────────────────────────────────────────── */}
      <Section title="6. Head-to-head standings">
        <p>
          SPAL runs a head-to-head league. Each gameweek you're matched against one (or two)
          other managers. League points are awarded based on the result:
        </p>
        <table>
          <thead>
            <tr><th>Fixture type</th><th>Result</th><th>H2H points</th></tr>
          </thead>
          <tbody>
            <tr><td rowSpan={3}>Pair</td><td>Win</td><td>4</td></tr>
            <tr><td>Draw</td><td>2</td></tr>
            <tr><td>Loss</td><td>0</td></tr>
            <tr><td rowSpan={3}>Triple (7-manager seasons)</td><td>1st</td><td>4</td></tr>
            <tr><td>2nd</td><td>2</td></tr>
            <tr><td>3rd</td><td>0</td></tr>
          </tbody>
        </table>
        <p className="text-spal-muted text-sm mt-2">
          With 7 managers each round has 3 pair fixtures and 1 triple fixture.
          The schedule is generated to rotate triple participation as evenly as possible.
        </p>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-bold text-spal-cerulean mb-3 border-b border-white/10 pb-2">
        {title}
      </h2>
      <div className="space-y-3 text-spal-text text-sm leading-relaxed [&_table]:w-full [&_table]:text-sm [&_table]:border-collapse [&_th]:text-left [&_th]:text-spal-muted [&_th]:font-normal [&_th]:pb-1 [&_th]:pr-6 [&_th]:border-b [&_th]:border-white/10 [&_td]:py-1.5 [&_td]:pr-6 [&_td]:border-b [&_td]:border-white/5 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_strong]:text-spal-text [&_p]:text-spal-muted">
        {children}
      </div>
    </section>
  )
}
