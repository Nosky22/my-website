import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../components/Toast'
import { ConfirmModal } from '../../components/ConfirmModal'

interface Season { id: number; year: number }
interface Match  { id: number; home_nation: string; away_nation: string }
interface ScoreRow {
  id: number
  player_id: number
  match_id: number
  source_points: number
  admin_override_points: number | null
  final_points: number
  status: string
  players: { display_name: string; nation: string }
}
interface MatchdayRow  { player_id: number; match_id: number; status: string }
interface PlayerOption { id: number; display_name: string; nation: string; canonical_position: string }
interface CalcScore    { profile_id: string; round_score: number }
interface CalcResult   { round_number: number; managers_scored: number; scores: CalcScore[] }
interface ProfileInfo  { display_name: string; team_name: string }
interface LockSummary  { alreadyLocked: boolean; locked?: number; copied?: number; empty?: number; error?: string }

const MATCHDAY_STATUSES = ['starting', 'bench', 'not_selected'] as const
type MatchdayStatus = (typeof MATCHDAY_STATUSES)[number]

interface ScoreForm {
  matchId: number | null
  playerId: number | null
  playerDisplayName: string
  sourcePts: string
  matchdayStatus: MatchdayStatus
}

const EMPTY_FORM: ScoreForm = {
  matchId: null, playerId: null, playerDisplayName: '', sourcePts: '', matchdayStatus: 'starting',
}

const ROUNDS = [1, 2, 3, 4, 5] as const

const MATCHDAY_LABEL: Record<string, string> = {
  starting: 'Starting', bench: 'Bench', not_selected: 'Not selected', unknown: 'Unknown',
}
const MATCHDAY_COLOUR: Record<string, string> = {
  starting: 'text-spal-success', bench: 'text-spal-warning',
  not_selected: 'text-spal-muted', unknown: 'text-spal-error',
}

