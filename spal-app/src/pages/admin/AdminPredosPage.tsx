import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../components/Toast'
import { ConfirmModal } from '../../components/ConfirmModal'
import { EmptyState } from '../../components/EmptyState'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorCard from '../../components/ErrorCard'

interface Season   { id: number; year: number; status: string }
interface Match    { id: number; home_nation: string; away_nation: string }
interface Profile  { id: string; display_name: string }
interface PredoRow {
  id: number
  profile_id: string
  match_id: number
  predicted_winner: string
  predicted_margin: number
}

interface EditState {
  predoId: number | null   // null = new prediction
  profileId: string
  matchId: number
  winner: string
  margin: string
  reason: string
}

const ROUNDS = [1, 2, 3, 4, 5] as const

export default function AdminPredosPage() {
  useEffect(() => { document.title = 'Predos — Admin — SPAL' }, [])
  const { user } = useAuth()
  const { addToast } = useToast()

  const [seasons, setSeasons]           = useState<Season[]>([])
  const [seasonId, setSeasonId]         = useState<number | null>(null)
  const [round, setRound]               = useState<number | null>(null)
  const [matches, setMatches]           = useState<Match[]>([])
  const [profiles, setProfiles]         = useState<Profile[]>([])
  const [predos, setPredos]             = useState<PredoRow[]>([])
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState(false)
  const [retryKey, setRetryKey]         = useState(0)

  // Edit/add state
  const [editState, setEditState]       = useState<EditState | null>(null)
  const [saving, setSaving]             = useState(false)

  // Delete state
  const [deleteId, setDeleteId]         = useState<number | null>(null)

  // Reset predo scores
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetting, setResetting]               = useState(false)
  const [resetReason, setResetReason]           = useState('Predo scores reset by admin')

  // Load seasons
  useEffect(() => {
    supabase.from('seasons').select('id, year, status').order('year', { ascending: false })
      .then(({ data }) => {
        const list = (data ?? []) as Season[]
        setSeasons(list)
        const preferred = list.find(s => s.status === 'active') ?? list[0]
        if (preferred) setSeasonId(preferred.id)
      })
  }, [])

  // Load managers
  useEffect(() => {
    supabase.from('profiles').select('id, display_name').order('display_name')
      .then(({ data }) => setProfiles((data ?? []) as Profile[]))
  }, [])

  // Load round data
  useEffect(() => {
    if (seasonId == null || round == null) { setMatches([]); setPredos([]); return }
    setLoading(true); setError(false)

    async function load() {
      const { data: matchData, error: matchErr } = await supabase
        .from('matches').select('id, home_nation, away_nation')
        .eq('season_id', seasonId!).eq('round_number', round!).order('kickoff_at')
      if (matchErr) { setError(true); setLoading(false); return }
      const mList = (matchData ?? []) as Match[]
      setMatches(mList)
      const matchIds = mList.map(m => m.id)
      if (matchIds.length === 0) { setPredos([]); setLoading(false); return }
      const { data: predoData, error: predoErr } = await supabase
        .from('predo_predictions')
        .select('id, profile_id, match_id, predicted_winner, predicted_margin')
        .in('match_id', matchIds)
      if (predoErr) { setError(true); setLoading(false); return }
      setPredos((predoData ?? []) as PredoRow[])
      setLoading(false)
    }

    load()
  }, [seasonId, round, retryKey])

  function openEdit(predo: PredoRow) {
    setEditState({
      predoId: predo.id,
      profileId: predo.profile_id,
      matchId: predo.match_id,
      winner: predo.predicted_winner,
      margin: String(predo.predicted_margin),
      reason: '',
    })
  }

  function openAdd(profileId: string, match: Match) {
    setEditState({
      predoId: null,
      profileId,
      matchId: match.id,
      winner: match.home_nation,
      margin: '0',
      reason: '',
    })
  }

  async function handleSaveEdit() {
    if (!editState || !user || seasonId == null) return
    if (!editState.reason.trim()) { addToast('Reason is required', 'error'); return }
    const margin = parseInt(editState.margin, 10)
    if (isNaN(margin) || margin < 0) { addToast('Invalid margin', 'error'); return }
    setSaving(true)

    if (editState.predoId != null) {
      // Edit existing prediction
      const oldPredo = predos.find(p => p.id === editState.predoId)
      const { error: updateErr } = await supabase
        .from('predo_predictions')
        .update({ predicted_winner: editState.winner, predicted_margin: margin, updated_at: new Date().toISOString() })
        .eq('id', editState.predoId)
      if (updateErr) { addToast(updateErr.message, 'error'); setSaving(false); return }

      await supabase.from('admin_overrides').insert({
        season_id:   seasonId,
        entity_type: 'predo_prediction',
        entity_id:   String(editState.predoId),
        field_name:  'prediction',
        old_value:   { predicted_winner: oldPredo?.predicted_winner, predicted_margin: oldPredo?.predicted_margin },
        new_value:   { predicted_winner: editState.winner, predicted_margin: margin },
        reason:      editState.reason.trim(),
        created_by:  user.id,
      })
      addToast('Prediction updated', 'success')
    } else {
      // Add new prediction for a manager who hasn't submitted
      const { error: insertErr } = await supabase
        .from('predo_predictions')
        .insert({
          season_id:         seasonId,
          profile_id:        editState.profileId,
          match_id:          editState.matchId,
          predicted_winner:  editState.winner,
          predicted_margin:  margin,
        })
      if (insertErr) { addToast(insertErr.message, 'error'); setSaving(false); return }

      await supabase.from('audit_log').insert({
        actor_id:    user.id,
        action:      'predo.prediction_added_by_admin',
        entity_type: 'predo_prediction',
        entity_id:   `${editState.profileId}_${editState.matchId}`,
        season_id:   seasonId,
        metadata:    { profile_id: editState.profileId, match_id: editState.matchId, predicted_winner: editState.winner, predicted_margin: margin, reason: editState.reason.trim() },
      })
      addToast('Prediction added', 'success')
    }

    setSaving(false)
    setEditState(null)
    setRetryKey(k => k + 1)
  }

  async function handleDelete() {
    if (deleteId == null || !user || seasonId == null) return
    const idToDelete = deleteId
    setDeleteId(null)
    const predo = predos.find(p => p.id === idToDelete)
    const { error: delErr } = await supabase.from('predo_predictions').delete().eq('id', idToDelete)
    if (delErr) { addToast(delErr.message, 'error'); return }

    await supabase.from('audit_log').insert({
      actor_id:    user.id,
      action:      'predo.prediction_deleted_by_admin',
      entity_type: 'predo_prediction',
      entity_id:   String(idToDelete),
      season_id:   seasonId,
      metadata:    { profile_id: predo?.profile_id, match_id: predo?.match_id, deleted_prediction: { predicted_winner: predo?.predicted_winner, predicted_margin: predo?.predicted_margin } },
    })

    addToast('Prediction deleted', 'success')
    setRetryKey(k => k + 1)
  }

  async function handleResetScores() {
    if (!user || seasonId == null || round == null) return
    setResetting(true)
    const { error: delErr } = await supabase.from('predo_scores').delete().eq('season_id', seasonId).eq('round_number', round)
    if (delErr) { addToast(delErr.message, 'error'); setResetting(false); setShowResetConfirm(false); return }

    await supabase.from('audit_log').insert({
      actor_id:    user.id,
      action:      'predo.scores_reset_by_admin',
      entity_type: 'predo_scores',
      entity_id:   `${seasonId}_${round}`,
      season_id:   seasonId,
      metadata:    { round_number: round, reason: resetReason.trim() },
    })

    addToast(`Predo scores for round ${round} cleared`, 'success')
    setResetting(false)
    setShowResetConfirm(false)
  }


  return (
    <div>
      <h1 className="text-2xl font-bold text-spal-yellow mb-6">Predos — Admin</h1>

      {/* Selectors */}
      <div className="flex items-center gap-6 mb-8 flex-wrap">
        <div className="flex items-center gap-3">
          <label className="text-sm text-spal-muted">Season</label>
          <select
            value={seasonId ?? ''}
            onChange={e => { setSeasonId(Number(e.target.value)); setRound(null) }}
            className={selectClass}
          >
            {seasons.map(s => <option key={s.id} value={s.id}>{s.year}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-spal-muted">Round</span>
          {ROUNDS.map(r => (
            <button key={r} onClick={() => setRound(r)} className={roundBtnClass(round === r)}>
              R{r}
            </button>
          ))}
        </div>
      </div>

      {round == null ? (
        <p className="text-spal-muted text-sm">Select a round to view predictions.</p>
      ) : loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorCard onRetry={() => setRetryKey(k => k + 1)} />
      ) : matches.length === 0 ? (
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10">
              <rect x="3" y="4" width="18" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 2v4M8 2v4M3 10h18" />
            </svg>
          }
          title={`No matches for round ${round}`}
          body="Add matches for this round via the Seasons page before managing predictions."
        />
      ) : (
        <div className="space-y-6">

          {/* Reset predo scores */}
          <div className="flex items-center justify-between bg-spal-surface rounded p-4">
            <div>
              <p className="text-sm font-medium text-spal-text">Reset predo scores</p>
              <p className="text-xs text-spal-muted mt-0.5">
                Clears all calculated predo scores for round {round}. Run score-predos again afterwards to recalculate.
              </p>
            </div>
            <button
              onClick={() => setShowResetConfirm(true)}
              className="text-xs border border-red-500/40 text-red-400 hover:bg-red-500/10 rounded px-3 py-1.5 transition-colors shrink-0"
            >
              Reset scores
            </button>
          </div>

          {/* Per-manager prediction tables */}
          {profiles.map(profile => {
            const myPredos = predos.filter(p => p.profile_id === profile.id)
            const hasAny   = myPredos.length > 0
            return (
              <section key={profile.id} className="bg-spal-surface rounded p-5">
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="font-semibold text-spal-text">{profile.display_name}</h2>
                  {!hasAny && (
                    <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">
                      No predos submitted
                    </span>
                  )}
                  {hasAny && myPredos.length < matches.length && (
                    <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">
                      {myPredos.length}/{matches.length} submitted
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-spal-muted border-b border-white/10">
                      <th className="pb-2 pr-6 font-normal">Match</th>
                      <th className="pb-2 pr-4 font-normal">Predicted winner</th>
                      <th className="pb-2 pr-4 font-normal text-right">Margin</th>
                      <th className="pb-2 font-normal"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map(match => {
                      const predo = myPredos.find(p => p.match_id === match.id)
                      const isEditing = editState?.matchId === match.id && editState?.profileId === profile.id
                      return (
                        <tr key={match.id} className="border-b border-white/5">
                          <td className="py-2 pr-6 text-spal-text">
                            {match.home_nation} vs {match.away_nation}
                          </td>
                          {isEditing ? (
                            <>
                              <td className="py-2 pr-4" colSpan={2}>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <select
                                    value={editState.winner}
                                    onChange={e => setEditState(s => s ? { ...s, winner: e.target.value } : s)}
                                    className={inputClass}
                                  >
                                    <option value={match.home_nation}>{match.home_nation}</option>
                                    <option value={match.away_nation}>{match.away_nation}</option>
                                    <option value="Draw">Draw</option>
                                  </select>
                                  {editState.winner !== 'Draw' && (
                                    <input
                                      type="number"
                                      min="0"
                                      value={editState.margin}
                                      onChange={e => setEditState(s => s ? { ...s, margin: e.target.value } : s)}
                                      className={`${inputClass} w-20`}
                                      placeholder="Margin"
                                    />
                                  )}
                                  <input
                                    type="text"
                                    value={editState.reason}
                                    onChange={e => setEditState(s => s ? { ...s, reason: e.target.value } : s)}
                                    placeholder="Reason (required)"
                                    className={`${inputClass} flex-1 min-w-32`}
                                  />
                                  <button
                                    onClick={handleSaveEdit}
                                    disabled={saving}
                                    className={btnPrimary}
                                  >
                                    {saving ? 'Saving…' : 'Save'}
                                  </button>
                                  <button
                                    onClick={() => setEditState(null)}
                                    className="text-xs text-spal-muted hover:text-spal-text transition-colors"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </td>
                              <td />
                            </>
                          ) : predo ? (
                            <>
                              <td className="py-2 pr-4 text-spal-text">{predo.predicted_winner}</td>
                              <td className="py-2 pr-4 text-right tabular-nums text-spal-muted">
                                {predo.predicted_winner === 'Draw' ? '—' : `+${predo.predicted_margin}`}
                              </td>
                              <td className="py-2">
                                <div className="flex items-center gap-3 justify-end">
                                  <button
                                    onClick={() => openEdit(predo)}
                                    className="text-xs text-spal-cerulean hover:text-spal-cerulean-light transition-colors"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => setDeleteId(predo.id)}
                                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="py-2 pr-4 text-spal-muted text-xs">—</td>
                              <td className="py-2 pr-4" />
                              <td className="py-2">
                                <button
                                  onClick={() => openAdd(profile.id, match)}
                                  className="text-xs text-spal-cerulean hover:text-spal-cerulean-light transition-colors"
                                >
                                  + Add
                                </button>
                              </td>
                            </>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmModal
        open={deleteId != null}
        title="Delete prediction?"
        message="This will permanently remove this manager's prediction for this match."
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />

      {/* Reset scores confirmation */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-spal-surface border border-white/10 rounded-lg w-full max-w-sm mx-4 p-6 space-y-4">
            <h3 className="font-semibold text-spal-text">Reset predo scores for round {round}?</h3>
            <p className="text-sm text-spal-muted">
              This deletes all calculated predo scores for this round. The predictions themselves are not affected. Recalculate via the Scores page afterwards.
            </p>
            <div>
              <label className="block text-xs text-spal-muted mb-1">Reason</label>
              <input
                type="text"
                value={resetReason}
                onChange={e => setResetReason(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowResetConfirm(false)} className="text-sm text-spal-muted hover:text-spal-text transition-colors">
                Cancel
              </button>
              <button
                onClick={handleResetScores}
                disabled={resetting}
                className="text-sm bg-red-600 text-white rounded px-4 py-1.5 hover:bg-red-500 disabled:opacity-50 transition-colors"
              >
                {resetting ? 'Resetting…' : 'Reset scores'}
              </button>
            </div>
          </div>
        </div>
      )}

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

const selectClass = 'bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
const inputClass  = 'bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
const btnPrimary  = 'bg-spal-cerulean text-white text-xs rounded px-3 py-1.5 hover:bg-spal-cerulean-light disabled:opacity-50 transition-colors'
