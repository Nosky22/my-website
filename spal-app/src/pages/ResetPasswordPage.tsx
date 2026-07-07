import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { friendlyAuthError } from '../lib/authErrors'

type PageState = 'waiting' | 'ready' | 'submitting' | 'done' | 'invalid'

export default function ResetPasswordPage() {
  useEffect(() => { document.title = 'Reset Password — SPAL' }, [])
  const [pageState, setPageState] = useState<PageState>('waiting')
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [error, setError]         = useState<string | null>(null)
  const navigate = useNavigate()

  // Supabase fires PASSWORD_RECOVERY once the client parses the hash tokens
  // from the magic link. After that the user has a short-lived session and can
  // call updateUser() to set their new password.
  const listenerAttached = useRef(false)
  useEffect(() => {
    if (listenerAttached.current) return
    listenerAttached.current = true

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setPageState('ready')
    })

    // If the page loads without a recovery token in the hash, give Supabase a
    // moment to parse it; if nothing arrives, show the invalid-link state.
    const timeout = setTimeout(() => {
      setPageState(s => s === 'waiting' ? 'invalid' : s)
    }, 3000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setPageState('submitting')
    const { error: authError } = await supabase.auth.updateUser({ password })

    if (authError) {
      setError(friendlyAuthError(authError.message))
      setPageState('ready')
    } else {
      setPageState('done')
      setTimeout(() => navigate('/dashboard', { replace: true }), 2000)
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-12">
      <div className="bg-spal-surface rounded p-8">
        <h1 className="text-2xl font-bold text-spal-yellow mb-1">Choose new password</h1>

        {pageState === 'waiting' && (
          <p className="text-spal-muted text-sm mt-4">Verifying link…</p>
        )}

        {pageState === 'invalid' && (
          <div className="mt-4 space-y-3">
            <p className="text-spal-error text-sm p-3 bg-spal-surface-raised rounded">
              This link is invalid or has expired.
            </p>
            <p className="text-spal-muted text-sm">
              <a
                href="/spal/forgot-password"
                className="text-spal-cerulean hover:text-spal-cerulean-light transition-colors"
              >
                Request a new reset link
              </a>
            </p>
          </div>
        )}

        {pageState === 'done' && (
          <p className="text-spal-text text-sm mt-4 p-3 bg-spal-surface-raised rounded">
            Password updated. Redirecting to your dashboard…
          </p>
        )}

        {(pageState === 'ready' || pageState === 'submitting') && (
          <>
            <p className="text-spal-muted text-sm mb-6">Enter your new password below.</p>

            {error && (
              <p className="text-spal-error text-sm mb-4 p-3 bg-spal-surface-raised rounded">
                {error}
              </p>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="password" className="text-sm text-spal-muted">New password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  className="bg-spal-surface-raised text-spal-text px-3 py-2 rounded text-sm outline-none focus:ring-1 focus:ring-spal-cerulean"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="confirm" className="text-sm text-spal-muted">Confirm password</label>
                <input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                  className="bg-spal-surface-raised text-spal-text px-3 py-2 rounded text-sm outline-none focus:ring-1 focus:ring-spal-cerulean"
                />
              </div>
              <button
                type="submit"
                disabled={pageState === 'submitting'}
                className="mt-2 bg-spal-cerulean text-white py-2 rounded text-sm font-medium hover:bg-spal-cerulean-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pageState === 'submitting' ? 'Updating…' : 'Update password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
