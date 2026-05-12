import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// The anon key is safe to expose in the browser — RLS is the security layer.
// The service role key must never appear in this file or anywhere under src/.
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
