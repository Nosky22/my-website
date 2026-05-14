import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import NationBadge from '../components/NationBadge'

interface Season { id: number; year: number }
interface Player {
  id: number
  display_name: string
  nation: string
  canonical_position: string
  position_group: string
}

const NATIONS = ['England', 'Ireland', 'Scotland', 'Wales', 'France', 'Italy']
const POSITION_GROUPS = ['Front Row', 'Back Row', 'Outside Back', 'Other']

export default function PlayersPage() {
  const [seasons, setSeasons] = useState<Season[]>([])
  const [seasonId, setSeasonId] = useState<number | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [draftedBy, setDraftedBy] = useState<Map<number, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [nationFilter, setNationFilter] = useState('')
  const [posFilter, setPosFilter] = useState('')

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
    Promise.all([
      supabase
        .from('players')
        .select('id, display_name, nation, canonical_position, position_group')
        .eq('season_id', seasonId)
        .order('display_name'),
      supabase
        .from('draft_picks')
        .select('player_id, profiles!manager_id(display_name)')
        .eq('season_id', seasonId),
    ]).then(([playersRes, picksRes]) => {
      setPlayers(playersRes.data ?? [])

      const map = new Map<number, string>()
      for (const pick of (picksRes.data ?? []) as unknown as Array<{ player_id: number; profiles: { display_name: string } | null }>) {
        if (pick.profiles?.display_name) map.set(pick.player_id, pick.profiles.display_name)
      }
      setDraftedBy(map)
      setLoading(false)
    })
  }, [seasonId])

  const visible = players.filter(p =>
    (!nationFilter || p.nation === nationFilter) &&
    (!posFilter || p.position_group === posFilter)
  )

  return (
    <div>
      <h1 className="text-2xl font-bold text-spal-yellow mb-6">Players</h1>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <label className="text-sm text-spal-muted">Season</label>
        <select
          value={seasonId ?? ''}
          onChange={e => setSeasonId(Number(e.target.value))}
          className={selectClass}
        >
          {seasons.map(s => <option key={s.id} value={s.id}>{s.year}</option>)}
        </select>

        <span className="text-white/20">|</span>

        <select
          value={nationFilter}
          onChange={e => setNationFilter(e.target.value)}
          className={selectClass}
        >
          <option value="">All nations</option>
          {NATIONS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>

        <select
          value={posFilter}
          onChange={e => setPosFilter(e.target.value)}
          className={selectClass}
        >
          <option value="">All positions</option>
          {POSITION_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>

        {(nationFilter || posFilter) && (
          <button
            onClick={() => { setNationFilter(''); setPosFilter('') }}
            className="text-xs text-spal-muted hover:text-spal-text transition-colors underline"
          >
            Clear
          </button>
        )}

        <span className="text-xs text-spal-muted ml-auto">{visible.length} players</span>
      </div>

      {loading ? (
        <p className="text-spal-muted text-sm">Loading…</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-spal-muted border-b border-white/10">
              <th className="pb-2 pr-4 font-normal">Player</th>
              <th className="pb-2 pr-4 font-normal">Nation</th>
              <th className="pb-2 pr-4 font-normal">Position</th>
              <th className="pb-2 font-normal">Draft status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(p => {
              const manager = draftedBy.get(p.id)
              return (
                <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-2 pr-4 text-spal-text font-medium">{p.display_name}</td>
                  <td className="py-2 pr-4"><NationBadge nation={p.nation} /></td>
                  <td className="py-2 pr-4 text-spal-muted">{p.canonical_position}</td>
                  <td className="py-2">
                    {manager
                      ? <span className="text-spal-cerulean">{manager}</span>
                      : <span className="text-spal-muted text-xs">Available</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

const selectClass =
  'bg-spal-surface border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
