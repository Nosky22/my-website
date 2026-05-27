import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { DraftSession } from '../hooks/useDraftSession'
import { ConfirmModal } from './ConfirmModal'

interface Props {
  session: DraftSession
  totalPicks: number
  timeRemaining: number | null
  userId: string
  activeSlots: string[]
}

interface EditPick {
  id: number
  player_id: number
  draft_slot: string
  display_name: string
}

interface Player {
  id: number
  display_name: string
  nation: string
  position_group: string
}

function isEligibleForSlot(player: Player, slot: string): boolean {
  switch (slot) {
    case 'Front Row':    return player.position_group === 'Front Row'
    case 'Back Row':     return player.position_group === 'Back Row'
    case 'Outside Back': return player.position_group === 'Outside Back'
    case 'Wales':        return player.nation === 'Wales'
    case 'Bench Sub':    return true
    default:             return false
  }
}

export default function DraftRoomAdminBar({ session, totalPicks, userId, activeSlots }: Props) {
  const [jumpTarget, setJumpTarget]     = useState<number | ''>('')
  const [jumpError, setJumpError]       = useState('')
  const [confirmModal, setConfirmModal] = useState<'start' | 'reopen' | 'restart' | null>(null)

  // Edit pick state
  const [editTarget, setEditTarget]     = useState<number | ''>('')
  const [editingPick, setEditingPick]   = useState<EditPick | null>(null)
  const [editSlot, setEditSlot]         = useState('')
  const [editSearch, setEditSearch]     = useState('')
  const [editPlayers, setEditPlayers]   = useState<Player[]>([])
  const [editTakenIds, setEditTakenIds] = useState<Set<number>>(new Set())
  const [editLoading, setEditLoading]   = useState(false)
  const [editSaving, setEditSaving]     = useState(false)
  const [editError, setEditError]       = useState('')

  const deadline = () =>
    new Date(Date.now() + session.pick_timer_seconds * 1000).toISOString()

  async function filledPickNumbers(): Promise<Set<number>> {
    const { data } = await supabase
      .from('draft_picks')
      .select('pick_number')
      .eq('season_id', session.season_id)
    return new Set((data ?? []).map((p: { pick_number: number }) => p.pick_number))
  }

  async function nextUnfilled(from: number): Promise<number | null> {
    const filled = await filledPickNumbers()
    for (let i = from; i <= totalPicks; i++) {
      if (!filled.has(i)) return i
    }
    return null
  }

  // ── Session control handlers ──────────────────────────────────────

  const handleStart = async () =>
    await supabase.from('draft_sessions').update({
      status: 'active',
      started_at: new Date().toISOString(),
      current_pick_number: 1,
      pick_deadline: deadline(),
    }).eq('id', session.id)

  const handlePause = async () =>
    await supabase.from('draft_sessions').update({ status: 'paused' }).eq('id', session.id)

  const handleResume = async () =>
    await supabase.from('draft_sessions').update({
      status: 'active',
      pick_deadline: deadline(),
    }).eq('id', session.id)

  const handleAdvance = async () => {
    const next = await nextUnfilled(session.current_pick_number + 1)
    const isComplete = next === null
    await supabase.from('draft_sessions').update({
      ...(next != null ? { current_pick_number: next } : {}),
      status: isComplete ? 'complete' : 'active',
      pick_deadline: isComplete ? null : deadline(),
      ...(isComplete ? { completed_at: new Date().toISOString() } : {}),
    }).eq('id', session.id)
  }

  const handleReopen = async () => {
    const next = await nextUnfilled(1)
    if (next === null) {
      alert('All picks are filled — nothing to reopen.')
      return
    }
    await supabase.from('draft_sessions').update({
      status: 'active',
      current_pick_number: next,
      pick_deadline: deadline(),
      completed_at: null,
    }).eq('id', session.id)
  }

  // b. Jump to any pick — filled picks allowed, shown as a warning
  const handleJump = async () => {
    const n = Number(jumpTarget)
    if (!n || n < 1 || n > totalPicks) {
      setJumpError(`Enter a pick number between 1 and ${totalPicks}`)
      return
    }
    const filled = await filledPickNumbers()
    setJumpError('')
    await supabase.from('draft_sessions').update({
      current_pick_number: n,
      pick_deadline: deadline(),
    }).eq('id', session.id)
    setJumpTarget('')
    if (filled.has(n)) {
      setJumpError(`Pick ${n} is already filled — use Edit pick to change the player`)
    }
  }

  // c. Restart draft
  const handleRestart = async () => {
    const { count } = await supabase
      .from('draft_picks')
      .select('*', { count: 'exact', head: true })
      .eq('season_id', session.season_id)

    await supabase.from('draft_picks').delete().eq('season_id', session.season_id)

    await supabase.from('draft_sessions').update({
      status: 'pending',
      current_pick_number: 1,
      pick_deadline: null,
      started_at: null,
      completed_at: null,
    }).eq('id', session.id)

    await supabase.from('audit_log').insert({
      actor_id: userId,
      action: 'restart_draft',
      entity_type: 'draft_session',
      entity_id: String(session.id),
      season_id: session.season_id,
      metadata: { picks_deleted: count ?? 0 },
    })
  }

  // a. Edit pick — load
  const handleLoadEdit = async () => {
    const n = Number(editTarget)
    if (!n || n < 1 || n > totalPicks) {
      setEditError(`Enter a pick number between 1 and ${totalPicks}`)
      return
    }
    setEditLoading(true)
    setEditError('')
    setEditingPick(null)

    const [pickRes, playersRes, allPicksRes] = await Promise.all([
      supabase
        .from('draft_picks')
        .select('id, player_id, draft_slot, players!player_id(display_name)')
        .eq('season_id', session.season_id)
        .eq('pick_number', n)
        .maybeSingle(),
      supabase
        .from('players')
        .select('id, display_name, nation, position_group')
        .eq('season_id', session.season_id)
        .order('display_name'),
      supabase
        .from('draft_picks')
        .select('player_id')
        .eq('season_id', session.season_id),
    ])

    if (!pickRes.data) {
      setEditError(`Pick ${n} has not been made yet`)
      setEditLoading(false)
      return
    }

    const pick = pickRes.data
    setEditingPick({
      id: pick.id,
      player_id: pick.player_id,
      draft_slot: pick.draft_slot,
      display_name: (pick.players as unknown as { display_name: string } | null)?.display_name ?? '—',
    })
    setEditSlot(pick.draft_slot)
    setEditPlayers((playersRes.data ?? []) as Player[])
    setEditTakenIds(new Set(
      (allPicksRes.data ?? []).map((p: { player_id: number }) => p.player_id)
    ))
    setEditLoading(false)
  }

  // a. Edit pick — save
  const handleSaveEdit = async (newPlayerId: number) => {
    if (!editingPick) return
    setEditSaving(true)
    setEditError('')

    const { error: updateErr } = await supabase
      .from('draft_picks')
      .update({ player_id: newPlayerId, draft_slot: editSlot })
      .eq('id', editingPick.id)

    if (updateErr) {
      setEditError(updateErr.message)
      setEditSaving(false)
      return
    }

    // Keep session's current_pick_number pointed at the next unfilled pick
    if (session.status !== 'complete') {
      const next = await nextUnfilled(1)
      if (next != null && next !== session.current_pick_number) {
        await supabase.from('draft_sessions')
          .update({ current_pick_number: next })
          .eq('id', session.id)
      }
    }

    const newPlayer = editPlayers.find(p => p.id === newPlayerId)
    await supabase.from('audit_log').insert({
      actor_id: userId,
      action: 'edit_pick',
      entity_type: 'draft_pick',
      entity_id: String(editingPick.id),
      season_id: session.season_id,
      metadata: {
        pick_number: Number(editTarget),
        old_player_id: editingPick.player_id,
        new_player_id: newPlayerId,
        new_player_name: newPlayer?.display_name,
        old_slot: editingPick.draft_slot,
        new_slot: editSlot,
      },
    })

    setEditingPick(null)
    setEditTarget('')
    setEditSearch('')
    setEditSaving(false)
  }

  const cancelEdit = () => {
    setEditingPick(null)
    setEditTarget('')
    setEditSearch('')
    setEditError('')
    setEditLoading(false)
  }

  // ── Computed ──────────────────────────────────────────────────────

  const canAdvance = session.status === 'active' || session.status === 'paused'
  const canEdit    = session.status !== 'pending'

  const editVisiblePlayers = editPlayers.filter(p => {
    if (p.id !== editingPick?.player_id && editTakenIds.has(p.id)) return false
    if (editSlot && !isEligibleForSlot(p, editSlot)) return false
    if (editSearch && !p.display_name.toLowerCase().includes(editSearch.toLowerCase())) return false
    return true
  })

  // ── Render ────────────────────────────────────────────────────────

  return (
    <>
    <div className="mb-6 px-4 py-3 bg-spal-surface rounded border border-white/10 space-y-2">

      {/* Main controls */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-spal-muted uppercase tracking-wider">Admin</span>
        <span className="text-white/20 select-none">|</span>

        {session.status === 'pending' && (
          <button onClick={() => setConfirmModal('start')} className={btn('cerulean')}>
            Start Draft
          </button>
        )}
        {session.status === 'active' && (
          <button onClick={handlePause} className={btn('muted')}>Pause</button>
        )}
        {session.status === 'paused' && (
          <button onClick={handleResume} className={btn('cerulean')}>Resume</button>
        )}
        {canAdvance && (
          <button onClick={handleAdvance} className={btn('warning')}>Advance Pick</button>
        )}
        {session.status === 'complete' && (
          <>
            <span className="text-xs text-spal-success">Draft complete</span>
            <button onClick={() => setConfirmModal('reopen')} className={btn('warning')}>
              Reopen Draft
            </button>
          </>
        )}

        <span className="text-white/10 select-none">|</span>
        <button onClick={() => setConfirmModal('restart')} className={btn('danger')}>
          Restart Draft
        </button>
      </div>

      {/* Jump to pick */}
      {canAdvance && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-spal-muted">Jump to pick</span>
          <input
            type="number"
            min={1}
            max={totalPicks}
            value={jumpTarget}
            onChange={e => { setJumpTarget(e.target.value === '' ? '' : Number(e.target.value)); setJumpError('') }}
            className={inputClass}
            placeholder="1…"
          />
          <button onClick={handleJump} className={btn('muted')}>Go</button>
          {jumpError && (
            <span className={`text-xs ${jumpError.includes('already filled') ? 'text-spal-warning' : 'text-spal-error'}`}>
              {jumpError}
            </span>
          )}
        </div>
      )}

      {/* Edit pick */}
      {canEdit && (
        <div className="pt-2 border-t border-white/5">
          {!editingPick ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-spal-muted">Edit pick</span>
              <input
                type="number"
                min={1}
                max={totalPicks}
                value={editTarget}
                onChange={e => { setEditTarget(e.target.value === '' ? '' : Number(e.target.value)); setEditError('') }}
                className={inputClass}
                placeholder="1…"
              />
              <button onClick={handleLoadEdit} disabled={editLoading} className={btn('muted')}>
                {editLoading ? 'Loading…' : 'Load'}
              </button>
              {editError && <span className="text-xs text-spal-error">{editError}</span>}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-spal-muted">
                  Editing pick {editTarget}:{' '}
                  <span className="text-spal-text font-medium">{editingPick.display_name}</span>
                  <span className="text-spal-muted"> ({editingPick.draft_slot})</span>
                </p>
                <button onClick={cancelEdit} className="text-xs text-spal-muted hover:text-spal-text transition-colors">
                  Cancel
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-spal-muted">Slot</span>
                <select
                  value={editSlot}
                  onChange={e => { setEditSlot(e.target.value); setEditSearch('') }}
                  className="bg-spal-bg border border-white/10 rounded px-2 py-1 text-spal-text text-xs focus:outline-none focus:border-spal-cerulean"
                >
                  {activeSlots.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input
                  type="text"
                  placeholder="Search player…"
                  value={editSearch}
                  onChange={e => setEditSearch(e.target.value)}
                  className="bg-spal-bg border border-white/10 rounded px-2 py-1 text-spal-text text-xs focus:outline-none focus:border-spal-cerulean w-36"
                />
              </div>

              {editError && <p className="text-xs text-spal-error">{editError}</p>}

              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {editVisiblePlayers.length === 0 ? (
                  <p className="text-spal-muted text-xs py-2">No eligible players match.</p>
                ) : (
                  editVisiblePlayers.map(p => {
                    const isCurrent = p.id === editingPick.player_id
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between px-2 py-1.5 rounded text-xs ${isCurrent ? 'bg-spal-cerulean/10' : 'hover:bg-white/5'}`}
                      >
                        <span className={isCurrent ? 'text-spal-text font-medium' : 'text-spal-text'}>
                          {p.display_name}
                          {isCurrent && <span className="text-spal-muted font-normal ml-1">(current)</span>}
                        </span>
                        <button
                          onClick={() => handleSaveEdit(p.id)}
                          disabled={editSaving || isCurrent}
                          className={`ml-3 px-2 py-0.5 rounded text-xs font-semibold transition-colors disabled:opacity-40 ${
                            isCurrent
                              ? 'bg-white/5 text-spal-muted cursor-default'
                              : 'bg-spal-cerulean/20 text-spal-cerulean hover:bg-spal-cerulean/30'
                          }`}
                        >
                          {editSaving ? '…' : isCurrent ? 'Current' : 'Replace'}
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>

    <ConfirmModal
      open={confirmModal === 'start'}
      title="Start draft"
      message="This will activate the draft session and put the first manager on the clock."
      confirmLabel="Start"
      onConfirm={() => { setConfirmModal(null); handleStart() }}
      onCancel={() => setConfirmModal(null)}
    />
    <ConfirmModal
      open={confirmModal === 'reopen'}
      title="Reopen draft"
      message="This will reactivate the session from the next unfilled pick."
      confirmLabel="Reopen"
      danger
      onConfirm={() => { setConfirmModal(null); handleReopen() }}
      onCancel={() => setConfirmModal(null)}
    />
    <ConfirmModal
      open={confirmModal === 'restart'}
      title="Restart draft"
      message="This will delete ALL draft picks for this season and reset the session to pending. This cannot be undone."
      confirmLabel="Restart"
      danger
      onConfirm={() => { setConfirmModal(null); handleRestart() }}
      onCancel={() => setConfirmModal(null)}
    />
    </>
  )
}

function btn(variant: 'cerulean' | 'muted' | 'warning' | 'danger') {
  const base = 'px-3 py-1.5 rounded text-xs font-medium transition-colors'
  if (variant === 'cerulean') return `${base} bg-spal-cerulean text-white hover:bg-spal-cerulean-light`
  if (variant === 'warning')  return `${base} bg-spal-warning text-spal-bg hover:opacity-90`
  if (variant === 'danger')   return `${base} bg-red-600/20 text-red-400 border border-red-600/30 hover:bg-red-600/30`
  return `${base} bg-white/10 text-spal-muted hover:bg-white/20`
}

const inputClass =
  'w-20 bg-spal-bg border border-white/10 rounded px-2 py-1 text-spal-text text-xs focus:outline-none focus:border-spal-cerulean'
