// Replicates the nosky.co.uk header so SPAL pages feel continuous with the
// static site, even though SPAL runs in its own HTML document.
export default function SiteHeader() {
  return (
    <header className="bg-spal-surface h-[60px] flex items-center justify-between px-6 shrink-0">
      <a
        href="/"
        className="font-semibold text-base text-spal-text no-underline hover:text-spal-cerulean-light transition-colors"
      >
        nosky.co.uk
      </a>
      <nav className="flex items-center gap-6 text-sm" aria-label="Site navigation">
        <a href="/" className="text-spal-muted hover:text-spal-text transition-colors">Home</a>
        <a href="/games.html" className="text-spal-muted hover:text-spal-text transition-colors">Games</a>
        <a href="/music.html" className="text-spal-muted hover:text-spal-text transition-colors">Music</a>
        <a href="/apps.html" className="text-spal-muted hover:text-spal-text transition-colors">Apps</a>
        <a href="/fpl.html" className="text-spal-muted hover:text-spal-text transition-colors">FPL</a>
        <span className="text-spal-cerulean font-semibold" aria-current="page">SPAL</span>
      </nav>
    </header>
  )
}
