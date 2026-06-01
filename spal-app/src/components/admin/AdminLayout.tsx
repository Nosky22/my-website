import { NavLink, Outlet } from 'react-router-dom'

const adminLinks = [
  { to: '/admin',          label: 'Dashboard', end: true  },
  { to: '/admin/seasons',  label: 'Seasons',   end: false },
  { to: '/admin/players',   label: 'Players',   end: false },
  { to: '/admin/canonical', label: 'Canonical', end: false },
  { to: '/admin/pool',        label: 'Pool',        end: false },
  { to: '/admin/teamsheets', label: 'Team Sheets', end: false },
  { to: '/admin/draft',      label: 'Draft',       end: false },
  { to: '/admin/scores',    label: 'Scores',    end: false },
  { to: '/admin/managers',  label: 'Managers',  end: false },
  { to: '/admin/imports',   label: 'Imports',   end: false },
  { to: '/admin/chronicle', label: 'Chronicle', end: false },
  { to: '/admin/settings',  label: 'Settings',  end: false },
]

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block px-3 py-2 rounded text-sm transition-colors ${
    isActive
      ? 'bg-spal-cerulean/20 text-spal-cerulean'
      : 'text-spal-muted hover:text-spal-text'
  }`

export default function AdminLayout() {
  return (
    <div className="flex gap-8 items-start">
      <nav className="w-40 shrink-0 pt-1 space-y-0.5" aria-label="Admin navigation">
        {adminLinks.map(({ to, label, end }) => (
          <NavLink key={to} to={to} end={end} className={linkClass}>
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
