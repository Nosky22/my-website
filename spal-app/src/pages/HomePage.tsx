import { Link } from 'react-router-dom'

export default function HomePage() {
  return (
    <div className="max-w-xl">
      <h1 className="text-4xl font-bold text-spal-yellow mb-3">
        Sergio Parisse Appreciation League
      </h1>
      <p className="text-spal-muted text-lg mb-8">
        A private fantasy rugby draft league for the Men's Six Nations.
      </p>

      <div className="flex gap-3 mb-14">
        <Link
          to="/standings"
          className="px-5 py-2.5 bg-spal-cerulean text-white rounded text-sm font-medium hover:bg-spal-cerulean-light transition-colors"
        >
          View League
        </Link>
        <Link
          to="/login"
          className="px-5 py-2.5 bg-spal-surface border border-white/10 text-spal-text rounded text-sm font-medium hover:border-spal-cerulean transition-colors"
        >
          Manager Login
        </Link>
      </div>

      <div className="border-t border-white/10 pt-10">
        <h2 className="text-sm font-semibold text-spal-muted uppercase tracking-wider mb-3">What is SPAL?</h2>
        <p className="text-spal-text leading-relaxed">
          SPAL is an invite-only fantasy rugby league built around the Six Nations. Each manager drafts
          a squad of international players before the tournament begins, then picks a starting XV each
          round to score points based on real match performance. At the end of the Six Nations, the
          manager with the most points wins.
        </p>
      </div>
    </div>
  )
}
