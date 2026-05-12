import { NavLink } from 'react-router-dom'

const links = [
  { to: '/',          label: 'Home',      end: true },
  { to: '/standings', label: 'Standings', end: false },
  { to: '/players',   label: 'Players',   end: false },
  { to: '/laws',      label: 'Laws',      end: false },
  { to: '/history',   label: 'History',   end: false },
  { to: '/draft',     label: 'Draft',     end: false },
  { to: '/squad',     label: 'Squad',     end: false },
  { to: '/admin',     label: 'Admin',     end: false },
]

export default function SpalNav() {
  return (
    <nav
      className="bg-spal-surface border-b border-white/5"
      aria-label="SPAL navigation"
    >
      <div className="max-w-spal mx-auto px-6 flex items-center gap-1 overflow-x-auto">
        {links.map(({ to, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `px-3 py-3 text-sm whitespace-nowrap transition-colors border-b-2 ${
                isActive
                  ? 'text-spal-cerulean border-spal-cerulean'
                  : 'text-spal-muted border-transparent hover:text-spal-text'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
