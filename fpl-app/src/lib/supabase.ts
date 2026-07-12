import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

// Publishable key is safe to expose in the browser — RLS is the security layer.
// Service role key must never appear in this file or anywhere under src/.
export const supabase = createClient(supabaseUrl, supabaseKey)
