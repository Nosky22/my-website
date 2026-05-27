import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface DraftPick {
  id: number
  pick_number: number
  profile_id: string
  player_id: number
  draft_slot: string
  players: { display_name: string; nation: string; canonical_position: string } | null
  profiles: { display_name: string } | null
}

const PICK_SELECT =
  'id, pick_number, profile_id, player_id, draft_slot, players!player_id(display_name, nation, canonical_position), profiles!profile_id(display_name)'

export function useDraftPicks(seasonId: number | null) {
  const [picks, setPicks] = useState<DraftPick[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (seasonId == null) return
    setLoading(true)

    supabase
      .from('draft_picks')
      .select(PICK_SELECT)
      .eq('season_id', seasonId)
      .order('pick_number')
      .then(({ data }) => {
        setPicks((data ?? []) as unknown as DraftPick[])
        setLoading(false)
      })

    const channel = supabase
      .channel(`draft-picks:${seasonId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'draft_picks', filter: `season_id=eq.${seasonId}` },
        (payload) => {
          supabase
            .from('draft_picks')
            .select(PICK_SELECT)
            .eq('id', payload.new.id)
            .single()
            .then(({ data }) => {
              if (data) setPicks(prev => [...prev, data as unknown as DraftPick])
            })
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'draft_picks', filter: `season_id=eq.${seasonId}` },
        (payload) => {
          supabase
            .from('draft_picks')
            .select(PICK_SELECT)
            .eq('id', payload.new.id)
            .single()
            .then(({ data }) => {
              if (data) setPicks(prev => prev.map(p => p.id === (data as unknown as DraftPick).id ? data as unknown as DraftPick : p))
            })
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'draft_picks', filter: `season_id=eq.${seasonId}` },
        (payload) => {
          setPicks(prev => prev.filter(p => p.id !== payload.old.id))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [seasonId])

  return { picks, loading }
}
