import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const publicLinks = [
  { to: '/',          label: 'Home',      end: true  },
  { to: '/standings', label: 'Standings', end: false },
  { to: '/h2h',        label: 'H2H Cup',    end: false },
  { to: '/predos',     label: 'Predos',     end: false },
  { to: '/teamsheets', label: 'Team Sheets', end: false },
  { to: '/players',    label: 'Players',    end: false },
  { to: '/laws',      label: 'Laws',      end: false },
  { to: '/history',   label: 'History',   end: false },
  { to: '/alltime',   label: 'All-Time',  end: false },
]

const managerLinks = [
  { to: '/dashboard',  label: 'Dashboard',  end: false },
  { to: '/draft-room', label: 'Draft Room', end: false },
  { to: '/draft',      label: 'Draft',      end: false },
  { to: '/squad',      label: 'Squad',      end: false },
]

const adminLinks = [
  { to: '/admin', label: 'Admin', end: false },
]

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-3 text-sm whitespace-nowrap transition-colors border-b-2 ${
    isActive
      ? 'text-spal-cerulean border-spal-cerulean'
      : 'text-spal-muted border-transparent hover:text-spal-text'
  }`

export default function SpalNav() {
  const { user, profile, isAdmin, loading, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  // Guard on !loading so the nav doesn't flicker: links are absent during the
  // loading window, then appear once — no intermediate state where they show
  // briefly then vanish.
  const visibleLinks = [
    ...publicLinks,
    ...(!loading && user    ? managerLinks : []),
    ...(!loading && isAdmin ? adminLinks   : []),
  ]

  return (
    <nav className="bg-spal-surface border-b border-white/5" aria-label="SPAL navigation">
      <div className="max-w-spal mx-auto px-6 flex items-center gap-1 overflow-x-auto">

        {visibleLinks.map(({ to, label, end }) => (
          <NavLink key={to} to={to} end={end} className={linkClass}>
            {label}
          </NavLink>
        ))}

        {/* Push auth action to the right */}
        <div className="ml-auto flex items-center">
          {!loading && !user && (
            <NavLink to="/login" end={false} className={linkClass}>
              Sign in
            </NavLink>
          )}

          {!loading && user && (
            <>
              {profile?.display_name && (
                <span className="text-sm text-spal-muted whitespace-nowrap">
                  {profile.display_name}
                </span>
              )}
              <button
                onClick={handleSignOut}
                className="px-3 py-3 text-sm whitespace-nowrap text-spal-muted border-b-2 border-transparent hover:text-spal-text transition-colors"
              >
                Sign out
              </button>
            </>
          )}
        </div>

      </div>
    </nav>
  )
}
