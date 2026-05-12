import { Outlet } from 'react-router-dom'
import SiteHeader from './SiteHeader'
import SpalNav from './SpalNav'

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-spal-bg text-spal-text">
      <SiteHeader />
      <SpalNav />
      {/* max-w-spal (1200px) overrides the 860px nosky.co.uk constraint */}
      <main className="flex-1 w-full max-w-spal mx-auto px-6 py-10">
        <Outlet />
      </main>
      <footer className="bg-spal-surface py-6 px-6 text-center text-sm text-spal-muted">
        Sergio Parisse Appreciation League &middot;{' '}
        <a href="/" className="text-spal-muted hover:text-spal-text transition-colors">
          nosky.co.uk
        </a>
      </footer>
    </div>
  )
}