export default function AdminScoresPage() {
  const { session } = useAuth()
  const { addToast } = useToast()

  // ── Selection ────────────────────────────────────────────────────
  const [seasons, setSeasons]             = useState<Season[]>([])
  const [selectedSeasonId, setSelectedSeasonId] = useState<number | null>(null)
  const [selectedRound, setSelectedRound] = useState<number | null>(null)

  // ── Round data ───────────────────────────────────────────────────
  const [matches, setMatches]       = useState<Match[]>([])
  const [scores, setScores]         = useState<ScoreRow[]>([])
  const [matchdays, setMatchdays]   = useState<MatchdayRow[]>([])
  const [roundScored, setRoundScored] = useState(false)
  const [roundFinal, setRoundFinal] = useState(false)
  const [loadingRound, setLoadingRound] = useState(false)

  // ── Score entry form ─────────────────────────────────────────────
  const [form, setForm]                   = useState<ScoreForm>(EMPTY_FORM)
  const [playerSearch, setPlayerSearch]   = useState('')
  const [playerResults, setPlayerResults] = useState<PlayerOption[]>([])
  const [showDropdown, setShowDropdown]   = useState(false)
  const [saving, setSaving]               = useState(false)
  const [saveError, setSaveError]         = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess]     = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  // ── Calculate / finalise ─────────────────────────────────────────
  const [calculating, setCalculating]     = useState(false)
  const [calcResult, setCalcResult]       = useState<CalcResult | null>(null)
  const [profiles, setProfiles]           = useState<Map<string, ProfileInfo>>(new Map())
  const [finalising, setFinalising]       = useState(false)
  const [showFinalConfirm, setShowFinalConfirm] = useState(false)

  // ── Squad locking ─────────────────────────────────────────────────
  const [squadsNeedLock, setSquadsNeedLock] = useState(false)
  const [locking, setLocking]               = useState(false)
  const [lockResult, setLockResult]         = useState<LockSummary | null>(null)
  const [lockError, setLockError]           = useState<string | null>(null)

  // ── Load seasons ─────────────────────────────────────────────────
  useEffect(() => {
    supabase.from('seasons').select('id, year').order('year', { ascending: false })
      .then(({ data }) => {
        const list = data ?? []
        setSeasons(list)
        if (list.length) setSelectedSeasonId(list[0].id)
      })
  }, [])

  // ── Load round data ──────────────────────────────────────────────
  useEffect(() => {
    if (selectedSeasonId == null || selectedRound == null) {
      setMatches([]); setScores([]); setMatchdays([]); setRoundScored(false); setRoundFinal(false)
      setCalcResult(null)
      setSquadsNeedLock(false); setLockResult(null); setLockError(null)
      return
    }
    loadRound()
  }, [selectedSeasonId, selectedRound]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadRound() {
    setLoadingRound(true)
    setCalcResult(null)
    setRoundFinal(false)
    setLockResult(null); setLockError(null)

    const { data: matchData } = await supabase
      .from('matches')
      .select('id, home_nation, away_nation, kickoff_at')
      .eq('season_id', selectedSeasonId!)
      .eq('round_number', selectedRound!)
      .order('kickoff_at')

    if (!matchData?.length) {
      setMatches([]); setScores([]); setMatchdays([]); setRoundScored(false); setRoundFinal(false)
      setSquadsNeedLock(false)
      setLoadingRound(false); return
    }

    // Earliest kickoff is the squad lock deadline for this round.
    const earliest = matchData.reduce<string | null>((acc, m) => {
      if (!m.kickoff_at) return acc
      return acc == null || m.kickoff_at < acc ? m.kickoff_at : acc
    }, null)

    setMatches(matchData.map(m => ({ id: m.id, home_nation: m.home_nation, away_nation: m.away_nation })))

    const matchIds = matchData.map(m => m.id)
    const [scoresRes, mdRes, mmsRes, squadsRes] = await Promise.all([
      supabase.from('player_match_scores')
        .select('id, player_id, match_id, source_points, admin_override_points, final_points, status, players(display_name, nation)')
        .in('match_id', matchIds),
      supabase.from('matchday_squads')
        .select('player_id, match_id, status')
        .in('match_id', matchIds),
      supabase.from('manager_match_scores')
        .select('status').in('match_id', matchIds),
      // Check if any submitted/draft squads exist for this round (deadline passed = needs lock).
      supabase.from('manager_round_squads')
        .select('id, status')
        .eq('season_id', selectedSeasonId!)
        .eq('round_number', selectedRound!)
        .neq('status', 'locked'),
    ])

    setScores((scoresRes.data ?? []) as unknown as ScoreRow[])
    setMatchdays(mdRes.data ?? [])
    const mmsRows = mmsRes.data ?? []
    const scored = mmsRows.length > 0
    setRoundScored(scored)
    setRoundFinal(scored && mmsRows.every(r => r.status === 'final'))

    // Show lock button if deadline has passed and there are non-locked squads.
    const deadlinePassed = earliest != null && earliest < new Date().toISOString()
    setSquadsNeedLock(deadlinePassed && (squadsRes.data?.length ?? 0) > 0)

    setLoadingRound(false)
  }

  // ── Derived maps ─────────────────────────────────────────────────
  const matchdayMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const md of matchdays) m.set(`${md.player_id}_${md.match_id}`, md.status)
    return m
  }, [matchdays])

  const scoresByMatch = useMemo(() => {
    const m = new Map<number, ScoreRow[]>()
    for (const s of scores) {
      if (!m.has(s.match_id)) m.set(s.match_id, [])
      m.get(s.match_id)!.push(s)
    }
    return m
  }, [scores])

  // ── Player search (debounced, only when no player is selected) ───
  useEffect(() => {
    if (form.playerId != null || !playerSearch || playerSearch.length < 2 || selectedSeasonId == null) {
      setPlayerResults([]); setShowDropdown(false); return
    }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('players')
        .select('id, display_name, nation, canonical_position')
        .eq('season_id', selectedSeasonId)
        .ilike('display_name', `%${playerSearch}%`)
        .order('display_name').limit(10)
      setPlayerResults(data ?? [])
      setShowDropdown(true)
    }, 250)
    return () => clearTimeout(t)
  }, [playerSearch, form.playerId, selectedSeasonId])

  // Close dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // ── Form actions ─────────────────────────────────────────────────
  function openAdd(matchId: number) {
    setForm({ ...EMPTY_FORM, matchId })
    setPlayerSearch(''); setShowDropdown(false)
    setSaveError(null); setSaveSuccess(false)
  }

  function openEdit(row: ScoreRow) {
    const raw = matchdayMap.get(`${row.player_id}_${row.match_id}`)
    const mdStatus: MatchdayStatus =
      raw && (MATCHDAY_STATUSES as readonly string[]).includes(raw) ? raw as MatchdayStatus : 'not_selected'
    setForm({
      matchId: row.match_id,
      playerId: row.player_id,
      playerDisplayName: row.players.display_name,
      sourcePts: String(row.source_points),
      matchdayStatus: mdStatus,
    })
    setPlayerSearch(row.players.display_name)
    setShowDropdown(false)
    setSaveError(null); setSaveSuccess(false)
  }

  function selectPlayer(p: PlayerOption) {
    setForm(f => ({ ...f, playerId: p.id, playerDisplayName: p.display_name }))
    setPlayerSearch(p.display_name); setShowDropdown(false)
  }

  function deselectPlayer() {
    setForm(f => ({ ...f, playerId: null, playerDisplayName: '' }))
    setPlayerSearch(''); setPlayerResults([])
  }

  // ── Save score ───────────────────────────────────────────────────
  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.matchId || !form.playerId || form.sourcePts === '') return
    const pts = parseFloat(form.sourcePts)
    if (isNaN(pts)) { setSaveError('Invalid points value'); return }

    setSaving(true); setSaveError(null); setSaveSuccess(false)

    const [scoreRes, mdRes] = await Promise.all([
      supabase.from('player_match_scores').upsert(
        { match_id: form.matchId, player_id: form.playerId, season_id: selectedSeasonId, source_points: pts, status: 'provisional' },
        { onConflict: 'match_id,player_id' }
      ),
      supabase.from('matchday_squads').upsert(
        { match_id: form.matchId, player_id: form.playerId, status: form.matchdayStatus, source: 'admin' },
        { onConflict: 'match_id,player_id' }
      ),
    ])

    if (scoreRes.error || mdRes.error) {
      setSaveError(scoreRes.error?.message ?? mdRes.error?.message ?? 'Save failed')
      setSaving(false); return
    }

    setSaveSuccess(true); setSaving(false)
    loadRound()
  }

  // ── Lock squads ──────────────────────────────────────────────────
  async function handleLock() {
    if (selectedSeasonId == null || selectedRound == null) return
    setLocking(true); setLockResult(null); setLockError(null)

    try {
      const jwt = session?.access_token ?? ''
      const res = await fetch('/.netlify/functions/lock-squads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwt}`,
        },
        body: JSON.stringify({ season_id: selectedSeasonId, round_number: selectedRound }),
      })
      const data = await res.json() as LockSummary | { error?: string }
      if (!res.ok) {
        setLockError(('error' in data && data.error) ? data.error : `HTTP ${res.status}`)
      } else {
        setLockResult(data as LockSummary)
        setSquadsNeedLock(false)
      }
    } catch (err) {
      setLockError(err instanceof Error ? err.message : 'Network error')
    }
    setLocking(false)
  }

  // ── Calculate scores ─────────────────────────────────────────────
  async function handleCalculate() {
    if (selectedSeasonId == null || selectedRound == null) return
    setCalculating(true); setCalcResult(null)

    const { data, error } = await supabase.functions.invoke('score-round', {
      body: { season_id: selectedSeasonId, round_number: selectedRound },
    })

    if (error) {
      let msg = error.message
      try {
        const ctx = (error as unknown as { context?: Response }).context
        if (ctx) { const b = await ctx.json(); msg = b.error ?? b.message ?? msg }
      } catch { /* use original message */ }
      addToast(msg, 'error'); setCalculating(false); return
    }

    const result = data as CalcResult
    setCalcResult(result)

    if (result.scores.length) {
      const ids = result.scores.map(s => s.profile_id)
      const { data: pd } = await supabase.from('profiles').select('id, display_name, team_name').in('id', ids)
      const m = new Map<string, ProfileInfo>()
      for (const p of pd ?? []) m.set(p.id, { display_name: p.display_name, team_name: p.team_name })
      setProfiles(m)
    }

    addToast(`Round ${result.round_number}: ${result.managers_scored} manager${result.managers_scored !== 1 ? 's' : ''} scored`, 'success')
    setRoundScored(true); setRoundFinal(false); setCalculating(false)
  }

  // ── Mark round as final ──────────────────────────────────────────
  async function handleMarkFinal() {
    if (selectedSeasonId == null || selectedRound == null) return
    const matchIds = matches.map(m => m.id)
    if (matchIds.length === 0) return
    setFinalising(true)

    const [mmsRes, standingsRes] = await Promise.all([
      supabase.from('manager_match_scores').update({ status: 'final' }).in('match_id', matchIds),
      supabase.from('season_standings').update({ last_updated_round: selectedRound }).eq('season_id', selectedSeasonId),
    ])

    setFinalising(false)
    if (mmsRes.error) { addToast(mmsRes.error.message, 'error'); return }
    if (standingsRes.error) { addToast(standingsRes.error.message, 'error'); return }

    setRoundFinal(true)
    setShowFinalConfirm(false)
    addToast(`Round ${selectedRound} marked as final`, 'success')
  }

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div>
      <h1 className="text-2xl font-bold text-spal-yellow mb-6">Scores</h1>

      {/* Season + round selectors */}
      <div className="flex items-center gap-6 mb-8 flex-wrap">
        <div className="flex items-center gap-3">
          <label htmlFor="season-sel" className="text-sm text-spal-muted">Season</label>
          <select
            id="season-sel"
            value={selectedSeasonId ?? ''}
            onChange={e => { setSelectedSeasonId(Number(e.target.value)); setSelectedRound(null) }}
            className={selectClass}
          >
            {seasons.map(s => <option key={s.id} value={s.id}>{s.year}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-spal-muted">Round</span>
          {ROUNDS.map(r => (
            <button key={r} onClick={() => setSelectedRound(r)} className={roundBtnClass(selectedRound === r)}>
              R{r}
            </button>
          ))}
        </div>

        {selectedRound != null && (
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${
            roundFinal    ? 'bg-spal-success/20 text-spal-success' :
            roundScored   ? 'bg-amber-500/20 text-amber-400'       :
                            'bg-white/10 text-spal-muted'
          }`}>
            {roundFinal ? '● Final' : roundScored ? '● Provisional' : '○ Not scored'}
          </span>
        )}
      </div>

      {/* Content area */}
      {selectedRound == null ? (
        <p className="text-spal-muted text-sm">Select a round to view and edit scores.</p>
      ) : loadingRound ? (
        <p className="text-spal-muted text-sm">Loading…</p>
      ) : matches.length === 0 ? (
        <p className="text-spal-muted text-sm">
          No matches found for round {selectedRound}. Add them via the Seasons page.
        </p>
      ) : (
        <div className="flex flex-col md:flex-row gap-8 items-start">

          {/* Left: match panels + calculate */}
          <div className="flex-1 min-w-0 space-y-4">
            {matches.map(match => {
              const rowList = (scoresByMatch.get(match.id) ?? [])
                .slice()
                .sort((a, b) => a.players.display_name.localeCompare(b.players.display_name))
              return (
                <section key={match.id} className="bg-spal-surface rounded p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold text-spal-text">
                      {match.home_nation}{' '}
                      <span className="text-spal-muted font-normal text-sm">vs</span>{' '}
                      {match.away_nation}
                    </h2>
                    <button
                      onClick={() => openAdd(match.id)}
                      className="text-xs text-spal-cerulean border border-spal-cerulean/30 rounded px-2.5 py-1 hover:bg-spal-cerulean/10 transition-colors"
                    >
                      + Add score
                    </button>
                  </div>

                  {rowList.length === 0 ? (
                    <p className="text-spal-muted text-sm">No scores entered yet.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-spal-muted border-b border-white/10">
                          <th className="pb-2 pr-4 font-normal">Player</th>
                          <th className="pb-2 pr-4 font-normal">Status</th>
                          <th className="pb-2 pr-4 font-normal text-right tabular-nums">Source</th>
                          <th className="pb-2 pr-4 font-normal text-right tabular-nums">Final</th>
                          <th className="pb-2 font-normal"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rowList.map(row => {
                          const mdStatus = matchdayMap.get(`${row.player_id}_${row.match_id}`)
                          const hasOverride = row.admin_override_points != null
                          return (
                            <tr key={row.id} className="border-b border-white/5">
                              <td className="py-2 pr-4 text-spal-text">{row.players.display_name}</td>
                              <td className={`py-2 pr-4 text-xs ${MATCHDAY_COLOUR[mdStatus ?? ''] ?? 'text-spal-muted'}`}>
                                {MATCHDAY_LABEL[mdStatus ?? ''] ?? '—'}
                              </td>
                              <td className="py-2 pr-4 text-right tabular-nums text-spal-muted">{row.source_points}</td>
                              <td className={`py-2 pr-4 text-right tabular-nums font-medium ${hasOverride ? 'text-spal-warning' : 'text-spal-text'}`}>
                                {row.final_points}
                                {hasOverride && (
                                  <span className="text-xs text-spal-warning ml-1" title={`Override: ${row.admin_override_points}`}>*</span>
                                )}
                              </td>
                              <td className="py-2">
                                <button
                                  onClick={() => openEdit(row)}
                                  className="text-xs text-spal-cerulean hover:text-spal-cerulean-light transition-colors"
                                >
                                  Edit
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </section>
              )
            })}

            {/* Lock squads section — visible when deadline has passed and squads need locking */}
            {(squadsNeedLock || lockResult != null || lockError != null) && (
              <section className="bg-spal-surface rounded p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="font-semibold text-spal-text">Lock squads</h2>
                    <p className="text-xs text-spal-muted mt-0.5">
                      {squadsNeedLock
                        ? 'Deadline has passed — submitted squads will be locked; managers without a submission will have their previous round squad rolled over.'
                        : 'Squads locked for this round.'}
                    </p>
                  </div>
                  {squadsNeedLock && (
                    <button onClick={handleLock} disabled={locking} className={`${submitClass} px-5`}>
                      {locking ? 'Locking…' : 'Lock round'}
                    </button>
                  )}
                </div>

                {lockError && (
                  <div className="bg-spal-error/10 border border-spal-error/30 rounded p-3 text-sm text-spal-error">
                    {lockError}
                  </div>
                )}

                {lockResult && !lockResult.alreadyLocked && (
                  <div className="text-sm space-y-1">
                    {lockResult.error ? (
                      <p className="text-spal-error">{lockResult.error}</p>
                    ) : (
                      <>
                        {(lockResult.locked ?? 0) > 0 && (
                          <p className="text-spal-text">{lockResult.locked} squad{lockResult.locked !== 1 ? 's' : ''} locked in place</p>
                        )}
                        {(lockResult.copied ?? 0) > 0 && (
                          <p className="text-spal-muted">{lockResult.copied} squad{lockResult.copied !== 1 ? 's' : ''} copied from previous round</p>
                        )}
                        {(lockResult.empty ?? 0) > 0 && (
                          <p className="text-spal-warning">{lockResult.empty} empty placeholder squad{lockResult.empty !== 1 ? 's' : ''} created (no previous round found)</p>
                        )}
                      </>
                    )}
                  </div>
                )}

                {lockResult?.alreadyLocked && (
                  <p className="text-spal-muted text-sm">All squads for this round are already locked.</p>
                )}
              </section>
            )}

            {/* Finalise section — shown after scoring, before final */}
            {roundScored && !roundFinal && (
              <section className="bg-spal-surface rounded p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-spal-text">Finalise round</h2>
                    <p className="text-xs text-spal-muted mt-0.5">
                      Lock in all scores once you're satisfied they're correct.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowFinalConfirm(true)}
                    disabled={finalising}
                    className={`${submitClass} px-5`}
                  >
                    {finalising ? 'Finalising…' : 'Mark as final'}
                  </button>
                </div>
              </section>
            )}

            {/* Calculate section */}
            <section className="bg-spal-surface rounded p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-spal-text">Calculate scores</h2>
                  <p className="text-xs text-spal-muted mt-0.5">
                    Runs scoring for all submitted squads and updates H2H standings.
                  </p>
                </div>
                <button onClick={handleCalculate} disabled={calculating} className={`${submitClass} px-5`}>
                  {calculating ? 'Calculating…' : 'Calculate scores'}
                </button>
              </div>

              {calcResult && (
                <div>
                  <p className="text-xs text-spal-muted mb-3">
                    {calcResult.managers_scored} manager{calcResult.managers_scored !== 1 ? 's' : ''} scored
                    — round {calcResult.round_number}
                  </p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-spal-muted border-b border-white/10">
                        <th className="pb-2 pr-6 font-normal">Manager</th>
                        <th className="pb-2 pr-6 font-normal">Team</th>
                        <th className="pb-2 font-normal text-right tabular-nums">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calcResult.scores.map((s, i) => {
                        const p = profiles.get(s.profile_id)
                        return (
                          <tr key={s.profile_id} className="border-b border-white/5">
                            <td className="py-2 pr-6">
                              <span className={`mr-2 tabular-nums ${i === 0 ? 'text-spal-yellow' : 'text-spal-muted'}`}>
                                {i + 1}.
                              </span>
                              <span className="text-spal-text">{p?.display_name ?? s.profile_id}</span>
                            </td>
                            <td className="py-2 pr-6 text-spal-muted text-xs">{p?.team_name ?? '—'}</td>
                            <td className="py-2 text-right tabular-nums font-medium text-spal-text">
                              {s.round_score}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {/* Right: score entry form */}
          <aside className="w-full md:w-72 md:shrink-0">
            <section className="bg-spal-surface rounded p-5 md:sticky md:top-6">
              <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-4">
                Score entry
              </h2>

              {form.matchId == null ? (
                <p className="text-spal-muted text-sm">
                  Click "+ Add score" on a match or "Edit" on a player row to begin.
                </p>
              ) : (
                <form onSubmit={handleSave} className="space-y-4">
                  <Field label="Match" htmlFor="f-match">
                    <select
                      id="f-match"
                      value={form.matchId}
                      onChange={e => {
                        setForm(f => ({ ...f, matchId: Number(e.target.value), playerId: null, playerDisplayName: '' }))
                        setPlayerSearch('')
                      }}
                      className={inputClass}
                    >
                      {matches.map(m => (
                        <option key={m.id} value={m.id}>{m.home_nation} vs {m.away_nation}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Player" htmlFor="f-player">
                    <div className="relative" ref={searchRef}>
                      <input
                        id="f-player"
                        type="text"
                        value={playerSearch}
                        onChange={e => {
                          setPlayerSearch(e.target.value)
                          if (form.playerId != null) setForm(f => ({ ...f, playerId: null, playerDisplayName: '' }))
                        }}
                        placeholder="Search by name…"
                        autoComplete="off"
                        className={inputClass}
                      />
                      {form.playerId != null && (
                        <button
                          type="button"
                          onClick={deselectPlayer}
                          title="Clear player"
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-spal-muted hover:text-spal-text leading-none text-base"
                        >
                          ×
                        </button>
                      )}
                      {showDropdown && playerResults.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-spal-surface border border-white/10 rounded shadow-lg max-h-48 overflow-y-auto">
                          {playerResults.map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onMouseDown={() => selectPlayer(p)}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors"
                            >
                              <span className="text-spal-text">{p.display_name}</span>
                              <span className="text-xs text-spal-muted ml-2">
                                {p.nation} · {p.canonical_position}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {form.playerId != null && (
                      <p className="text-xs text-spal-success mt-1">✓ {form.playerDisplayName}</p>
                    )}
                  </Field>

                  <Field label="Source points" htmlFor="f-pts">
                    <input
                      id="f-pts"
                      type="number"
                      step="0.5"
                      value={form.sourcePts}
                      onChange={e => setForm(f => ({ ...f, sourcePts: e.target.value }))}
                      placeholder="e.g. 12"
                      required
                      className={inputClass}
                    />
                  </Field>

                  <Field label="Matchday status" htmlFor="f-md-status">
                    <select
                      id="f-md-status"
                      value={form.matchdayStatus}
                      onChange={e => setForm(f => ({ ...f, matchdayStatus: e.target.value as MatchdayStatus }))}
                      className={inputClass}
                    >
                      <option value="starting">Starting (1–15)</option>
                      <option value="bench">Bench (16–23)</option>
                      <option value="not_selected">Not selected</option>
                    </select>
                  </Field>

                  {saveError   && <p className="text-spal-error   text-xs">{saveError}</p>}
                  {saveSuccess && <p className="text-spal-success text-xs">Saved.</p>}

                  <div className="flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={saving || form.playerId == null || form.sourcePts === ''}
                      className={submitClass}
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setForm(EMPTY_FORM)
                        setPlayerSearch('')
                        setSaveSuccess(false); setSaveError(null)
                      }}
                      className="text-sm text-spal-muted hover:text-spal-text transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                </form>
              )}
            </section>
          </aside>
        </div>
      )}

      <ConfirmModal
        open={showFinalConfirm}
        title={`Mark Round ${selectedRound} as final?`}
        message="This confirms all scores are correct. You can still make corrections afterwards by re-running score calculation."
        confirmLabel="Mark as final"
        onConfirm={handleMarkFinal}
        onCancel={() => setShowFinalConfirm(false)}
      />
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm text-spal-muted mb-1">{label}</label>
      {children}
    </div>
  )
}

function roundBtnClass(active: boolean) {
  return `px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
    active
      ? 'border-spal-cerulean bg-spal-cerulean/10 text-spal-cerulean'
      : 'border-white/10 text-spal-muted hover:border-white/30 hover:text-spal-text'
  }`
}

const inputClass  = 'w-full bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
const selectClass = 'bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
const submitClass = 'bg-spal-cerulean text-white text-sm rounded px-4 py-1.5 hover:bg-spal-cerulean-light disabled:opacity-50 transition-colors'
