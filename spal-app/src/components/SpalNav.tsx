import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart2, BookOpen, Calendar, ChevronDown, ClipboardList, Clock,
  FileText, Home, LayoutDashboard, Lightbulb, LogIn,
  Menu, Radio, Scale, Settings, Shield, Shuffle, Star,
  Swords, Target, Users, X,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import NotificationBell from './NotificationBell'

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

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenGroup(null)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => {
    setOpenGroup(null)
    setMobileOpen(false)
  }, [location.key])

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  // ── Group definitions ──────────────────────────────────────────────

  const thisSeasonGroup: NavGroup = {
    id: 'thisseason', label: 'This Season', icon: Calendar,
    items: [
      { to: '/standings',  label: 'Standings',   icon: BarChart2 },
      { to: '/h2h',        label: 'H2H Cup',     icon: Swords },
      { to: '/predos',     label: 'Predos',      icon: Target },
      { to: '/teamsheets', label: 'Team Sheets', icon: ClipboardList },
      { to: '/insights',   label: 'Insights',    icon: Lightbulb },
      { to: '/draft',      label: 'Draft',       icon: Shuffle },
      ...(!loading && user ? [
        { to: '/draft-room', label: 'Draft Room', icon: Radio  } as NavItem,
        { to: '/squad',      label: 'Squad',      icon: Shield } as NavItem,
      ] : []),
    ],
  }

  const historyGroup: NavGroup = {
    id: 'history', label: 'History', icon: BookOpen,
    items: [
      { to: '/history',   label: 'Season Archive', icon: Clock },
      { to: '/alltime',   label: 'All-Time',        icon: Star },
      { to: '/chronicle', label: 'Chronicle',        icon: FileText },
    ],
  }

  function isGroupActive(group: NavGroup): boolean {
    return group.items.some(item =>
      item.end
        ? location.pathname === item.to
        : location.pathname.startsWith(item.to)
    )
  }

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

  const dropdownItemClass = (active: boolean) =>
    `flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
      active
        ? 'text-spal-cerulean bg-spal-cerulean/5'
        : 'text-spal-muted hover:text-spal-text hover:bg-white/5'
    }`

  const mobileLinkClass = (active: boolean) =>
    `flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors ${
      active
        ? 'text-spal-cerulean bg-spal-cerulean/10'
        : 'text-spal-muted hover:text-spal-text hover:bg-white/5'
    }`

  const mobileSectionHeader = (label: string, Icon: LucideIcon) => (
    <div className="flex items-center gap-2 px-4 pt-4 pb-1 text-xs font-semibold text-spal-muted uppercase tracking-wider">
      <Icon size={12} />
      {label}
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <nav ref={navRef} className="bg-spal-surface border-b border-white/5 relative" aria-label="SPAL navigation">
      <div className="max-w-spal mx-auto px-6 flex items-center">

        {/* ── Desktop nav ── */}
        <div className="hidden md:flex items-center gap-1 w-full">

          <NavLink to="/" end className={desktopLinkClass}>
            <Home size={13} />
            Home
          </NavLink>

          {!loading && user && (
            <NavLink to="/dashboard" className={desktopLinkClass}>
              <LayoutDashboard size={13} />
              Dashboard
            </NavLink>
          )}

          {[thisSeasonGroup, historyGroup].map(group => {
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
                  <ChevronDown size={11} className={`transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className="absolute top-full left-0 mt-0.5 w-48 bg-spal-surface border border-white/10 rounded-lg shadow-xl z-50 py-1.5">
                    {group.items.map(item => {
                      const ItemIcon = item.icon
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.end}
                          className={({ isActive }) => dropdownItemClass(isActive)}
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

          <NavLink to="/players" end className={desktopLinkClass}>
            <Users size={13} />
            Players
          </NavLink>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-1">
            {!loading && user && <NotificationBell />}
            <NavLink to="/laws" className={desktopLinkClass}>
              <Scale size={13} />
              Laws
            </NavLink>
            {!loading && isAdmin && (
              <NavLink to="/admin" className={desktopLinkClass}>
                <Settings size={13} />
                Admin
              </NavLink>
            )}
            {!loading && !user && (
              <NavLink to="/login" className={desktopLinkClass}>
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

        {/* ── Mobile bar ── */}
        <div className="flex md:hidden items-center justify-between w-full py-1">
          <span className="text-sm font-semibold text-spal-yellow">SPAL</span>
          <div className="flex items-center">
            {!loading && user && <NotificationBell />}
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 text-spal-muted hover:text-spal-text transition-colors"
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Mobile overlay ── */}
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

            <NavLink to="/" end className={({ isActive }) => mobileLinkClass(isActive)}>
              <Home size={16} />
              Home
            </NavLink>

            {!loading && user && (
              <NavLink to="/dashboard" className={({ isActive }) => mobileLinkClass(isActive)}>
                <LayoutDashboard size={16} />
                Dashboard
              </NavLink>
            )}

            {mobileSectionHeader('This Season', Calendar)}
            {thisSeasonGroup.items.map(item => {
              const ItemIcon = item.icon
              return (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => mobileLinkClass(isActive)}>
                  <ItemIcon size={16} />
                  {item.label}
                </NavLink>
              )
            })}

            {mobileSectionHeader('History', BookOpen)}
            {historyGroup.items.map(item => {
              const ItemIcon = item.icon
              return (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => mobileLinkClass(isActive)}>
                  <ItemIcon size={16} />
                  {item.label}
                </NavLink>
              )
            })}

            <div className="border-t border-white/5 mt-3 pt-3 space-y-0.5">
              <NavLink to="/players" end className={({ isActive }) => mobileLinkClass(isActive)}>
                <Users size={16} />
                Players
              </NavLink>
              <NavLink to="/laws" className={({ isActive }) => mobileLinkClass(isActive)}>
                <Scale size={16} />
                Laws
              </NavLink>
              {!loading && isAdmin && (
                <NavLink to="/admin" className={({ isActive }) => mobileLinkClass(isActive)}>
                  <Settings size={16} />
                  Admin
                </NavLink>
              )}
            </div>

            <div className="border-t border-white/5 mt-2 pt-2">
              {!loading && !user ? (
                <NavLink to="/login" className={({ isActive }) => mobileLinkClass(isActive)}>
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
