import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../components/Toast'
import { ConfirmModal } from '../../components/ConfirmModal'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorCard from '../../components/ErrorCard'

interface Season { id: number; year: number }
interface Match  { id: number; home_nation: string; away_nation: string }
interface PredoResultRow  { match_id: number; actual_winner: string; actual_margin: number }
interface PredoResultForm { winner: string; margin: string }
interface PredoCalcScore  { profile_id: string; winning_team_points: number; margin_points: number; total_points: number }
interface PredoCalcResult { round_number: number; managers_scored: number; scores: PredoCalcScore[] }
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
interface ManagerOption { id: string; display_name: string }
interface PenaltyRow   { id: number; profile_id: string; penalty_type: string; description: string; points_adjustment: number; created_by: string }
interface PenaltyForm  { profileId: string; penaltyType: string; description: string; points: string }

const MATCHDAY_STATUSES = ['starting', 'bench', 'not_selected'] as const
type MatchdayStatus = (typeof MATCHDAY_STATUSES)[number]

interface ScoreForm {
  matchId: number | null
  playerId: number | null
  playerDisplayName: string
  sourcePts: string
  overridePts: string
  overrideReason: string
  matchdayStatus: MatchdayStatus
}

const EMPTY_FORM: ScoreForm = {
  matchId: null, playerId: null, playerDisplayName: '', sourcePts: '',
  overridePts: '', overrideReason: '', matchdayStatus: 'starting',
}

const EMPTY_PENALTY_FORM: PenaltyForm = {
  profileId: '', penaltyType: 'admin_correction', description: '', points: '',
}

const PENALTY_TYPES = [
  { value: 'late_submission',  label: 'Late submission'  },
  { value: 'rules_breach',     label: 'Rules breach'     },
  { value: 'admin_correction', label: 'Admin correction' },
  { value: 'bonus',            label: 'Bonus'            },
] as const

const ROUNDS = [1, 2, 3, 4, 5] as const

const MATCHDAY_LABEL: Record<string, string> = {
  starting: 'Starting', bench: 'Bench', not_selected: 'Not selected', unknown: 'Unknown',
}
const MATCHDAY_COLOUR: Record<string, string> = {
  starting: 'text-spal-success', bench: 'text-spal-warning',
  not_selected: 'text-spal-muted', unknown: 'text-spal-error',
}

