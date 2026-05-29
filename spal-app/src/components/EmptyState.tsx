interface Props {
  icon: React.ReactNode
  title: string
  body: string
}

export function EmptyState({ icon, title, body }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-spal-muted mb-4 opacity-50">{icon}</div>
      <p className="text-spal-text font-medium mb-1">{title}</p>
      <p className="text-sm text-spal-muted">{body}</p>
    </div>
  )
}
