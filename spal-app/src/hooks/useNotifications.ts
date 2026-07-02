import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface Notification {
  id: number
  type: string
  message: string
  read: boolean
  created_at: string
  season_id: number | null
}

export function useNotifications() {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])

  const load = useCallback(async () => {
    if (!user) { setNotifications([]); return }
    const { data } = await supabase
      .from('notifications')
      .select('id, type, message, read, created_at, season_id')
      .eq('profile_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
    setNotifications(data ?? [])
  }, [user])

  useEffect(() => { load() }, [load])

  const unreadCount = notifications.filter(n => !n.read).length

  async function markAllRead() {
    if (!user || unreadCount === 0) return
    const ids = notifications.filter(n => !n.read).map(n => n.id)
    await supabase.from('notifications').update({ read: true }).in('id', ids)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  return { notifications, unreadCount, markAllRead }
}
