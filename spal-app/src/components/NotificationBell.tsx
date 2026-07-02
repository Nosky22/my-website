import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { useNotifications } from '../hooks/useNotifications'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function NotificationBell() {
  const { notifications, unreadCount, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  function handleToggle() {
    const nowOpen = !open
    setOpen(nowOpen)
    if (nowOpen) markAllRead()
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleToggle}
        className="relative px-3 py-3 text-spal-muted border-b-2 border-transparent hover:text-spal-text transition-colors"
        aria-label="Notifications"
      >
        <Bell size={15} />
        {unreadCount > 0 && (
          <span className="absolute top-2 right-1.5 min-w-[16px] h-4 px-0.5 flex items-center justify-center bg-spal-yellow text-spal-bg text-[10px] font-bold rounded-full leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-0.5 w-80 bg-spal-surface border border-white/10 rounded-lg shadow-xl z-50">
          <div className="px-3 py-2 border-b border-white/5">
            <p className="text-xs font-medium text-spal-muted">Notifications</p>
          </div>
          {notifications.length === 0 ? (
            <p className="px-3 py-4 text-xs text-spal-muted text-center">No notifications</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-white/5">
              {notifications.map(n => (
                <li key={n.id} className={`px-3 py-2.5 ${n.read ? '' : 'bg-white/[0.02]'}`}>
                  <p className="text-xs text-spal-text leading-snug">{n.message}</p>
                  <p className="text-[11px] text-spal-muted mt-0.5">{timeAgo(n.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
