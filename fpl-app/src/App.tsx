import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

function HubPage({ session }: { session: Session }) {
  return (
    <div className="min-h-screen bg-fpl-bg text-fpl-text flex flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-bold text-fpl-gold">FPL Badger</h1>
      <p className="text-fpl-muted">Signed in as {session.user.email}</p>
      <button
        onClick={() => supabase.auth.signOut()}
        className="px-4 py-2 text-sm text-fpl-muted border border-fpl-accent rounded hover:text-fpl-text transition-colors"
      >
        Sign out
      </button>
    </div>
  )
}

function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + '/fpl/' },
    })
    if (!error) setSent(true)
    else alert(error.message)
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-fpl-bg text-fpl-text flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold text-fpl-gold">FPL Badger</h1>
        <p className="text-fpl-muted">Magic link sent — check your email.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-fpl-bg text-fpl-text flex flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold text-fpl-gold">FPL Badger</h1>
      <p className="text-fpl-muted text-sm mb-2">Private — authorised access only.</p>
      <form onSubmit={handleLogin} className="flex flex-col gap-3 w-72">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="your@email.com"
          required
          className="bg-fpl-surface border border-fpl-accent text-fpl-text px-3 py-2 rounded text-sm outline-none focus:border-fpl-accent-light"
        />
        <button
          type="submit"
          className="bg-fpl-accent text-white py-2 rounded text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          Send magic link
        </button>
      </form>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return null

  return (
    <BrowserRouter basename="/fpl">
      <Routes>
        <Route
          path="/"
          element={session ? <HubPage session={session} /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/login"
          element={session ? <Navigate to="/" replace /> : <LoginPage />}
        />
      </Routes>
    </BrowserRouter>
  )
}
