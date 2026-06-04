interface ErrorCardProps {
  onRetry: () => void
}

export default function ErrorCard({ onRetry }: ErrorCardProps) {
  return (
    <div className="bg-spal-surface border border-white/10 rounded-lg p-8 text-center">
      <p className="text-spal-muted text-sm mb-4">Something went wrong loading this page.</p>
      <button
        onClick={onRetry}
        className="px-4 py-2 text-sm bg-spal-cerulean text-white rounded hover:bg-spal-cerulean-light transition-colors"
      >
        Try again
      </button>
    </div>
  )
}
