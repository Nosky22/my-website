import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface DraftSession {
  id: number
  season_id: number
  status: 'pending' | 'active' | 'paused' | 'complete'
  current_pick_number: number
  pick_timer_seconds: number
  pick_deadline: string | null
  started_at: string | null
  completed_at: string | null
  updated_at: string
}

export function useDraftSession(seasonId: number | null) {
  const [session, setSession] = useState<DraftSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)

  useEffect(() => {
    if (seasonId == null) return
    setLoading(true)

    supabase
      .from('draft_sessions')
      .select('*')
      .eq('season_id', seasonId)
      .maybeSingle()
      .then(({ data }) => {
        setSession(data as DraftSession | null)
        setLoading(false)
      })

    const channel = supabase
      .channel(`draft-session:${seasonId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'draft_sessions', filter: `season_id=eq.${seasonId}` },
        (payload) => { setSession(payload.new as DraftSession) }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [seasonId])

  // Countdown — re-syncs from pick_deadline on every session update; ticks locally
  useEffect(() => {
    if (!session?.pick_deadline || session.status !== 'active') {
      setTimeRemaining(null)
      return
    }
    const tick = () => {
      const ms = new Date(session.pick_deadline!).getTime() - Date.now()
      setTimeRemaining(Math.max(0, Math.floor(ms / 1000)))
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [session?.pick_deadline, session?.status])

  return { session, loading, timeRemaining }
}
