import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Season { id: number; year: number }
interface ManagerRow {
  managerId: string
  managerName: string
  pickCount: number
  firstPickNumber: number
}

export default function StandingsPage() {
  const [seasons, setSeasons] = useState<Season[]>([])
  const [seasonId, setSeasonId] = useState<number | null>(null)
  const [rows, setRows] = useState<ManagerRow[]>([])
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
      .select('manager_id, pick_number, profiles!profile_id(display_name)')
      .eq('season_id', seasonId)
      .then(({ data }) => {
        type RawPick = { manager_id: string; pick_number: number; profiles: { display_name: string } | null }
        const picks = (data ?? []) as unknown as RawPick[]

        const byManager = new Map<string, { name: string; count: number; firstPick: number }>()
        for (const pick of picks) {
          const name = pick.profiles?.display_name ?? 'Unknown'
          const existing = byManager.get(pick.manager_id)
          if (!existing) {
            byManager.set(pick.manager_id, { name, count: 1, firstPick: pick.pick_number })
          } else {
            existing.count++
            existing.firstPick = Math.min(existing.firstPick, pick.pick_number)
          }
        }

        setRows(
          Array.from(byManager.entries())
            .map(([id, { name, count, firstPick }]) => ({
              managerId: id,
              managerName: name,
              pickCount: count,
              firstPickNumber: firstPick,
            }))
            .sort((a, b) => a.firstPickNumber - b.firstPickNumber)
        )
        setLoading(false)
      })
  }, [seasonId])

  return (
    <div>
      <h1 className="text-2xl font-bold text-spal-yellow mb-6">Standings</h1>

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
        <>
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="text-left text-spal-muted border-b border-white/10">
                <th className="pb-2 pr-4 font-normal w-8">#</th>
                <th className="pb-2 pr-8 font-normal">Manager</th>
                <th className="pb-2 pr-8 font-normal tabular-nums">Players drafted</th>
                <th className="pb-2 font-normal text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.managerId} className="border-b border-white/5">
                  <td className="py-3 pr-4 text-spal-muted tabular-nums">{i + 1}</td>
                  <td className="py-3 pr-8 text-spal-text font-medium">{row.managerName}</td>
                  <td className="py-3 pr-8 text-spal-muted tabular-nums">{row.pickCount}</td>
                  <td className="py-3 text-right text-spal-muted text-xs italic">coming soon</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-spal-muted">
            Scores will be available once match data is imported. Managers are listed in draft order.
          </p>
        </>
      )}
    </div>
  )
}

const selectClass =
  'bg-spal-surface border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
