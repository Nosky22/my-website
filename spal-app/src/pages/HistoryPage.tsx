export default function HistoryPage() {
  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-spal-yellow mb-1">History</h1>
      <p className="text-spal-muted text-sm mb-8">Past seasons and all-time records.</p>

      <div className="bg-spal-surface rounded p-6 space-y-4">
        <p className="text-spal-cerulean text-sm font-medium uppercase tracking-wider">Coming soon</p>
        <p className="text-spal-text text-sm leading-relaxed">
          Historical records are on the roadmap. When built, this section will include:
        </p>
        <ul className="text-spal-muted text-sm space-y-1.5 list-disc pl-5">
          <li>Season-by-season results and final standings</li>
          <li>All-time league table across every season</li>
          <li>Manager profile pages with career stats</li>
          <li>All-time top-scoring players</li>
          <li>Historical draft records</li>
          <li>Season review write-ups</li>
        </ul>
        <p className="text-spal-muted text-sm leading-relaxed pt-2">
          The data exists — the page is just waiting to be built.
        </p>
      </div>
    </div>
  )
}
