import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { friendlyAuthError } from '../lib/authErrors'

export default function ForgotPasswordPage() {
  useEffect(() => { document.title = 'Forgot Password — SPAL' }, [])
  const [email, setEmail]       = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent]         = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://nosky.co.uk/spal/reset-password',
    })

    if (authError) {
      setError(friendlyAuthError(authError.message))
      setSubmitting(false)
    } else {
      setSent(true)
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-12">
      <div className="bg-spal-surface rounded p-8">
        <h1 className="text-2xl font-bold text-spal-yellow mb-1">Reset password</h1>
        <p className="text-spal-muted text-sm mb-6">
          Enter your email and we'll send you a reset link.
        </p>

        {sent ? (
          <div className="space-y-4">
            <p className="text-spal-text text-sm p-3 bg-spal-surface-raised rounded">
              Check your inbox — a reset link is on its way to <strong>{email}</strong>.
            </p>
            <p className="text-spal-muted text-sm">
              Didn't receive it? Check your spam folder, or{' '}
              <button
                onClick={() => { setSent(false); setSubmitting(false) }}
                className="text-spal-cerulean hover:text-spal-cerulean-light transition-colors"
              >
                try again
              </button>
              .
            </p>
          </div>
        ) : (
          <>
            {error && (
              <p className="text-spal-error text-sm mb-4 p-3 bg-spal-surface-raised rounded">
                {error}
              </p>
            )}
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="email" className="text-sm text-spal-muted">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  className="bg-spal-surface-raised text-spal-text px-3 py-2 rounded text-sm outline-none focus:ring-1 focus:ring-spal-cerulean"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="mt-2 bg-spal-cerulean text-white py-2 rounded text-sm font-medium hover:bg-spal-cerulean-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          </>
        )}

        <p className="text-sm text-spal-muted mt-6 text-center">
          <Link to="/login" className="text-spal-cerulean hover:text-spal-cerulean-light transition-colors">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
