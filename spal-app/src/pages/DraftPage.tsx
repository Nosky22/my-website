import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import NationBadge from '../components/NationBadge'

interface Season { id: number; year: number }
interface Pick {
  id: number
  pick_number: number
  draft_slot: string
  players: { display_name: string; nation: string; canonical_position: string } | null
  profiles: { display_name: string } | null
}
interface ManagerGroup {
  name: string
  firstPick: number
  picks: Pick[]
}

const SLOT_ABBR: Record<string, string> = {
  'Front Row':    'FR',
  'Back Row':     'BR',
  'Outside Back': 'OB',
  'Wales':        'WAL',
  'Bench Sub':    'SUB',
}

const SLOT_CLASS: Record<string, string> = {
  'Front Row':    'text-orange-300',
  'Back Row':     'text-purple-300',
  'Outside Back': 'text-blue-300',
  'Bench Sub':    'text-spal-muted',
}

function SlotBadge({ slot }: { slot: string }) {
  if (slot === 'Wales') {
    return (
      <span
        className="inline-block text-xs font-bold text-white rounded px-1.5 py-0.5"
        style={{ backgroundColor: '#C8102E' }}
      >
        WAL
      </span>
    )
  }
  return (
    <span className={`text-xs font-semibold ${SLOT_CLASS[slot] ?? 'text-spal-muted'}`}>
      {SLOT_ABBR[slot] ?? slot}
    </span>
  )
}

export default function DraftPage() {
  const [seasons, setSeasons] = useState<Season[]>([])
  const [seasonId, setSeasonId] = useState<number | null>(null)
  const [groups, setGroups] = useState<ManagerGroup[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase
      .from('seasons')
      .select('id, year')
      .order('year', { ascending: false })
      .then(({ data }) => {
        const list = data ?? []
        setSeasons(list)
        if (list.length > 0) setSeasonId(list[0].id)
      })
  }, [])

  useEffect(() => {
    if (seasonId == null) return
    setLoading(true)
    supabase
      .from('draft_picks')
      .select(
        'id, pick_number, draft_slot, players!player_id(display_name, nation, canonical_position), profiles!manager_id(display_name)'
      )
      .eq('season_id', seasonId)
      .order('pick_number')
      .then(({ data }) => {
        const picks = (data ?? []) as unknown as Pick[]

        const byManager = new Map<string, Pick[]>()
        for (const pick of picks) {
          const name = pick.profiles?.display_name ?? 'Unknown'
          if (!byManager.has(name)) byManager.set(name, [])
          byManager.get(name)!.push(pick)
        }

        setGroups(
          Array.from(byManager.entries())
            .map(([name, picks]) => ({ name, firstPick: picks[0].pick_number, picks }))
            .sort((a, b) => a.firstPick - b.firstPick)
        )
        setLoading(false)
      })
  }, [seasonId])

  return (
    <div>
      <h1 className="text-2xl font-bold text-spal-yellow mb-6">Draft Board</h1>

      <div className="flex items-center gap-3 mb-8">
        <label className="text-sm text-spal-muted">Season</label>
        <select
          value={seasonId ?? ''}
          onChange={e => setSeasonId(Number(e.target.value))}
          className={selectClass}
        >
          {seasons.map(s => <option key={s.id} value={s.id}>{s.year}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-spal-muted text-sm">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {groups.map(group => (
            <div key={group.name} className="bg-spal-surface rounded p-4">
              <h2 className="text-spal-text font-semibold mb-3">{group.name}</h2>
              <table className="w-full text-sm">
                <tbody>
                  {group.picks.map(pick => (
                    <tr key={pick.id} className="border-b border-white/5 last:border-0">
                      <td className="py-1.5 pr-2 text-spal-muted text-xs tabular-nums w-5 align-top pt-2">
                        {pick.pick_number}
                      </td>
                      <td className="py-1.5 pr-2 text-spal-text leading-tight">
                        <div>{pick.players?.display_name ?? '—'}</div>
                        <div className="text-xs text-spal-muted">{pick.players?.canonical_position}</div>
                      </td>
                      <td className="py-1.5 pr-2 align-middle">
                        <NationBadge nation={pick.players?.nation ?? ''} />
                      </td>
                      <td className="py-1.5 text-right align-middle">
                        <SlotBadge slot={pick.draft_slot} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const selectClass =
  'bg-spal-surface border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
