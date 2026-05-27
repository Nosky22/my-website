import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { DraftSession } from '../hooks/useDraftSession'
import { ConfirmModal } from './ConfirmModal'

interface Props {
  session: DraftSession
  totalPicks: number
  timeRemaining: number | null
}

export default function DraftRoomAdminBar({ session, totalPicks }: Props) {
  const [jumpTarget, setJumpTarget]     = useState<number | ''>('')
  const [jumpError, setJumpError]       = useState('')
  const [confirmModal, setConfirmModal] = useState<'start' | 'reopen' | null>(null)

  const deadline = () =>
    new Date(Date.now() + session.pick_timer_seconds * 1000).toISOString()

  // Returns a Set of pick_numbers that already have a draft_picks row.
  async function filledPickNumbers(): Promise<Set<number>> {
    const { data } = await supabase
      .from('draft_picks')
      .select('pick_number')
      .eq('season_id', session.season_id)
    return new Set((data ?? []).map((p: { pick_number: number }) => p.pick_number))
  }

  // Finds the lowest unfilled pick_number starting at `from`.
  async function nextUnfilled(from: number): Promise<number | null> {
    const filled = await filledPickNumbers()
    for (let i = from; i <= totalPicks; i++) {
      if (!filled.has(i)) return i
    }
    return null
  }

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

  const handleJump = async () => {
    const n = Number(jumpTarget)
    if (!n || n < 1 || n > totalPicks) {
      setJumpError(`Enter a pick number between 1 and ${totalPicks}`)
      return
    }
    const filled = await filledPickNumbers()
    if (filled.has(n)) {
      setJumpError(`Pick ${n} is already filled`)
      return
    }
    setJumpError('')
    await supabase.from('draft_sessions').update({
      current_pick_number: n,
      pick_deadline: deadline(),
    }).eq('id', session.id)
    setJumpTarget('')
  }

  const canAdvance = session.status === 'active' || session.status === 'paused'

  return (
    <>
    <div className="mb-6 px-4 py-3 bg-spal-surface rounded border border-white/10 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-spal-muted uppercase tracking-wider">Admin</span>
        <span className="text-white/20 select-none">|</span>

        {session.status === 'pending' && (
          <button onClick={() => setConfirmModal('start')} className={btn('cerulean')}>
            Start Draft
          </button>
        )}

        {session.status === 'active' && (
          <button onClick={handlePause} className={btn('muted')}>
            Pause
          </button>
        )}

        {session.status === 'paused' && (
          <button onClick={handleResume} className={btn('cerulean')}>
            Resume
          </button>
        )}

        {canAdvance && (
          <button onClick={handleAdvance} className={btn('warning')}>
            Advance Pick
          </button>
        )}

        {session.status === 'complete' && (
          <>
            <span className="text-xs text-spal-success">Draft complete</span>
            <button onClick={() => setConfirmModal('reopen')} className={btn('warning')}>
              Reopen Draft
            </button>
          </>
        )}
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
            className="w-20 bg-spal-bg border border-white/10 rounded px-2 py-1 text-spal-text text-xs focus:outline-none focus:border-spal-cerulean"
            placeholder="1…"
          />
          <button onClick={handleJump} className={btn('muted')}>
            Go
          </button>
          {jumpError && <span className="text-xs text-spal-error">{jumpError}</span>}
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
    </>
  )
}

function btn(variant: 'cerulean' | 'muted' | 'warning') {
  const base = 'px-3 py-1.5 rounded text-xs font-medium transition-colors'
  if (variant === 'cerulean') return `${base} bg-spal-cerulean text-white hover:bg-spal-cerulean-light`
  if (variant === 'warning')  return `${base} bg-spal-warning text-spal-bg hover:opacity-90`
  return `${base} bg-white/10 text-spal-muted hover:bg-white/20`
}
