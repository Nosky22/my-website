import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart2, BookOpen, ChevronDown, ClipboardList, Clock,
  FileText, Gamepad2, Home, LayoutDashboard, Lightbulb, LogIn,
  Menu, Radio, Scale, Settings, Shield, Shuffle, Star,
  Swords, Target, TrendingUp, Trophy, User, Users, X,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

interface NavGroup {
  id: string
  label: string
  icon: LucideIcon
  items: NavItem[]
}

export default function SpalNav() {
  const { user, profile, isAdmin, loading, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const navRef = useRef<HTMLElement>(null)
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Close dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenGroup(null)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Close menus on navigation
  useEffect(() => {
    setOpenGroup(null)
    setMobileOpen(false)
  }, [location.pathname])

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  // ── Group definitions ──────────────────────────────────────────────

  const leagueGroup: NavGroup = {
    id: 'league', label: 'League', icon: Trophy,
    items: [
      { to: '/standings', label: 'Standings', icon: BarChart2 },
      { to: '/h2h',       label: 'H2H Cup',   icon: Swords },
      { to: '/alltime',   label: 'All-Time',  icon: Star },
    ],
  }

  const playersGroup: NavGroup = {
    id: 'players', label: 'Players', icon: Users,
    items: [
      { to: '/players',         label: 'Players',     icon: User,          end: true },
      { to: '/players/alltime', label: 'Top Players', icon: TrendingUp },
      { to: '/teamsheets',      label: 'Team Sheets', icon: ClipboardList },
    ],
  }

  const competitionItems: NavItem[] = [
    { to: '/predos', label: 'Predos', icon: Target },
    { to: '/draft',  label: 'Draft',  icon: Shuffle },
    ...(!loading && user ? [
      { to: '/draft-room', label: 'Draft Room', icon: Radio  } as NavItem,
      { to: '/squad',      label: 'Squad',      icon: Shield } as NavItem,
    ] : []),
  ]

  const competitionGroup: NavGroup = {
    id: 'competition', label: 'Competition', icon: Gamepad2,
    items: competitionItems,
  }

  const historyGroup: NavGroup = {
    id: 'history', label: 'History', icon: BookOpen,
    items: [
      { to: '/history',   label: 'History',   icon: Clock },
      { to: '/chronicle', label: 'Chronicle', icon: FileText },
      { to: '/insights',  label: 'Insights',  icon: Lightbulb },
    ],
  }

  const groups: NavGroup[] = [leagueGroup, playersGroup, competitionGroup, historyGroup]

  function isGroupActive(group: NavGroup): boolean {
    return group.items.some(item =>
      item.end
        ? location.pathname === item.to
        : location.pathname.startsWith(item.to)
    )
  }

  // All links for the mobile flat list
  const mobileLinks: NavItem[] = [
    { to: '/', label: 'Home', icon: Home, end: true },
    ...(!loading && user ? [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard } as NavItem] : []),
    ...leagueGroup.items,
    ...playersGroup.items,
    ...competitionItems,
    ...historyGroup.items,
    { to: '/laws', label: 'Laws', icon: Scale },
    ...(!loading && isAdmin ? [{ to: '/admin', label: 'Admin', icon: Settings } as NavItem] : []),
  ]

  // ── Style helpers ──────────────────────────────────────────────────

  const desktopLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-1.5 px-3 py-3 text-sm whitespace-nowrap transition-colors border-b-2 ${
      isActive
        ? 'text-spal-cerulean border-spal-cerulean'
        : 'text-spal-muted border-transparent hover:text-spal-text'
    }`

  const groupTriggerClass = (active: boolean, open: boolean) =>
    `flex items-center gap-1.5 px-3 py-3 text-sm whitespace-nowrap transition-colors border-b-2 ${
      active || open
        ? 'text-spal-cerulean border-spal-cerulean'
        : 'text-spal-muted border-transparent hover:text-spal-text'
    }`

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <nav ref={navRef} className="bg-spal-surface border-b border-white/5 relative" aria-label="SPAL navigation">
      <div className="max-w-spal mx-auto px-6 flex items-center">

        {/* ── Desktop nav — hidden on mobile ── */}
        <div className="hidden md:flex items-center gap-1 w-full">

          {/* Home */}
          <NavLink to="/" end className={desktopLinkClass}>
            <Home size={13} />
            Home
          </NavLink>

          {/* Dashboard (logged-in only) */}
          {!loading && user && (
            <NavLink to="/dashboard" end={false} className={desktopLinkClass}>
              <LayoutDashboard size={13} />
              Dashboard
            </NavLink>
          )}

          {/* Grouped dropdowns */}
          {groups.map(group => {
            const active = isGroupActive(group)
            const isOpen = openGroup === group.id
            const GroupIcon = group.icon
            return (
              <div key={group.id} className="relative">
                <button
                  onClick={() => setOpenGroup(g => g === group.id ? null : group.id)}
                  className={groupTriggerClass(active, isOpen)}
                  aria-expanded={isOpen}
                  aria-haspopup="true"
                >
                  <GroupIcon size={13} />
                  {group.label}
                  <ChevronDown
                    size={11}
                    className={`transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {isOpen && (
                  <div className="absolute top-full left-0 mt-0.5 w-44 bg-spal-surface border border-white/10 rounded-lg shadow-xl z-50 py-1.5">
                    {group.items.map(item => {
                      const ItemIcon = item.icon
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.end}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                              isActive
                                ? 'text-spal-cerulean bg-spal-cerulean/5'
                                : 'text-spal-muted hover:text-spal-text hover:bg-white/5'
                            }`
                          }
                        >
                          <ItemIcon size={13} />
                          {item.label}
                        </NavLink>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {/* Right side — pushed to far right */}
          <div className="ml-auto flex items-center gap-1">
            <NavLink to="/laws" end={false} className={desktopLinkClass}>
              <Scale size={13} />
              Laws
            </NavLink>

            {!loading && isAdmin && (
              <NavLink to="/admin" end={false} className={desktopLinkClass}>
                <Settings size={13} />
                Admin
              </NavLink>
            )}

            {!loading && !user && (
              <NavLink to="/login" end={false} className={desktopLinkClass}>
                <LogIn size={13} />
                Sign in
              </NavLink>
            )}

            {!loading && user && (
              <>
                {profile?.display_name && (
                  <span className="text-sm text-spal-muted whitespace-nowrap px-2">
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

        {/* ── Mobile bar — visible below md: ── */}
        <div className="flex md:hidden items-center justify-between w-full py-1">
          <span className="text-sm font-semibold text-spal-yellow">SPAL</span>
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 text-spal-muted hover:text-spal-text transition-colors"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>

      {/* ── Mobile full-screen overlay ── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 bg-spal-bg flex flex-col md:hidden overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
            <span className="text-sm font-semibold text-spal-yellow">SPAL</span>
            <button
              onClick={() => setMobileOpen(false)}
              className="p-2 text-spal-muted hover:text-spal-text transition-colors"
              aria-label="Close menu"
            >
              <X size={20} />
            </button>
          </div>

          <div className="overflow-y-auto flex-1 px-4 py-3 space-y-0.5">
            {mobileLinks.map(item => {
              const ItemIcon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors ${
                      isActive
                        ? 'text-spal-cerulean bg-spal-cerulean/10'
                        : 'text-spal-muted hover:text-spal-text hover:bg-white/5'
                    }`
                  }
                >
                  <ItemIcon size={16} />
                  {item.label}
                </NavLink>
              )
            })}

            <div className="border-t border-white/5 mt-2 pt-2">
              {!loading && !user ? (
                <NavLink
                  to="/login"
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors ${
                      isActive
                        ? 'text-spal-cerulean bg-spal-cerulean/10'
                        : 'text-spal-muted hover:text-spal-text hover:bg-white/5'
                    }`
                  }
                >
                  <LogIn size={16} />
                  Sign in
                </NavLink>
              ) : !loading && user ? (
                <div>
                  {profile?.display_name && (
                    <p className="px-4 py-2 text-xs text-spal-muted">{profile.display_name}</p>
                  )}
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-spal-muted hover:text-spal-text hover:bg-white/5 transition-colors text-left"
                  >
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
