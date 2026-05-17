import { supabase } from '../lib/supabase'
import type { DraftSession } from '../hooks/useDraftSession'

interface Props {
  session: DraftSession
  totalPicks: number
  timeRemaining: number | null
}

export default function DraftRoomAdminBar({ session, totalPicks, timeRemaining }: Props) {
  const deadline = () =>
    new Date(Date.now() + session.pick_timer_seconds * 1000).toISOString()

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
    const next = session.current_pick_number + 1
    const isComplete = next > totalPicks
    await supabase.from('draft_sessions').update({
      current_pick_number: next,
      status: isComplete ? 'complete' : 'active',
      pick_deadline: isComplete ? null : deadline(),
      ...(isComplete ? { completed_at: new Date().toISOString() } : {}),
    }).eq('id', session.id)
  }

  const isExpired = timeRemaining === 0

  return (
    <div className="flex flex-wrap items-center gap-3 mb-6 px-4 py-3 bg-spal-surface rounded border border-white/10">
      <span className="text-xs font-semibold text-spal-muted uppercase tracking-wider">Admin</span>
      <span className="text-white/20 select-none">|</span>

      {session.status === 'pending' && (
        <button onClick={handleStart} className={btn('cerulean')}>
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

      {(session.status === 'active' || session.status === 'paused') && isExpired && (
        <button onClick={handleAdvance} className={btn('warning')}>
          Advance Pick
        </button>
      )}

      {session.status === 'complete' && (
        <span className="text-xs text-spal-success">Draft complete — no further actions</span>
      )}
    </div>
  )
}

function btn(variant: 'cerulean' | 'muted' | 'warning') {
  const base = 'px-3 py-1.5 rounded text-xs font-medium transition-colors'
  if (variant === 'cerulean') return `${base} bg-spal-cerulean text-white hover:bg-spal-cerulean-light`
  if (variant === 'warning')  return `${base} bg-spal-warning text-spal-bg hover:opacity-90`
  return `${base} bg-white/10 text-spal-muted hover:bg-white/20`
}
