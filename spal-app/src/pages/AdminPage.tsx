import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Stats {
  seasons: number
  players: number
  managers: number
}

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    Promise.all([
      supabase.from('seasons').select('id', { count: 'exact', head: true }),
      supabase.from('players').select('id', { count: 'exact', head: true }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
    ]).then(([seasons, players, profiles]) => {
      setStats({
        seasons:  seasons.count  ?? 0,
        players:  players.count  ?? 0,
        managers: profiles.count ?? 0,
      })
    })
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold text-spal-yellow mb-6">Admin</h1>
      {stats && (
        <div className="flex gap-4">
          <StatCard label="Seasons"  value={stats.seasons}  />
          <StatCard label="Players"  value={stats.players}  />
          <StatCard label="Managers" value={stats.managers} />
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-spal-surface rounded p-4 w-32 text-center">
      <div className="text-3xl font-bold text-spal-text">{value}</div>
      <div className="text-xs text-spal-muted mt-1">{label}</div>
    </div>
  )
}
