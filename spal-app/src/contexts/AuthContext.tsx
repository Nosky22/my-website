import { createContext, useEffect, useRef, useState } from 'react'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export interface Profile {
  id: string
  email: string
  display_name: string
  team_name: string
  avatar_url: string | null
  is_admin: boolean
}

export interface AuthContextValue {
  user: User | null
  session: Session | null
  profile: Profile | null
  isAdmin: boolean
  loading: boolean
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, display_name, team_name, avatar_url, is_admin')
    .eq('id', userId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      // No row found — handle_new_user trigger may have failed.
      // Treat as authenticated but non-admin rather than locking the user out.
      console.warn(
        '[AuthContext] No profile row for user', userId,
        '— trigger may have failed. User is authenticated but treated as non-admin.'
      )
    } else {
      console.error('[AuthContext] Profile fetch error:', error.message)
    }
    return null
  }

  return data as Profile
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, newSession) => {
        // INITIAL_SESSION is handled below via getSession() — skip here to avoid
        // double-processing the initial state and the extra loading=true cycle.
        if (event === 'INITIAL_SESSION') return

        // TOKEN_REFRESHED: JWT rotated, user identity unchanged — update session silently
        if (event === 'TOKEN_REFRESHED') {
          if (mounted.current) {
            setSession(newSession)
            setUser(newSession?.user ?? null)
          }
          return
        }

        // USER_UPDATED: re-fetch profile in case display_name/is_admin changed, but
        // no loading state — the user is already authenticated and the page stays visible
        if (event === 'USER_UPDATED') {
          const updatedUser = newSession?.user ?? null
          const updatedProfile = updatedUser ? await fetchProfile(updatedUser.id) : null
          if (mounted.current) {
            setSession(newSession)
            setUser(updatedUser)
            setProfile(updatedProfile)
          }
          return
        }

        // SIGNED_IN / SIGNED_OUT: genuine auth state change —
        // hold loading=true until profile is fully resolved to prevent premature redirects
        if (mounted.current) setLoading(true)

        const newUser = newSession?.user ?? null
        const newProfile = newUser ? await fetchProfile(newUser.id) : null

        if (mounted.current) {
          setSession(newSession)
          setUser(newUser)
          setProfile(newProfile)
          setLoading(false)
        }
      }
    )

    // Pre-populate state from the stored session immediately. getSession() reads
    // from memory/storage without a network round-trip, so this resolves faster
    // than waiting for the INITIAL_SESSION event dispatch.
    supabase.auth.getSession().then(async ({ data: { session: storedSession } }) => {
      if (!mounted.current) return
      const storedUser = storedSession?.user ?? null
      const storedProfile = storedUser ? await fetchProfile(storedUser.id) : null
      if (mounted.current) {
        setSession(storedSession)
        setUser(storedUser)
        setProfile(storedProfile)
        setLoading(false)
      }
    })

    return () => {
      mounted.current = false
      subscription.unsubscribe()
    }
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      isAdmin: profile?.is_admin ?? false,
      loading,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}
