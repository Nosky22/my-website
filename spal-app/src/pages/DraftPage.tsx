import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import NationBadge from '../components/NationBadge'
import { EmptyState } from '../components/EmptyState'

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

const SLOT_PILL: Record<string, string> = {
  'Front Row':    'bg-orange-500/20 text-orange-300',
  'Back Row':     'bg-purple-500/20 text-purple-300',
  'Outside Back': 'bg-blue-500/20 text-blue-300',
  'Wales':        'bg-red-500/20 text-red-400',
  'Bench Sub':    'bg-white/10 text-spal-muted',
}

function SlotBadge({ slot }: { slot: string }) {
  return (
    <span className={`inline-block text-xs font-semibold px-1.5 py-0.5 rounded ${SLOT_PILL[slot] ?? 'bg-white/10 text-spal-muted'}`}>
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
        'id, pick_number, draft_slot, players!player_id(display_name, nation, canonical_position), profiles!profile_id(display_name)'
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
      ) : groups.length === 0 ? (
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12h6M9 16h4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
          title="No picks yet for this season"
          body="The draft hasn't taken place yet"
        />
      ) : (
        <>
          {(() => {
            const maxPicks = Math.max(...groups.map(g => g.picks.length))
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {groups.map(group => {
                  const placeholderCount = maxPicks - group.picks.length
                  return (
                    <div key={group.name} className="bg-spal-surface rounded p-4">
                      <h2 className="text-spal-text font-semibold mb-3">{group.name}</h2>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left border-b border-white/10">
                            <th className="pb-1.5 pr-2 text-xs text-spal-muted font-normal w-6">#</th>
                            <th className="pb-1.5 pr-2 text-xs text-spal-muted font-normal">Player</th>
                            <th className="pb-1.5 pr-2 text-xs text-spal-muted font-normal">Nat</th>
                            <th className="pb-1.5 text-xs text-spal-muted font-normal text-right">Slot</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.picks.map(pick => (
                            <tr key={pick.id} className="border-b border-white/5 last:border-0">
                              <td className="py-1.5 pr-2 text-spal-muted text-xs tabular-nums align-top pt-2">
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
                          {Array.from({ length: placeholderCount }, (_, i) => (
                            <tr key={`ph-${i}`} className="border-b border-white/5 last:border-0 opacity-35">
                              <td className="py-1.5 pr-2 text-spal-muted text-xs tabular-nums">—</td>
                              <td className="py-1.5 pr-2 text-spal-muted text-xs italic" colSpan={3}>
                                Not yet picked
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </>
      )}
    </div>
  )
}

const selectClass =
  'bg-spal-surface border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
