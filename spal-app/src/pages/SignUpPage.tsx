import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type PageStatus = 'idle' | 'submitting' | 'done'

export default function SignUpPage() {
  useEffect(() => { document.title = 'Sign Up — SPAL' }, [])
  const [searchParams] = useSearchParams()
  const [inviteToken, setInviteToken] = useState(() => searchParams.get('token') ?? '')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [error, setError]             = useState<string | null>(null)
  const [status, setStatus]           = useState<PageStatus>('idle')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setStatus('submitting')

    // ── 1. Verify invite token ────────────────────────────────────────────
    const token = inviteToken.trim()
    if (!token) {
      setError('An invite code is required.')
      setStatus('idle')
      return
    }

    const { data: tokenRow } = await supabase
      .from('invite_tokens')
      .select('id')
      .eq('token', token)
      .is('claimed_by', null)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .maybeSingle()

    if (!tokenRow) {
      setError('Invalid or already used invite code.')
      setStatus('idle')
      return
    }

    // ── 2. Create account ─────────────────────────────────────────────────
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Passed as raw_user_meta_data so handle_new_user trigger can seed the profile
        data: { display_name: displayName },
      },
    })

    if (authError) {
      setError(authError.message)
      setStatus('idle')
      return
    }

    // ── 3. Claim token ────────────────────────────────────────────────────
    // claim_invite_token is a security-definer RPC callable by anon, so this
    // works whether or not the session is immediately available (email
    // confirmation on or off).
    if (authData.user) {
      await supabase.rpc('claim_invite_token', {
        p_token:   token,
        p_user_id: authData.user.id,
      })
    }

    setStatus('done')
  }

  if (status === 'done') {
    return (
      <div className="max-w-sm mx-auto mt-12">
        <div className="bg-spal-surface rounded p-8 text-center">
          <h1 className="text-2xl font-bold text-spal-yellow mb-3">Check your email</h1>
          <p className="text-spal-muted text-sm">
            A confirmation link has been sent to{' '}
            <span className="text-spal-text">{email}</span>.
            Click it to activate your account.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-block text-sm text-spal-cerulean hover:text-spal-cerulean-light transition-colors"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-sm mx-auto mt-12">
      <div className="bg-spal-surface rounded p-8">
        <h1 className="text-2xl font-bold text-spal-yellow mb-1">Create account</h1>
        <p className="text-spal-muted text-sm mb-6">
          SPAL is invite-only. Enter the invite code shared with you by the commissioner.
        </p>

        {error && (
          <p className="text-spal-error text-sm mb-4 p-3 bg-spal-surface-raised rounded">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="inviteToken" className="text-sm text-spal-muted">Invite code</label>
            <input
              id="inviteToken"
              type="text"
              value={inviteToken}
              onChange={e => setInviteToken(e.target.value)}
              placeholder="e.g. X7K2M9PQAR"
              autoComplete="off"
              required
              className="bg-spal-surface-raised text-spal-text px-3 py-2 rounded text-sm font-mono outline-none focus:ring-1 focus:ring-spal-cerulean tracking-widest"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="displayName" className="text-sm text-spal-muted">Your name</label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              autoComplete="name"
              required
              className="bg-spal-surface-raised text-spal-text px-3 py-2 rounded text-sm outline-none focus:ring-1 focus:ring-spal-cerulean"
            />
          </div>

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
              autoComplete="new-password"
              minLength={8}
              required
              className="bg-spal-surface-raised text-spal-text px-3 py-2 rounded text-sm outline-none focus:ring-1 focus:ring-spal-cerulean"
            />
          </div>

          <button
            type="submit"
            disabled={status === 'submitting'}
            className="mt-2 bg-spal-cerulean text-white py-2 rounded text-sm font-medium hover:bg-spal-cerulean-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'submitting' ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-sm text-spal-muted mt-6 text-center">
          Already have an account?{' '}
          <Link to="/login" className="text-spal-cerulean hover:text-spal-cerulean-light transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
