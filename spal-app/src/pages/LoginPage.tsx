import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const { user, loading } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()
  const from = (location.state as { from?: { pathname: string } } | null)
    ?.from?.pathname ?? '/dashboard'

  // Already logged in — skip the form
  useEffect(() => {
    if (!loading && user) navigate('/dashboard', { replace: true })
  }, [user, loading, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError(authError.message)
      setSubmitting(false)
      return
    }

    navigate(from, { replace: true })
  }

  return (
    <div className="max-w-sm mx-auto mt-12">
      <div className="bg-spal-surface rounded p-8">
        <h1 className="text-2xl font-bold text-spal-yellow mb-1">Sign in</h1>
        <p className="text-spal-muted text-sm mb-6">Manager access — invite only.</p>

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

          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-sm text-spal-muted">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="bg-spal-surface-raised text-spal-text px-3 py-2 rounded text-sm outline-none focus:ring-1 focus:ring-spal-cerulean"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 bg-spal-cerulean text-white py-2 rounded text-sm font-medium hover:bg-spal-cerulean-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-sm text-spal-muted mt-6 text-center">
          New manager?{' '}
          <Link to="/signup" className="text-spal-cerulean hover:text-spal-cerulean-light transition-colors">
            Create account
          </Link>
        </p>
      </div>
    </div>
  )
}
