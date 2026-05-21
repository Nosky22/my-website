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

  // Tracks the user ID that getSession() resolved with.
  // undefined  = getSession() hasn't resolved yet
  // null       = getSession() resolved with no session (user not logged in)
  // string     = getSession() resolved with this user ID
  //
  // Used to detect late SIGNED_IN events that Supabase fires for session
  // restoration (in addition to INITIAL_SESSION). When SIGNED_IN fires for
  // the same user ID that getSession() already resolved, we treat it as a
  // silent token update rather than re-running the loading+fetchProfile cycle.
  const initialisedUserId = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    mounted.current = true

    // The onAuthStateChange callback is intentionally non-async. Calling
    // supabase.from() inside the callback synchronously deadlocks because
    // Supabase holds an internal lock while dispatching the event. Any DB
    // work is deferred via setTimeout(0) to run after the callback returns.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, newSession) => {
        // INITIAL_SESSION is handled by the getSession() call below.
        if (event === 'INITIAL_SESSION') return

        // TOKEN_REFRESHED: JWT rotated, identity unchanged — update silently.
        if (event === 'TOKEN_REFRESHED') {
          if (mounted.current) {
            setSession(newSession)
            setUser(newSession?.user ?? null)
          }
          return
        }

        // SIGNED_OUT: clear all auth state synchronously — no DB fetch needed.
        if (event === 'SIGNED_OUT') {
          initialisedUserId.current = null
          if (mounted.current) {
            setSession(null)
            setUser(null)
            setProfile(null)
            setLoading(false)
          }
          return
        }

        // SIGNED_IN: check whether this is a late session-restoration event.
        //
        // Supabase fires SIGNED_IN for both genuine new logins AND when restoring
        // an existing session from storage (alongside INITIAL_SESSION). If
        // getSession() has already resolved with this same user ID, the work is
        // already done — just silently update the session token.
        if (event === 'SIGNED_IN') {
          const incomingId = newSession?.user?.id ?? null
          if (
            initialisedUserId.current !== undefined &&
            initialisedUserId.current === incomingId
          ) {
            if (mounted.current) {
              setSession(newSession)
              setUser(newSession?.user ?? null)
            }
            return
          }

          // Genuine new sign-in (getSession returned no user, or a different user).
          // Defer fetchProfile outside this callback to avoid the internal lock.
          if (mounted.current) setLoading(true)
          setTimeout(async () => {
            const newUser = newSession?.user ?? null
            const newProfile = newUser ? await fetchProfile(newUser.id) : null
            if (mounted.current) {
              setSession(newSession)
              setUser(newUser)
              setProfile(newProfile)
              setLoading(false)
            }
          }, 0)
          return
        }

        // USER_UPDATED: re-fetch profile in case display_name/is_admin changed.
        // Deferred for the same reason — no loading state change needed since
        // the user is already authenticated and the page stays visible.
        if (event === 'USER_UPDATED') {
          setTimeout(async () => {
            const updatedUser = newSession?.user ?? null
            const updatedProfile = updatedUser ? await fetchProfile(updatedUser.id) : null
            if (mounted.current) {
              setSession(newSession)
              setUser(updatedUser)
              setProfile(updatedProfile)
            }
          }, 0)
          return
        }
      }
    )

    // Pre-populate state from the stored session. getSession() reads from
    // localStorage without a network round-trip and runs outside the
    // onAuthStateChange callback, so fetchProfile here is safe to await.
    supabase.auth.getSession().then(async ({ data: { session: storedSession } }) => {
      if (!mounted.current) return
      const storedUser = storedSession?.user ?? null
      const storedProfile = storedUser ? await fetchProfile(storedUser.id) : null
      if (mounted.current) {
        setSession(storedSession)
        setUser(storedUser)
        setProfile(storedProfile)
        setLoading(false)
        // Record which user ID we resolved with so the SIGNED_IN handler can
        // recognise late session-restoration events and skip re-processing.
        initialisedUserId.current = storedUser?.id ?? null
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
