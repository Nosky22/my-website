interface Props {
  open: boolean
  title: string
  message?: string
  children?: React.ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  open,
  title,
  message,
  children,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-spal-surface rounded-lg px-6 py-5 max-w-sm w-full mx-4 shadow-xl border border-white/10">
        <h2 className="text-base font-semibold text-spal-text mb-3">{title}</h2>
        {children ?? (message && <p className="text-sm text-spal-muted mb-5">{message}</p>)}
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded text-sm text-spal-muted hover:text-spal-text bg-white/5 hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              danger
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-spal-cerulean text-white hover:bg-spal-cerulean-light'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
