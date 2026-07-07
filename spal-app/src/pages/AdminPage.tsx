import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface Stats {
  seasons: number
  players: number
  managers: number
}

const QUICK_LINKS = [
  {
    group: 'Round management',
    links: [
      { to: '/admin/scores',         label: 'Scores & pipeline', desc: 'Enter scores, close round, manage kickoffs' },
      { to: '/admin/predos',         label: 'Predos admin',      desc: 'View and edit all manager predictions' },
      { to: '/admin/squad-override', label: 'Squad override',    desc: 'Edit squad or predos on behalf of a manager' },
      { to: '/admin/teamsheets',     label: 'Team sheets',       desc: 'Import match-day squads' },
    ],
  },
  {
    group: 'League setup',
    links: [
      { to: '/admin/seasons',  label: 'Seasons',    desc: 'Create seasons, set rules, manage rounds' },
      { to: '/admin/draft',    label: 'Draft',      desc: 'Configure draft order and open the draft room' },
      { to: '/admin/managers', label: 'Managers',   desc: 'Manage accounts, merge duplicates' },
      { to: '/admin/players',  label: 'Players',    desc: 'Player roster and prices' },
      { to: '/admin/pool',     label: 'Pool',       desc: 'Season player pool and draft eligibility' },
    ],
  },
  {
    group: 'Content & data',
    links: [
      { to: '/admin/chronicle',  label: 'Chronicle',  desc: 'Write and manage league posts' },
      { to: '/admin/canonical',  label: 'Canonical',  desc: 'Resolve player identity across seasons' },
      { to: '/admin/imports',    label: 'Imports',    desc: 'Coming in a future update' },
      { to: '/admin/settings',   label: 'Settings',   desc: 'Coming in a future update' },
    ],
  },
]

export default function AdminPage() {
  useEffect(() => { document.title = 'Admin — SPAL' }, [])
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

      {/* Stats */}
      {stats && (
        <div className="flex gap-4 mb-10 flex-wrap">
          <StatCard label="Seasons"  value={stats.seasons}  />
          <StatCard label="Players"  value={stats.players}  />
          <StatCard label="Managers" value={stats.managers} />
        </div>
      )}

      {/* Quick links */}
      <div className="space-y-8">
        {QUICK_LINKS.map(section => (
          <div key={section.group}>
            <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">
              {section.group}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {section.links.map(link => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="block bg-spal-surface rounded p-4 border border-white/5 hover:border-spal-cerulean/30 transition-colors group"
                >
                  <div className="text-sm font-medium text-spal-text group-hover:text-spal-cerulean transition-colors">
                    {link.label}
                  </div>
                  <div className="text-xs text-spal-muted mt-0.5">{link.desc}</div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
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
