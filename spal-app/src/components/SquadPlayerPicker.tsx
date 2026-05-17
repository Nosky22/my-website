import { useMemo, useState } from 'react'
import NationBadge from './NationBadge'
import type { PlayerWithPrice } from '../pages/SquadPage'

interface Props {
  slotLabel: string
  eligiblePositions: string[]   // empty array = any position (supersub)
  availablePlayers: PlayerWithPrice[]
  alreadySelected: Set<number>  // player IDs elsewhere in the squad
  onSelect: (player: PlayerWithPrice) => void
  onClose: () => void
}

const NATIONS = ['England', 'Ireland', 'Scotland', 'Wales', 'France', 'Italy']

export default function SquadPlayerPicker({
  slotLabel, eligiblePositions, availablePlayers, alreadySelected, onSelect, onClose,
}: Props) {
  const [search, setSearch]           = useState('')
  const [nationFilter, setNationFilter] = useState('')

  const filtered = useMemo(() => {
    return availablePlayers.filter(p => {
      if (alreadySelected.has(p.id)) return false
      if (eligiblePositions.length > 0 && !eligiblePositions.includes(p.canonical_position)) return false
      if (nationFilter && p.nation !== nationFilter) return false
      if (search && !p.display_name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [availablePlayers, alreadySelected, eligiblePositions, nationFilter, search])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-spal-surface border border-white/10 rounded-lg w-full max-w-md mx-4 flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-spal-yellow">
            Select {slotLabel}
            {eligiblePositions.length > 0 && (
              <span className="ml-2 font-normal text-spal-muted">({eligiblePositions.join(' / ')})</span>
            )}
          </h3>
          <button onClick={onClose} className="text-xl leading-none text-spal-muted hover:text-spal-text">×</button>
        </div>

        {/* Filters */}
        <div className="flex gap-2 px-4 py-3 border-b border-white/5">
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
            className="flex-1 bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean placeholder:text-spal-muted"
          />
          <select
            value={nationFilter}
            onChange={e => setNationFilter(e.target.value)}
            className="bg-spal-bg border border-white/10 rounded px-2 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean"
          >
            <option value="">All nations</option>
            {NATIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        {/* Player list */}
        <div className="overflow-y-auto flex-1 divide-y divide-white/5">
          {filtered.length === 0 ? (
            <p className="text-spal-muted text-sm text-center py-8">No players match</p>
          ) : (
            filtered.map(player => (
              <button
                key={player.id}
                onClick={() => onSelect(player)}
                className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <NationBadge nation={player.nation} />
                  <span className="text-spal-text text-sm truncate">{player.display_name}</span>
                  <span className="text-xs text-spal-muted whitespace-nowrap">{player.canonical_position}</span>
                </div>
                <span className="text-xs text-spal-muted tabular-nums shrink-0">{player.effective_price}★</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