export default function AdminScoresPage() {
  const { user, session } = useAuth()
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
  const [roundError, setRoundError] = useState(false)

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

  // ── Penalties & adjustments ───────────────────────────────────────
  const [allManagers, setAllManagers]       = useState<ManagerOption[]>([])
  const [penalties, setPenalties]           = useState<PenaltyRow[]>([])
  const [penaltyForm, setPenaltyForm]       = useState<PenaltyForm>(EMPTY_PENALTY_FORM)
  const [addingPenalty, setAddingPenalty]   = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)

  // ── Generate insights ────────────────────────────────────────────
  const [generatingInsights, setGeneratingInsights] = useState(false)
  const [insightsMsg, setInsightsMsg]               = useState<string | null>(null)

  // ── Predo results ─────────────────────────────────────────────
  const [predoResults, setPredoResults]       = useState<PredoResultRow[]>([])
  const [predoForms, setPredoForms]           = useState<Record<number, PredoResultForm>>({})
  const [savingPredos, setSavingPredos]       = useState(false)
  const [predoSaveMsg, setPredoSaveMsg]       = useState<string | null>(null)
  const [calcPredos, setCalcPredos]           = useState(false)
  const [predoCalcResult, setPredoCalcResult] = useState<PredoCalcResult | null>(null)

  // ── Load seasons ─────────────────────────────────────────────────
  useEffect(() => {
    supabase.from('seasons').select('id, year').order('year', { ascending: false })
      .then(({ data }) => {
        const list = data ?? []
        setSeasons(list)
        if (list.length) setSelectedSeasonId(list[0].id)
      })
  }, [])

  // ── Load managers (for penalty dropdown) ────────────────────────
  useEffect(() => {
    if (selectedSeasonId == null) return
    supabase.from('profiles').select('id, display_name').order('display_name')
      .then(({ data }) => setAllManagers(data ?? []))
  }, [selectedSeasonId])

  // ── Load round data ──────────────────────────────────────────────
  useEffect(() => {
    if (selectedSeasonId == null || selectedRound == null) {
      setMatches([]); setScores([]); setMatchdays([]); setRoundScored(false); setRoundFinal(false)
      setCalcResult(null)
      setSquadsNeedLock(false); setLockResult(null); setLockError(null)
      setPenalties([])
      setPredoResults([]); setPredoForms({}); setPredoCalcResult(null); setPredoSaveMsg(null)
      return
    }
    loadRound()
  }, [selectedSeasonId, selectedRound]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadRound() {
    setLoadingRound(true)
    setRoundError(false)
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

    if (scoresRes.error || mdRes.error || mmsRes.error || squadsRes.error) {
      setRoundError(true); setLoadingRound(false); return
    }

    setScores((scoresRes.data ?? []) as unknown as ScoreRow[])
    setMatchdays(mdRes.data ?? [])
    const mmsRows = mmsRes.data ?? []
    const scored = mmsRows.length > 0
    setRoundScored(scored)
    setRoundFinal(scored && mmsRows.every(r => r.status === 'final'))

    // Show lock button if deadline has passed and there are non-locked squads.
    const deadlinePassed = earliest != null && earliest < new Date().toISOString()
    setSquadsNeedLock(deadlinePassed && (squadsRes.data?.length ?? 0) > 0)

    await Promise.all([loadPenalties(), loadPredoResults(matchIds, matchData)])
    setLoadingRound(false)
  }

  async function loadPredoResults(matchIds: number[], matchData: Array<{ id: number; home_nation: string; away_nation: string }>) {
    const { data } = await supabase
      .from('predo_results')
      .select('match_id, actual_winner, actual_margin')
      .in('match_id', matchIds)
    const existing = (data ?? []) as PredoResultRow[]
    setPredoResults(existing)
    setPredoCalcResult(null)

    // Pre-fill form: existing results first, then default to home team / 0.
    const forms: Record<number, PredoResultForm> = {}
    for (const m of matchData) {
      const ex = existing.find(r => r.match_id === m.id)
      forms[m.id] = ex
        ? { winner: ex.actual_winner, margin: String(ex.actual_margin) }
        : { winner: m.home_nation, margin: '0' }
    }
    setPredoForms(forms)
    setPredoSaveMsg(null)
  }

  async function loadPenalties() {
    if (selectedSeasonId == null || selectedRound == null) return
    const { data } = await supabase
      .from('league_penalties')
      .select('id, profile_id, penalty_type, description, points_adjustment, created_by')
      .eq('season_id', selectedSeasonId)
      .eq('round_number', selectedRound)
      .order('created_at')
    setPenalties((data ?? []) as PenaltyRow[])
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

  const managersById = useMemo(() => {
    const m = new Map<string, string>()
    for (const mgr of allManagers) m.set(mgr.id, mgr.display_name)
    return m
  }, [allManagers])

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
      overridePts: row.admin_override_points != null ? String(row.admin_override_points) : '',
      overrideReason: '',
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

    const overrideVal = form.overridePts.trim() === '' ? null : parseFloat(form.overridePts.trim())
    if (overrideVal !== null && isNaN(overrideVal)) { setSaveError('Invalid override value'); return }
    if (overrideVal !== null && !form.overrideReason.trim()) { setSaveError('Override reason is required'); return }

    // Capture old override before writing, for the audit record
    const existingRow = scores.find(s => s.match_id === form.matchId && s.player_id === form.playerId)
    const oldOverride = existingRow?.admin_override_points ?? null
    const overrideChanged = overrideVal !== oldOverride

    setSaving(true); setSaveError(null); setSaveSuccess(false)

    const [scoreRes, mdRes] = await Promise.all([
      supabase.from('player_match_scores').upsert(
        { match_id: form.matchId, player_id: form.playerId, season_id: selectedSeasonId, source_points: pts, admin_override_points: overrideVal, status: 'provisional' },
        { onConflict: 'match_id,player_id' }
      ).select('id'),
      supabase.from('matchday_squads').upsert(
        { match_id: form.matchId, player_id: form.playerId, status: form.matchdayStatus, source: 'admin' },
        { onConflict: 'match_id,player_id' }
      ),
    ])

    if (scoreRes.error || mdRes.error) {
      setSaveError(scoreRes.error?.message ?? mdRes.error?.message ?? 'Save failed')
      setSaving(false); return
    }

    // Audit override changes (CLAUDE.md: all admin overrides must be recorded)
    if (overrideChanged && user && selectedSeasonId != null) {
      const scoreId = (scoreRes.data as Array<{ id: number }> | null)?.[0]?.id
      await supabase.from('admin_overrides').insert({
        season_id:   selectedSeasonId,
        entity_type: 'player_match_score',
        entity_id:   scoreId != null ? String(scoreId) : `${form.matchId}_${form.playerId}`,
        field_name:  'admin_override_points',
        old_value:   oldOverride,
        new_value:   overrideVal,
        reason:      overrideVal === null ? 'Override cleared' : form.overrideReason.trim(),
        created_by:  user.id,
      })
      await recalculateQuiet()
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

  // ── Quiet recalculate (after penalty changes) ────────────────────
  async function recalculateQuiet() {
    if (selectedSeasonId == null || selectedRound == null) return
    const { data, error } = await supabase.functions.invoke('score-round', {
      body: { season_id: selectedSeasonId, round_number: selectedRound },
    })
    if (error) {
      addToast('Scores could not be recalculated automatically — use Calculate scores to retry', 'error')
      return
    }
    const result = data as CalcResult
    setRoundScored(result.managers_scored > 0)
    setRoundFinal(false)
    setCalcResult(null)
  }

  // ── Add penalty ──────────────────────────────────────────────────
  async function handleAddPenalty(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedSeasonId || !selectedRound || !user) return
    const pts = parseFloat(penaltyForm.points)
    if (isNaN(pts)) return

    setAddingPenalty(true)
    const { error } = await supabase.from('league_penalties').insert({
      season_id:        selectedSeasonId,
      profile_id:       penaltyForm.profileId,
      round_number:     selectedRound,
      penalty_type:     penaltyForm.penaltyType,
      description:      penaltyForm.description.trim(),
      points_adjustment: pts,
      created_by:       user.id,
    })
    setAddingPenalty(false)

    if (error) { addToast(error.message, 'error'); return }

    addToast('Adjustment added', 'success')
    setPenaltyForm(EMPTY_PENALTY_FORM)
    await loadPenalties()
    await recalculateQuiet()
  }

  // ── Delete penalty ───────────────────────────────────────────────
  async function handleDeletePenalty() {
    if (pendingDeleteId == null) return
    const { error } = await supabase.from('league_penalties').delete().eq('id', pendingDeleteId)
    setPendingDeleteId(null)
    if (error) { addToast(error.message, 'error'); return }
    addToast('Adjustment removed', 'success')
    await loadPenalties()
    await recalculateQuiet()
  }

  // ── Save predo results ───────────────────────────────────────
  async function handleSavePredoResults() {
    if (!matches.length) return
    setSavingPredos(true); setPredoSaveMsg(null)

    const rows = matches.map(m => {
      const f = predoForms[m.id] ?? { winner: m.home_nation, margin: '0' }
      const margin = f.winner === 'Draw' ? 0 : Math.max(0, parseInt(f.margin, 10) || 0)
      return { match_id: m.id, actual_winner: f.winner, actual_margin: margin }
    })

    const { error } = await supabase
      .from('predo_results')
      .upsert(rows, { onConflict: 'match_id' })

    setSavingPredos(false)
    if (error) {
      setPredoSaveMsg(error.message)
    } else {
      setPredoSaveMsg('Results saved.')
      const matchIds = matches.map(m => m.id)
      await loadPredoResults(matchIds, matches)
    }
  }

  // ── Calculate predo scores ───────────────────────────────────
  async function handleCalcPredos() {
    if (selectedSeasonId == null || selectedRound == null) return
    setCalcPredos(true); setPredoCalcResult(null)

    const { data, error } = await supabase.functions.invoke('score-predos', {
      body: { season_id: selectedSeasonId, round_number: selectedRound },
    })

    setCalcPredos(false)
    if (error) {
      let msg = error.message
      try {
        const ctx = (error as unknown as { context?: Response }).context
        if (ctx) { const b = await ctx.json(); msg = b.error ?? b.message ?? msg }
      } catch { /* use original message */ }
      addToast(msg, 'error'); return
    }

    const result = data as PredoCalcResult
    setPredoCalcResult(result)

    if (result.scores.length) {
      const ids = result.scores.map(s => s.profile_id)
      const { data: pd } = await supabase.from('profiles').select('id, display_name, team_name').in('id', ids)
      const m = new Map<string, ProfileInfo>()
      for (const p of pd ?? []) m.set(p.id, { display_name: p.display_name, team_name: p.team_name })
      setProfiles(m)
    }

    addToast(`Predo scores calculated: ${result.managers_scored} manager${result.managers_scored !== 1 ? 's' : ''} scored`, 'success')
  }

  // ── Generate insights ─────────────────────────────────────────────
  async function handleGenerateInsights() {
    if (!selectedSeasonId || !selectedRound || !session) return
    setGeneratingInsights(true); setInsightsMsg(null)
    const { data, error } = await supabase.functions.invoke('generate-insights', {
      body: { season_id: selectedSeasonId, round_number: selectedRound },
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    setGeneratingInsights(false)
    if (error) { addToast(error.message, 'error'); return }
    const result = data as { round_number: number; season_id: number }
    setInsightsMsg(`Insights generated for round ${result.round_number}`)
    addToast(`Insights generated for round ${result.round_number}`, 'success')
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
        <LoadingSpinner />
      ) : roundError ? (
        <ErrorCard onRetry={loadRound} />
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

            {/* Penalties & Adjustments section */}
            <section className="bg-spal-surface rounded p-5">
              <h2 className="font-semibold text-spal-text mb-4">Penalties &amp; Adjustments</h2>

              {/* Add form */}
              <form onSubmit={handleAddPenalty} className="space-y-3 mb-5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-spal-muted mb-1">Manager</label>
                    <select
                      value={penaltyForm.profileId}
                      onChange={e => setPenaltyForm(f => ({ ...f, profileId: e.target.value }))}
                      required
                      className={inputClass}
                    >
                      <option value="">Select manager…</option>
                      {allManagers.map(m => (
                        <option key={m.id} value={m.id}>{m.display_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-spal-muted mb-1">Type</label>
                    <select
                      value={penaltyForm.penaltyType}
                      onChange={e => setPenaltyForm(f => ({ ...f, penaltyType: e.target.value }))}
                      className={inputClass}
                    >
                      {PENALTY_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-spal-muted mb-1">Description</label>
                  <input
                    type="text"
                    value={penaltyForm.description}
                    onChange={e => setPenaltyForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Reason for adjustment…"
                    required
                    className={inputClass}
                  />
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-spal-muted mb-1">Points (negative = deduction)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={penaltyForm.points}
                      onChange={e => setPenaltyForm(f => ({ ...f, points: e.target.value }))}
                      placeholder="e.g. −5 or 3"
                      required
                      className={inputClass}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={addingPenalty || !penaltyForm.profileId || !penaltyForm.description || penaltyForm.points === ''}
                    className={`${submitClass} px-5 shrink-0`}
                  >
                    {addingPenalty ? 'Adding…' : 'Add Adjustment'}
                  </button>
                </div>
              </form>

              {/* Existing adjustments */}
              {penalties.length === 0 ? (
                <p className="text-spal-muted text-sm">No adjustments for this round.</p>
              ) : (
                <table className="w-full text-sm mb-3">
                  <thead>
                    <tr className="text-left text-spal-muted border-b border-white/10">
                      <th className="pb-2 pr-4 font-normal">Manager</th>
                      <th className="pb-2 pr-4 font-normal">Type</th>
                      <th className="pb-2 pr-4 font-normal">Description</th>
                      <th className="pb-2 pr-4 font-normal text-right tabular-nums">Pts</th>
                      <th className="pb-2 pr-4 font-normal">Created by</th>
                      <th className="pb-2 font-normal"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {penalties.map(p => (
                      <tr key={p.id} className="border-b border-white/5">
                        <td className="py-2 pr-4 text-spal-text">{managersById.get(p.profile_id) ?? p.profile_id}</td>
                        <td className="py-2 pr-4 text-spal-muted text-xs capitalize">{p.penalty_type.replace(/_/g, ' ')}</td>
                        <td className="py-2 pr-4 text-spal-muted text-xs">{p.description}</td>
                        <td className={`py-2 pr-4 text-right tabular-nums font-medium ${p.points_adjustment < 0 ? 'text-red-400' : 'text-spal-success'}`}>
                          {p.points_adjustment > 0 ? '+' : ''}{p.points_adjustment}
                        </td>
                        <td className="py-2 pr-4 text-spal-muted text-xs">{managersById.get(p.created_by) ?? '—'}</td>
                        <td className="py-2">
                          <button
                            onClick={() => setPendingDeleteId(p.id)}
                            className="text-xs text-red-400 hover:text-red-300 transition-colors"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <p className="text-xs text-spal-muted mt-3">
                Adjustments are applied automatically when scores are calculated. Adding or removing an adjustment here will recalculate scores for this round.
              </p>
            </section>

            {/* ── Predo Results section ────────────────────────────── */}
            <section className="bg-spal-surface rounded p-5">
              <h2 className="font-semibold text-spal-text mb-1">Predo results</h2>
              <p className="text-xs text-spal-muted mb-4">
                Enter the actual result for each match, then calculate predo scores.
              </p>

              <div className="space-y-3 mb-4">
                {matches.map(m => {
                  const f = predoForms[m.id] ?? { winner: m.home_nation, margin: '0' }
                  const saved = predoResults.find(r => r.match_id === m.id)
                  return (
                    <div key={m.id} className="flex items-center gap-4 flex-wrap">
                      <span className="text-sm text-spal-text w-44 shrink-0">
                        {m.home_nation} vs {m.away_nation}
                        {saved && <span className="text-xs text-spal-success ml-1">✓</span>}
                      </span>
                      <select
                        value={f.winner}
                        onChange={e => {
                          const w = e.target.value
                          setPredoForms(prev => ({
                            ...prev,
                            [m.id]: { winner: w, margin: w === 'Draw' ? '0' : prev[m.id]?.margin ?? '0' },
                          }))
                        }}
                        className={inputClass}
                      >
                        <option value={m.home_nation}>{m.home_nation}</option>
                        <option value={m.away_nation}>{m.away_nation}</option>
                        <option value="Draw">Draw</option>
                      </select>
                      {f.winner !== 'Draw' && (
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-spal-muted">Margin</label>
                          <input
                            type="number"
                            min="0"
                            value={f.margin}
                            onChange={e => setPredoForms(prev => ({
                              ...prev,
                              [m.id]: { ...prev[m.id], margin: e.target.value },
                            }))}
                            className={`${inputClass} w-20`}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="flex items-center gap-4 flex-wrap mb-6">
                <button onClick={handleSavePredoResults} disabled={savingPredos} className={`${submitClass} px-5`}>
                  {savingPredos ? 'Saving…' : 'Save results'}
                </button>
                {predoSaveMsg && (
                  <p className={`text-sm ${predoSaveMsg.includes('aved') ? 'text-spal-success' : 'text-spal-error'}`}>
                    {predoSaveMsg}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-white/10 pt-4">
                <div>
                  <p className="text-sm font-medium text-spal-text">Calculate predo scores</p>
                  <p className="text-xs text-spal-muted mt-0.5">Requires all results saved above.</p>
                </div>
                <button onClick={handleCalcPredos} disabled={calcPredos} className={`${submitClass} px-5`}>
                  {calcPredos ? 'Calculating…' : 'Calculate predo scores'}
                </button>
              </div>

              {predoCalcResult && (
                <div className="mt-4">
                  <p className="text-xs text-spal-muted mb-3">
                    {predoCalcResult.managers_scored} manager{predoCalcResult.managers_scored !== 1 ? 's' : ''} scored
                    — round {predoCalcResult.round_number}
                  </p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-spal-muted border-b border-white/10">
                        <th className="pb-2 pr-3 font-normal w-10">Pos</th>
                        <th className="pb-2 pr-6 font-normal">Manager</th>
                        <th className="pb-2 pr-4 font-normal text-right tabular-nums hidden sm:table-cell">Win pts</th>
                        <th className="pb-2 pr-4 font-normal text-right tabular-nums hidden sm:table-cell">Margin pts</th>
                        <th className="pb-2 font-normal text-right tabular-nums">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {predoCalcResult.scores.map((s, i) => {
                        const p = profiles.get(s.profile_id)
                        return (
                          <tr key={s.profile_id} className={`border-b border-white/5 ${i === 0 ? 'bg-spal-yellow/5' : ''}`}>
                            <td className={`py-2 pr-3 tabular-nums text-xs font-medium ${i === 0 ? 'text-spal-yellow' : 'text-spal-muted'}`}>
                              {ordinal(i + 1)}
                            </td>
                            <td className={`py-2 pr-6 font-medium ${i === 0 ? 'text-spal-yellow' : 'text-spal-text'}`}>
                              {p?.display_name ?? s.profile_id}
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums text-spal-muted hidden sm:table-cell">
                              {Number(s.winning_team_points).toFixed(1)}
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums text-spal-muted hidden sm:table-cell">
                              {Number(s.margin_points).toFixed(1)}
                            </td>
                            <td className={`py-2 text-right tabular-nums font-semibold ${i === 0 ? 'text-spal-yellow' : 'text-spal-text'}`}>
                              {Number(s.total_points).toFixed(1)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

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
                        <th className="pb-2 pr-3 font-normal w-10">Pos</th>
                        <th className="pb-2 pr-6 font-normal">Manager</th>
                        <th className="pb-2 pr-6 font-normal">Team</th>
                        <th className="pb-2 font-normal text-right tabular-nums">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calcResult.scores.map((s, i) => {
                        const p = profiles.get(s.profile_id)
                        const isFirst = i === 0
                        return (
                          <tr key={s.profile_id} className={`border-b border-white/5 ${isFirst ? 'bg-spal-yellow/5' : ''}`}>
                            <td className={`py-2 pr-3 tabular-nums text-xs font-medium ${isFirst ? 'text-spal-yellow' : 'text-spal-muted'}`}>
                              {ordinal(i + 1)}
                            </td>
                            <td className={`py-2 pr-6 font-medium ${isFirst ? 'text-spal-yellow' : 'text-spal-text'}`}>
                              {p?.display_name ?? s.profile_id}
                            </td>
                            <td className="py-2 pr-6 text-spal-muted text-xs">{p?.team_name || '—'}</td>
                            <td className={`py-2 text-right tabular-nums font-semibold ${isFirst ? 'text-spal-yellow' : 'text-spal-text'}`}>
                              {Number(s.round_score).toFixed(1)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Generate insights section */}
            <section className="bg-spal-surface rounded p-5">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="font-semibold text-spal-text">Generate insights</h2>
                  <p className="text-xs text-spal-muted mt-0.5">
                    Computes round insights and stores them for the Insights page.
                  </p>
                </div>
                <button
                  onClick={handleGenerateInsights}
                  disabled={generatingInsights}
                  className={`${submitClass} px-5`}
                >
                  {generatingInsights ? 'Generating…' : 'Generate insights'}
                </button>
              </div>
              {insightsMsg && (
                <p className="text-xs text-spal-success mt-2">{insightsMsg}</p>
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

                  <Field label="Override score" htmlFor="f-override">
                    <div className="flex items-center gap-2">
                      <input
                        id="f-override"
                        type="number"
                        step="0.5"
                        value={form.overridePts}
                        onChange={e => setForm(f => ({ ...f, overridePts: e.target.value, overrideReason: '' }))}
                        placeholder="Leave blank for no override"
                        className={inputClass}
                      />
                      {form.overridePts !== '' && (
                        <button
                          type="button"
                          onClick={() => setForm(f => ({ ...f, overridePts: '', overrideReason: '' }))}
                          className="text-xs text-spal-muted hover:text-spal-text whitespace-nowrap transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-spal-muted mt-1">Takes precedence over source score</p>
                  </Field>

                  {form.overridePts !== '' && (
                    <Field label="Override reason" htmlFor="f-override-reason">
                      <input
                        id="f-override-reason"
                        type="text"
                        value={form.overrideReason}
                        onChange={e => setForm(f => ({ ...f, overrideReason: e.target.value }))}
                        placeholder="Required — e.g. corrected after official update"
                        className={inputClass}
                      />
                    </Field>
                  )}

                  {(form.sourcePts !== '' || form.overridePts !== '') && (
                    <div className="flex items-center gap-2 text-xs py-1 px-3 rounded bg-white/5">
                      <span className="text-spal-muted">Final score:</span>
                      {form.overridePts !== '' ? (
                        <span className="text-spal-warning font-semibold tabular-nums">
                          {form.overridePts} <span className="font-normal">(overridden)</span>
                        </span>
                      ) : (
                        <span className="text-spal-text font-semibold tabular-nums">{form.sourcePts}</span>
                      )}
                    </div>
                  )}

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

      <ConfirmModal
        open={pendingDeleteId != null}
        title="Delete this adjustment?"
        message="This will remove the adjustment and recalculate scores for this round."
        confirmLabel="Delete"
        danger
        onConfirm={handleDeletePenalty}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

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
