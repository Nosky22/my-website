import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Tables that hold profile_id and must be empty for the placeholder after merge.
const PROFILE_FK_TABLES = [
  'draft_order',
  'draft_picks',
  'manager_round_squads',
  'manager_match_scores',
  'fixture_group_members',
  'season_standings',
  'league_penalties',
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify caller is an admin.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: callerProfile, error: profileError } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (profileError || !callerProfile?.is_admin) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { placeholder_id, real_id } = await req.json() as {
      placeholder_id: string
      real_id: string
    }

    if (!placeholder_id || !real_id) {
      return new Response(JSON.stringify({ error: 'placeholder_id and real_id are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Execute the atomic merge via SECURITY DEFINER RPC.
    const { data: mergeResult, error: mergeError } = await supabase.rpc('merge_profiles', {
      placeholder_id,
      real_id,
      admin_id: user.id,
    })

    if (mergeError) {
      return new Response(JSON.stringify({ error: mergeError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Post-merge verification ────────────────────────────────────────────
    // Confirm no rows in any FK table still reference the placeholder.
    const orphanChecks = await Promise.all(
      PROFILE_FK_TABLES.map(async (table) => {
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true })
          .eq('profile_id', placeholder_id)
        return { table, count: count ?? 0, error }
      })
    )

    const orphans = orphanChecks.filter(c => c.count > 0 || c.error)
    if (orphans.length > 0) {
      // Log the verification failure to audit_log before returning the error.
      await supabase.from('audit_log').insert({
        actor_id:    user.id,
        action:      'profile.merge_verification_failed',
        entity_type: 'profile',
        entity_id:   placeholder_id,
        season_id:   null,
        metadata:    { orphans },
      })

      return new Response(JSON.stringify({
        error: 'Post-merge verification failed: orphaned rows detected',
        orphans,
      }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Confirm the placeholder profiles row is gone.
    const { data: placeholderProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', placeholder_id)
      .maybeSingle()

    if (placeholderProfile) {
      await supabase.from('audit_log').insert({
        actor_id:    user.id,
        action:      'profile.merge_verification_failed',
        entity_type: 'profile',
        entity_id:   placeholder_id,
        season_id:   null,
        metadata:    { reason: 'placeholder profile row still exists after merge' },
      })

      return new Response(JSON.stringify({
        error: 'Post-merge verification failed: placeholder profile row still exists',
      }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Delete the placeholder from auth.users.
    const { error: deleteError } = await supabase.auth.admin.deleteUser(placeholder_id)
    if (deleteError) {
      // Non-fatal: log and continue — the data has been reassigned cleanly.
      console.error('[merge-profiles] Failed to delete placeholder auth user:', deleteError.message)
    }

    // Fetch the audit_log entry that merge_profiles created.
    const { data: auditEntry } = await supabase
      .from('audit_log')
      .select('*')
      .eq('action', 'profile.merged')
      .eq('entity_id', placeholder_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return new Response(JSON.stringify({
      success: true,
      merge: mergeResult,
      audit: auditEntry,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
