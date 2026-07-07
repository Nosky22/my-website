import { useEffect } from 'react'

const PLANNED_FEATURES = [
  {
    title: 'CSV score upload',
    body:  'Upload a spreadsheet of player scores after each round. The pipeline will parse, validate, and stage rows for admin review before promoting them to the live scores table.',
  },
  {
    title: 'Official API adapter for 2027',
    body:  'Auto-import player scores directly from the official Fantasy Six Nations API each round, with a data quality pass to flag anomalies before they go live.',
  },
  {
    title: 'Data quality dashboard',
    body:  'Review flagged records — duplicate players, missing prices, out-of-range scores — and resolve or override them before finalising a round.',
  },
  {
    title: 'Import history',
    body:  'Full audit trail of every import run: source, timestamp, rows staged, rows promoted, and any issues encountered.',
  },
]

export default function AdminImportsPage() {
  useEffect(() => { document.title = 'Imports — Admin — SPAL' }, [])
  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-2xl font-bold text-spal-yellow">Imports</h1>
        <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">
          Coming in a future update
        </span>
      </div>
      <p className="text-spal-muted text-sm mb-8">
        The import pipeline will let you bring player scores into SPAL from external sources — either by uploading a file manually or through a direct API connection.
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
