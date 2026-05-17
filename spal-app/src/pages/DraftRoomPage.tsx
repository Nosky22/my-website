import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useDraftSession } from '../hooks/useDraftSession'
import { useDraftPicks } from '../hooks/useDraftPicks'
import DraftRoomAdminBar from '../components/DraftRoomAdminBar'
import NationBadge from '../components/NationBadge'

interface Season { id: number; year: number }
interface DraftOrderEntry {
  profile_id: string
  pick_position: number
  profiles: { display_name: string } | null
}

const SLOT_ABBR: Record<string, string> = {
  'Front Row':    'FR',
  'Back Row':     'BR',
  'Outside Back': 'OB',
  'Wales':        'WAL',
  'Bench Sub':    'SUB',
}
const SLOT_COLOUR: Record<string, string> = {
  'Front Row':    'text-orange-300',
  'Back Row':     'text-purple-300',
  'Outside Back': 'text-blue-300',
  'Wales':        'text-red-400',
  'Bench Sub':    'text-spal-muted',
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Linear draft: every round goes in the same order (pick_position 1 → N).
// pick_number = round * managerCount + col + 1
function getPickNumber(round: number, col: number, managerCount: number) {
  return round * managerCount + col + 1
}

export default function DraftRoomPage() {
  const { isAdmin } = useAuth()

  const [seasons, setSeasons]       = useState<Season[]>([])
  const [seasonId, setSeasonId]     = useState<number | null>(null)
  const [draftOrder, setDraftOrder] = useState<DraftOrderEntry[]>([])

  const { session, loading: sessionLoading, timeRemaining } = useDraftSession(seasonId)
  const { picks, loading: picksLoading } = useDraftPicks(seasonId)

  // Seasons
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

  // Draft order for the selected season
  useEffect(() => {
    if (seasonId == null) return
    supabase
      .from('draft_order')
      .select('profile_id, pick_position, profiles!profile_id(display_name)')
      .eq('season_id', seasonId)
      .order('pick_position')
      .then(({ data }) => setDraftOrder((data ?? []) as unknown as DraftOrderEntry[]))
  }, [seasonId])

  const managerCount = draftOrder.length
  const slotsPerManager = 4  // 2026: 4 slots
  const totalPicks = managerCount * slotsPerManager

  // Map pick_number → pick for fast lookup
  const pickMap = useMemo(() => {
    const m = new Map<number, typeof picks[0]>()
    for (const p of picks) m.set(p.pick_number, p)
    return m
  }, [picks])

  // Who is on the clock right now
  const onClockManager = useMemo(() => {
    if (!session || session.status === 'pending' || session.status === 'complete') return null
    const pickNum = session.current_pick_number
    // Linear: pick_position within the round = ((pickNum - 1) % managerCount) + 1
    const posInRound = ((pickNum - 1) % managerCount) + 1
    return draftOrder.find(o => o.pick_position === posInRound) ?? null
  }, [session, draftOrder, managerCount])

  const loading = sessionLoading || picksLoading

  // ── Status bar content ────────────────────────────────────────

  const statusLabel = () => {
    if (!session) return 'No draft session'
    if (session.status === 'pending')  return 'Waiting to start'
    if (session.status === 'complete') return 'Draft complete'
    if (session.status === 'paused')   return `Paused — Pick ${session.current_pick_number} of ${totalPicks}`
    return `Pick ${session.current_pick_number} of ${totalPicks}`
  }

  const timerColour = () => {
    if (timeRemaining == null) return ''
    if (timeRemaining <= 30)  return 'text-spal-error animate-pulse'
    if (timeRemaining <= 60)  return 'text-spal-warning'
    return 'text-spal-success'
  }

  // ── Rounds (rows) ─────────────────────────────────────────────

  const rounds = managerCount > 0
    ? Array.from({ length: slotsPerManager }, (_, r) => r)
    : []

  return (
    <div>
      <h1 className="text-2xl font-bold text-spal-yellow mb-6">Draft Room</h1>

      {/* Season selector */}
      <div className="flex items-center gap-3 mb-6">
        <label className="text-sm text-spal-muted">Season</label>
        <select
          value={seasonId ?? ''}
          onChange={e => setSeasonId(Number(e.target.value))}
          className={selectClass}
        >
          {seasons.map(s => <option key={s.id} value={s.id}>{s.year}</option>)}
        </select>
      </div>

      {/* Admin bar */}
      {isAdmin && session && (
        <DraftRoomAdminBar
          session={session}
          totalPicks={totalPicks}
          timeRemaining={timeRemaining}
        />
      )}

      {loading ? (
        <p className="text-spal-muted text-sm">Loading…</p>
      ) : !session ? (
        <p className="text-spal-muted text-sm">No draft session found for this season.</p>
      ) : managerCount === 0 ? (
        <p className="text-spal-muted text-sm">Draft order not set for this season.</p>
      ) : (
        <>
          {/* Status bar */}
          <div className="flex flex-wrap items-center gap-6 mb-6 p-4 bg-spal-surface rounded">
            <div>
              <p className="text-xs text-spal-muted mb-0.5 uppercase tracking-wider">Status</p>
              <p className="text-spal-text font-semibold">{statusLabel()}</p>
            </div>

            {onClockManager && (
              <div>
                <p className="text-xs text-spal-muted mb-0.5 uppercase tracking-wider">On the clock</p>
                <p className="text-spal-cerulean font-semibold">
                  {onClockManager.profiles?.display_name ?? '—'}
                </p>
              </div>
            )}

            {timeRemaining != null && (
              <div>
                <p className="text-xs text-spal-muted mb-0.5 uppercase tracking-wider">Time remaining</p>
                <p className={`text-2xl font-mono font-bold tabular-nums ${timerColour()}`}>
                  {formatTime(timeRemaining)}
                </p>
              </div>
            )}

            {session.status === 'complete' && (
              <p className="text-spal-success font-semibold">Draft complete</p>
            )}
          </div>

          {/* Draft grid */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[700px]">
              <thead>
                <tr>
                  <th className="pb-3 pr-4 text-left text-xs font-normal text-spal-muted w-16">Round</th>
                  {draftOrder.map(entry => (
                    <th
                      key={entry.profile_id}
                      className={`pb-3 px-2 text-center text-xs font-semibold ${
                        onClockManager?.profile_id === entry.profile_id
                          ? 'text-spal-cerulean'
                          : 'text-spal-muted'
                      }`}
                    >
                      {entry.profiles?.display_name ?? '—'}
                      <span className="ml-1 font-normal opacity-50">#{entry.pick_position}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rounds.map(round => (
                  <tr key={round} className="border-t border-white/5">
                    <td className="py-2 pr-4 text-xs text-spal-muted align-top pt-3">
                      R{round + 1}
                    </td>
                    {draftOrder.map((entry, col) => {
                      const pickNum = getPickNumber(round, col, managerCount)
                      const pick    = pickMap.get(pickNum)
                      const isCurrent = session.status !== 'complete'
                        && session.status !== 'pending'
                        && pickNum === session.current_pick_number

                      return (
                        <td key={entry.profile_id} className="px-2 py-1.5 align-top">
                          <div
                            className={`rounded p-2 min-h-[72px] transition-all ${
                              isCurrent
                                ? 'bg-spal-cerulean/10 ring-1 ring-spal-cerulean ring-inset animate-pulse'
                                : pick
                                  ? 'bg-spal-surface'
                                  : 'bg-white/[0.02]'
                            }`}
                          >
                            {pick ? (
                              <>
                                <p className="text-spal-text text-xs font-medium leading-snug mb-1">
                                  {pick.players?.display_name ?? '—'}
                                </p>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <NationBadge nation={pick.players?.nation ?? ''} />
                                  <span className={`text-xs font-semibold ${SLOT_COLOUR[pick.draft_slot] ?? 'text-spal-muted'}`}>
                                    {SLOT_ABBR[pick.draft_slot] ?? pick.draft_slot}
                                  </span>
                                </div>
                              </>
                            ) : isCurrent ? (
                              <p className="text-spal-cerulean text-xs font-semibold">
                                On the clock
                                <span className="block text-spal-muted font-normal mt-0.5">Pick {pickNum}</span>
                              </p>
                            ) : (
                              <span className="text-xs text-spal-muted opacity-30">#{pickNum}</span>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

const selectClass =
  'bg-spal-surface border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
