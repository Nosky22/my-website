import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import NationBadge from './NationBadge'
import type { DraftPick } from '../hooks/useDraftPicks'

interface Player {
  id: number
  display_name: string
  nation: string
  canonical_position: string
  position_group: string
}

interface PickPanelProps {
  seasonId: number
  onClockProfileId: string
  allPicks: DraftPick[]
  onClose: () => void
}

const ALL_SLOTS = ['Front Row', 'Back Row', 'Outside Back', 'Wales']

const SLOT_COLOUR: Record<string, string> = {
  'Front Row':    'text-orange-300',
  'Back Row':     'text-purple-300',
  'Outside Back': 'text-blue-300',
  'Wales':        'text-red-400',
}

const NATIONS = ['England', 'Ireland', 'Scotland', 'Wales', 'France', 'Italy']

function isEligibleForSlot(player: Player, slot: string): boolean {
  switch (slot) {
    case 'Front Row':    return player.position_group === 'Front Row'
    case 'Back Row':     return player.position_group === 'Back Row'
    case 'Outside Back': return player.position_group === 'Outside Back'
    case 'Wales':        return player.nation === 'Wales'
    default:             return false
  }
}

export default function PickPanel({ seasonId, onClockProfileId, allPicks, onClose }: PickPanelProps) {
  const { user, session: authSession } = useAuth()
  const [players, setPlayers]     = useState<Player[]>([])
  const [loading, setLoading]     = useState(true)
  const [selectedSlot, setSelectedSlot] = useState<string>('')
  const [nationFilter, setNationFilter] = useState('')
  const [search, setSearch]       = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const isOnClock = user?.id === onClockProfileId

  useEffect(() => {
    setLoading(true)
    supabase
      .from('players')
      .select('id, display_name, nation, canonical_position, position_group')
      .eq('season_id', seasonId)
      .order('display_name')
      .then(({ data }) => {
        setPlayers(data ?? [])
        setLoading(false)
      })
  }, [seasonId])

  // Slots this manager has already filled
  const filledSlots = new Set(
    allPicks
      .filter(p => p.profile_id === onClockProfileId)
      .map(p => p.draft_slot)
  )

  // Player IDs already drafted (by anyone)
  const takenPlayerIds = new Set(allPicks.map(p => p.player_id))

  // Open slots for the on-clock manager
  const openSlots = ALL_SLOTS.filter(s => !filledSlots.has(s))

  // Filtered player list
  const visiblePlayers = players.filter(p => {
    if (takenPlayerIds.has(p.id)) return false
    if (selectedSlot && !isEligibleForSlot(p, selectedSlot)) return false
    if (nationFilter && p.nation !== nationFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!p.display_name.toLowerCase().includes(q)) return false
    }
    return true
  })

  async function submitPick(playerId: number) {
    if (!selectedSlot) return
    setSubmitting(true)
    setError(null)

    const token = authSession?.access_token
    if (!token) {
      setError('Not authenticated')
      setSubmitting(false)
      return
    }

    const { data, error: fnErr } = await supabase.functions.invoke('draft-pick', {
      body: { season_id: seasonId, player_id: playerId, draft_slot: selectedSlot },
      headers: { Authorization: `Bearer ${token}` },
    })

    if (fnErr || data?.error) {
      const msg = data?.error ?? fnErr?.message ?? 'Unknown error'
      setError(msg)
    } else {
      onClose()
    }

    setSubmitting(false)
  }

  if (loading) return <p className="text-spal-muted text-sm mt-6">Loading players…</p>

  return (
    <div className="mt-6 p-4 bg-spal-surface rounded border border-white/10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-spal-yellow uppercase tracking-wider">
          {isOnClock ? 'Your pick' : 'Make a pick (admin)'}
        </h2>
        <button
          onClick={onClose}
          className="text-xs text-spal-muted hover:text-spal-text transition-colors"
        >
          Cancel
        </button>
      </div>

      {error && (
        <p className="text-spal-error text-sm mb-3">{error}</p>
      )}

      {/* Slot selector */}
      <div className="mb-4">
        <p className="text-xs text-spal-muted mb-2">Select slot</p>
        <div className="flex flex-wrap gap-2">
          {ALL_SLOTS.map(slot => {
            const filled  = filledSlots.has(slot)
            const active  = selectedSlot === slot
            return (
              <button
                key={slot}
                disabled={filled || submitting}
                onClick={() => setSelectedSlot(active ? '' : slot)}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors border ${
                  filled
                    ? 'border-white/5 text-spal-muted opacity-40 cursor-not-allowed'
                    : active
                      ? `border-spal-cerulean bg-spal-cerulean/10 ${SLOT_COLOUR[slot]}`
                      : `border-white/10 ${SLOT_COLOUR[slot]} hover:border-white/30`
                }`}
              >
                {slot}{filled ? ' ✓' : ''}
              </button>
            )
          })}
        </div>
        {openSlots.length === 0 && (
          <p className="text-spal-muted text-xs mt-2">All slots filled for this manager.</p>
        )}
      </div>

      {selectedSlot && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-3">
            <input
              type="text"
              placeholder="Search player…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={inputClass}
            />
            <select
              value={nationFilter}
              onChange={e => setNationFilter(e.target.value)}
              className={selectClass}
            >
              <option value="">All nations</option>
              {NATIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* Player list */}
          <div className="max-h-72 overflow-y-auto space-y-1">
            {visiblePlayers.length === 0 ? (
              <p className="text-spal-muted text-xs py-2">No eligible players match the filters.</p>
            ) : (
              visiblePlayers.map(player => (
                <div
                  key={player.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <NationBadge nation={player.nation} />
                    <span className="text-spal-text text-sm truncate">{player.display_name}</span>
                    <span className="text-spal-muted text-xs whitespace-nowrap">{player.canonical_position}</span>
                  </div>
                  <button
                    onClick={() => submitPick(player.id)}
                    disabled={submitting}
                    className="shrink-0 px-3 py-1 rounded text-xs font-semibold bg-spal-cerulean/20 text-spal-cerulean border border-spal-cerulean/30 hover:bg-spal-cerulean/30 transition-colors disabled:opacity-50"
                  >
                    Pick
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

const inputClass =
  'bg-spal-surface border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean placeholder:text-spal-muted w-48'

const selectClass =
  'bg-spal-surface border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
