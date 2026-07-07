import { useEffect } from 'react'

const PLANNED_FEATURES = [
  {
    title: 'Email notifications',
    body:  'Automatic reminders to managers before the squad deadline, and alerts when round scores are finalised.',
  },
  {
    title: 'Guest access',
    body:  'Read-only shareable links so friends and family can follow the league without needing an account.',
  },
  {
    title: 'League preferences',
    body:  'Configure timezone, score display precision, and other league-wide options.',
  },
  {
    title: 'Danger zone',
    body:  'Archive a completed season, reset a draft in progress, or clear test data before a real season starts.',
  },
]

export default function AdminSettingsPage() {
  useEffect(() => { document.title = 'Settings — Admin — SPAL' }, [])
  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-2xl font-bold text-spal-yellow">Settings</h1>
        <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">
          Coming in a future update
        </span>
      </div>
      <p className="text-spal-muted text-sm mb-8">
        League-wide settings for notifications, access, and configuration. These controls will be available once the core scoring and squad workflow is stable.
      </p>

      <div className="space-y-4">
        {PLANNED_FEATURES.map(f => (
          <div key={f.title} className="bg-spal-surface rounded-lg p-5 border border-white/5">
            <h2 className="text-spal-text font-semibold mb-1">{f.title}</h2>
            <p className="text-sm text-spal-muted">{f.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
