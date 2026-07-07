import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/Toast'
import { ConfirmModal } from '../../components/ConfirmModal'
import { EmptyState } from '../../components/EmptyState'
import { POSITION_GROUP, CANONICAL_POSITIONS as POSITIONS, NATIONS, toSearchName } from '../../lib/positions'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorCard from '../../components/ErrorCard'

interface Season { id: number; year: number }

interface PoolPlayer {
  id: number
  display_name: string
  nation: string
  canonical_position: string
  position_group: string
  canonical_player_id: number | null
  base_price: number | null
}

interface CanonicalPlayer {
  id: number
  display_name: string
  search_name: string
  nation: string
  canonical_position: string
}

// CSV import types
interface CsvRow {
  name: string
  nation: string
  position: string
  price: number
}

type MatchStatus = 'exact' | 'ambiguous' | 'new' | 'in_pool'
type ResolveType = 'canonical' | 'new' | 'skip'

interface ReviewRow {
  csvName: string
  csvNation: string
  csvPosition: string
  csvPrice: number
  status: MatchStatus
  canonical?: CanonicalPlayer
  candidates?: CanonicalPlayer[]
  resolveType: ResolveType
  resolveCanonicalId: number | null
  resolveEditName: string
  resolveEditNation: string
  resolveEditPosition: string
}

function parseCSV(text: string): CsvRow[] {
  const lines = text.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase())
  const nameIdx     = header.findIndex(h => h === 'name' || h === 'display_name')
  const nationIdx   = header.indexOf('nation')
  const positionIdx = header.findIndex(h => h === 'position' || h === 'pos' || h === 'canonical_position')
  const priceIdx    = header.indexOf('price')
  if (nameIdx === -1 || nationIdx === -1) return []

  return lines.slice(1).flatMap(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    const name   = cols[nameIdx]   ?? ''
    const nation = cols[nationIdx] ?? ''
    if (!name || !nation) return []
    const position = positionIdx !== -1 ? (cols[positionIdx] ?? 'Prop') : 'Prop'
    const rawPrice = priceIdx !== -1 ? parseFloat(cols[priceIdx] ?? '') : NaN
    return [{ name, nation, position, price: isNaN(rawPrice) ? 10 : rawPrice }]
  })
}

function buildReviewRows(
  csvRows: CsvRow[],
  canonicals: CanonicalPlayer[],
  inPoolCanonicalIds: Set<number>,
): ReviewRow[] {
  return csvRows.map(row => {
    const sn    = toSearchName(row.name)
    const exact = canonicals.find(c => c.search_name === sn && c.nation === row.nation)

    if (exact) {
      const alreadyIn = inPoolCanonicalIds.has(exact.id)
      return {
        csvName: row.name, csvNation: row.nation, csvPosition: row.position, csvPrice: row.price,
        status:             alreadyIn ? 'in_pool' : 'exact',
        canonical:          exact,
        candidates:         undefined,
        resolveType:        alreadyIn ? 'skip' : 'canonical',
        resolveCanonicalId: exact.id,
        resolveEditName:    row.name,
        resolveEditNation:  row.nation,
        resolveEditPosition: row.position,
      }
    }

    const candidates = canonicals.filter(c => c.search_name === sn)
    if (candidates.length > 0) {
      return {
        csvName: row.name, csvNation: row.nation, csvPosition: row.position, csvPrice: row.price,
        status:             'ambiguous',
        canonical:          undefined,
        candidates,
        resolveType:        'canonical',
        resolveCanonicalId: candidates[0].id,
        resolveEditName:    row.name,
        resolveEditNation:  row.nation,
        resolveEditPosition: row.position,
      }
    }

    return {
      csvName: row.name, csvNation: row.nation, csvPosition: row.position, csvPrice: row.price,
      status:             'new',
      canonical:          undefined,
      candidates:         undefined,
      resolveType:        'new',
      resolveCanonicalId: null,
      resolveEditName:    row.name,
      resolveEditNation:  row.nation,
      resolveEditPosition: row.position,
    }
  })
}

export default function AdminPoolPage() {
  useEffect(() => { document.title = 'Player Pool — Admin — SPAL' }, [])
  const { addToast }   = useToast()
  const fileInputRef   = useRef<HTMLInputElement>(null)

  const [seasons, setSeasons]                   = useState<Season[]>([])
  const [selectedSeasonId, setSelectedSeasonId] = useState<number | null>(null)
  const [poolPlayers, setPoolPlayers]           = useState<PoolPlayer[]>([])
  const [protectedIds, setProtectedIds]         = useState<Set<number>>(new Set())
  const [loading, setLoading]                   = useState(false)
  const [poolError, setPoolError]               = useState(false)
  const [canonicals, setCanonicals]             = useState<CanonicalPlayer[]>([])

  // Add-from-canonical sidebar
  const [canonSearch, setCanonSearch] = useState('')
  const [addingId, setAddingId]       = useState<number | null>(null)

  // Pool table search
  const [searchQuery, setSearchQuery] = useState('')

  // Remove player
  const [pendingRemoveId, setPendingRemoveId] = useState<number | null>(null)
  const [removing, setRemoving]               = useState(false)

  // CSV import
  const [csvStep, setCsvStep]       = useState<'idle' | 'review' | 'done'>('idle')
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([])
  const [importing, setImporting]   = useState(false)
  const [csvError, setCsvError]     = useState<string | null>(null)

  // ── Load seasons ────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase
      .from('seasons')
      .select('id, year')
      .order('year', { ascending: false })
      .then(({ data }) => {
        const list = data ?? []
        setSeasons(list)
        if (list.length > 0) setSelectedSeasonId(list[0].id)
      })
  }, [])

  // ── Load canonical players (once) ───────────────────────────────────────────
  useEffect(() => {
    supabase
      .from('canonical_players')
      .select('id, display_name, search_name, nation, canonical_position')
      .order('display_name')
      .then(({ data }) => setCanonicals(data ?? []))
  }, [])

  // ── Load pool for selected season ───────────────────────────────────────────
  async function loadPool(seasonId: number) {
    setLoading(true)
    setPoolError(false)

    const [{ data: playerData, error: playerError }, { data: priceData }] = await Promise.all([
      supabase
        .from('players')
        .select('id, display_name, nation, canonical_position, position_group, canonical_player_id')
        .eq('season_id', seasonId)
        .order('display_name'),
      supabase
        .from('player_prices')
        .select('player_id, final_price')
        .eq('season_id', seasonId)
        .is('round_number', null),
    ])

    if (playerError) { setPoolError(true); setLoading(false); return }

    const priceMap = new Map<number, number>()
    for (const p of priceData ?? []) priceMap.set(p.player_id, p.final_price)

    setPoolPlayers(
      (playerData ?? []).map(p => ({ ...p, base_price: priceMap.get(p.id) ?? null }))
    )

    // Protected IDs from draft_picks (has season_id directly)
    const { data: draftData }  = await supabase
      .from('draft_picks')
      .select('player_id')
      .eq('season_id', seasonId)

    const ids = new Set<number>((draftData ?? []).map(r => r.player_id as number))

    // Protected IDs via manager_round_squads → manager_round_squad_players
    const { data: squadData } = await supabase
      .from('manager_round_squads')
      .select('id')
      .eq('season_id', seasonId)

    const squadIds = (squadData ?? []).map(s => s.id as string)

    if (squadIds.length > 0) {
      const { data: squadPlayerData } = await supabase
        .from('manager_round_squad_players')
        .select('player_id')
        .in('squad_id', squadIds)

      for (const r of squadPlayerData ?? []) ids.add(r.player_id as number)
    }

    setProtectedIds(ids)
    setLoading(false)
  }

  useEffect(() => {
    if (selectedSeasonId != null) loadPool(selectedSeasonId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeasonId])

  // ── Canonical search (add-from-canonical sidebar) ───────────────────────────
  const inPoolCanonicalIds = useMemo(
    () => new Set(poolPlayers.map(p => p.canonical_player_id).filter((id): id is number => id != null)),
    [poolPlayers]
  )

  const canonSearchResults = useMemo(() => {
    const q = canonSearch.trim().toLowerCase()
    if (!q) return []
    return canonicals
      .filter(c => !inPoolCanonicalIds.has(c.id) && (
        c.display_name.toLowerCase().includes(q) || c.nation.toLowerCase().includes(q)
      ))
      .slice(0, 10)
  }, [canonicals, canonSearch, inPoolCanonicalIds])

  async function handleAddFromCanonical(c: CanonicalPlayer) {
    if (selectedSeasonId == null) return
    setAddingId(c.id)

    const { data: newPlayer, error } = await supabase
      .from('players')
      .insert({
        season_id:           selectedSeasonId,
        canonical_player_id: c.id,
        display_name:        c.display_name,
        search_name:         toSearchName(c.display_name),
        nation:              c.nation,
        canonical_position:  c.canonical_position,
        position_group:      POSITION_GROUP[c.canonical_position] ?? 'Other',
      })
      .select('id')
      .single()

    if (error) { addToast(error.message, 'error'); setAddingId(null); return }

    await supabase.from('player_prices').upsert(
      { player_id: newPlayer.id, season_id: selectedSeasonId, round_number: null, source_price: 10 },
      { onConflict: 'player_id,season_id,round_number' }
    )

    setAddingId(null)
    setCanonSearch('')
    addToast(`${c.display_name} added`, 'success')
    loadPool(selectedSeasonId)
  }

  // ── Remove player ────────────────────────────────────────────────────────────
  async function handleRemove() {
    if (pendingRemoveId == null || selectedSeasonId == null) return
    setRemoving(true)

    const { error: priceError } = await supabase
      .from('player_prices')
      .delete()
      .eq('player_id', pendingRemoveId)

    if (priceError) {
      setRemoving(false)
      setPendingRemoveId(null)
      addToast(priceError.message, 'error')
      return
    }

    const { error: playerError } = await supabase.from('players').delete().eq('id', pendingRemoveId)

    setRemoving(false)
    setPendingRemoveId(null)

    if (playerError) { addToast(playerError.message, 'error'); return }
    addToast('Player removed from pool', 'success')
    loadPool(selectedSeasonId)
  }

  // ── CSV import ───────────────────────────────────────────────────────────────
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvError(null)

    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const csvRows = parseCSV(text)

      if (csvRows.length === 0) {
        setCsvError('No valid rows found. Expected columns: name, nation (and optionally position, price).')
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }

      const rows = buildReviewRows(csvRows, canonicals, inPoolCanonicalIds)
      setReviewRows(rows)
      setCsvStep('review')
    }
    reader.readAsText(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function updateReviewRow(idx: number, patch: Partial<ReviewRow>) {
    setReviewRows(rows => rows.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  async function handleImportConfirm() {
    if (selectedSeasonId == null) return
    setImporting(true)

    const toImport = reviewRows.filter(r => r.resolveType !== 'skip')
    let inserted = 0
    let skipped = 0

    for (const row of toImport) {
      let canonicalId = row.resolveCanonicalId

      // Create new canonical player if needed
      if (row.resolveType === 'new') {
        const display_name = row.resolveEditName.trim()
        const { data: newCanon, error: canonError } = await supabase
          .from('canonical_players')
          .insert({
            display_name,
            search_name:        toSearchName(display_name),
            nation:             row.resolveEditNation,
            canonical_position: row.resolveEditPosition,
            position_group:     POSITION_GROUP[row.resolveEditPosition] ?? 'Other',
          })
          .select('id')
          .single()

        if (canonError) {
          addToast(`Failed to create "${display_name}": ${canonError.message}`, 'error')
          skipped++
          continue
        }
        canonicalId = newCanon.id
      }

      // Create player in season pool
      const display_name   = row.resolveType === 'new' ? row.resolveEditName.trim()   : (row.canonical?.display_name ?? row.csvName)
      const nation         = row.resolveType === 'new' ? row.resolveEditNation        : (row.canonical?.nation       ?? row.csvNation)
      const canon_position = row.resolveType === 'new' ? row.resolveEditPosition      : (row.canonical?.canonical_position ?? row.csvPosition)

      const { data: newPlayer, error: playerError } = await supabase
        .from('players')
        .insert({
          season_id:           selectedSeasonId,
          canonical_player_id: canonicalId,
          display_name,
          search_name:         toSearchName(display_name),
          nation,
          canonical_position:  canon_position,
          position_group:      POSITION_GROUP[canon_position] ?? 'Other',
        })
        .select('id')
        .single()

      if (playerError) {
        addToast(`Failed to add "${display_name}": ${playerError.message}`, 'error')
        skipped++
        continue
      }

      await supabase.from('player_prices').upsert(
        { player_id: newPlayer.id, season_id: selectedSeasonId, round_number: null, source_price: row.csvPrice },
        { onConflict: 'player_id,season_id,round_number' }
      )

      inserted++
    }

    setImporting(false)
    setCsvStep('done')
    addToast(`${inserted} players imported${skipped > 0 ? `, ${skipped} skipped` : ''}`, inserted > 0 ? 'success' : 'error')

    // Refresh canonical list in case new ones were created
    const { data: updatedCanonicals } = await supabase
      .from('canonical_players')
      .select('id, display_name, search_name, nation, canonical_position')
      .order('display_name')
    if (updatedCanonicals) setCanonicals(updatedCanonicals)

    loadPool(selectedSeasonId)
  }

  // ── Derived state ────────────────────────────────────────────────────────────
  const visiblePool = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return poolPlayers
    return poolPlayers.filter(p =>
      p.display_name.toLowerCase().includes(q) || p.nation.toLowerCase().includes(q)
    )
  }, [poolPlayers, searchQuery])

  const pendingRemoveName = poolPlayers.find(p => p.id === pendingRemoveId)?.display_name

  const csvImportSummary = useMemo(() => {
    const exact    = reviewRows.filter(r => r.status === 'exact').length
    const ambig    = reviewRows.filter(r => r.status === 'ambiguous').length
    const newRows  = reviewRows.filter(r => r.status === 'new').length
    const inPool   = reviewRows.filter(r => r.status === 'in_pool').length
    const skipped  = reviewRows.filter(r => r.resolveType === 'skip').length
    return { exact, ambig, newRows, inPool, skipped }
  }, [reviewRows])

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-spal-yellow">Player Pool</h1>
        {csvStep === 'idle' && (
          <div className="flex items-center gap-3">
            <a
              href="data:text/csv;charset=utf-8,display_name,nation,canonical_position,price%0AAntoine%20Dupont,France,Scrum-half,12"
              download="pool-template.csv"
              className="text-xs text-spal-muted hover:text-spal-text transition-colors"
            >
              Download CSV template
            </a>
            <label className="cursor-pointer">
              <span className="text-xs text-spal-cerulean border border-spal-cerulean/40 rounded px-3 py-1.5 hover:bg-spal-cerulean/10 transition-colors">
                Import CSV
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={handleFileChange}
              />
            </label>
          </div>
        )}
        {csvStep === 'review' && (
          <button
            onClick={() => setCsvStep('idle')}
            className="text-xs text-spal-muted hover:text-spal-text transition-colors"
          >
            ← Back to pool
          </button>
        )}
        {csvStep === 'done' && (
          <button
            onClick={() => setCsvStep('idle')}
            className="text-xs text-spal-cerulean hover:text-spal-cerulean-light transition-colors"
          >
            ← Back to pool
          </button>
        )}
      </div>

      {csvError && (
        <p className="text-red-400 text-sm mb-4 bg-red-500/10 border border-red-500/20 rounded px-4 py-2">{csvError}</p>
      )}

      {/* Season selector */}
      <div className="mb-6 flex items-center gap-3">
        <label htmlFor="pool-season" className="text-sm text-spal-muted">Season</label>
        <select
          id="pool-season"
          value={selectedSeasonId ?? ''}
          onChange={e => { setSelectedSeasonId(Number(e.target.value)); setCsvStep('idle') }}
          className="bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean"
        >
          {seasons.map(s => <option key={s.id} value={s.id}>{s.year}</option>)}
        </select>
      </div>

      {/* ── CSV review view ── */}
      {csvStep === 'review' && (
        <CsvReviewPanel
          rows={reviewRows}
          summary={csvImportSummary}
          importing={importing}
          onUpdateRow={updateReviewRow}
          onConfirm={handleImportConfirm}
          onCancel={() => setCsvStep('idle')}
        />
      )}

      {/* ── Pool view ── */}
      {csvStep !== 'review' && (
        <div className="flex gap-8 items-start">
          {/* Add from canonical sidebar */}
          <section className="bg-spal-surface rounded p-5 w-64 shrink-0">
            <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-3">Add from canonical</h2>
            <input
              type="text"
              value={canonSearch}
              onChange={e => setCanonSearch(e.target.value)}
              placeholder="Search by name…"
              className="w-full bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean"
            />
            {canonSearch.trim() ? (
              <div className="mt-2 space-y-0.5">
                {canonSearchResults.length === 0 ? (
                  <p className="text-xs text-spal-muted py-2">No matches outside pool</p>
                ) : (
                  canonSearchResults.map(c => (
                    <div key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                      <div className="min-w-0">
                        <p className="text-spal-text text-xs font-medium truncate">{c.display_name}</p>
                        <p className="text-spal-muted text-xs">{c.nation} · {c.canonical_position}</p>
                      </div>
                      <button
                        onClick={() => handleAddFromCanonical(c)}
                        disabled={addingId === c.id}
                        className="text-xs text-spal-cerulean hover:text-spal-cerulean-light transition-colors shrink-0 disabled:opacity-50"
                      >
                        {addingId === c.id ? '…' : 'Add'}
                      </button>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <p className="text-xs text-spal-muted mt-2">Type a name to search</p>
            )}
          </section>

          {/* Pool table */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-4">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search pool…"
                className="bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean w-48"
              />
              <span className="text-xs text-spal-muted ml-auto">{poolPlayers.length} players</span>
            </div>

            {loading ? (
              <LoadingSpinner />
            ) : poolError ? (
              <ErrorCard onRetry={() => { if (selectedSeasonId != null) loadPool(selectedSeasonId) }} />
            ) : poolPlayers.length === 0 ? (
              <EmptyState
                icon={
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                }
                title="No players in pool"
                body="Add players from the canonical list or import a CSV."
              />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-spal-muted border-b border-white/10">
                    <th className="pb-2 pr-4 font-normal">Name</th>
                    <th className="pb-2 pr-4 font-normal">Nation</th>
                    <th className="pb-2 pr-4 font-normal">Position</th>
                    <th className="pb-2 pr-4 font-normal">Price</th>
                    <th className="pb-2 font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePool.map(p => {
                    const isProtected = protectedIds.has(p.id)
                    return (
                      <tr key={p.id} className="border-b border-white/5">
                        <td className="py-2 pr-4 text-spal-text">{p.display_name}</td>
                        <td className="py-2 pr-4 text-spal-muted">{p.nation}</td>
                        <td className="py-2 pr-4 text-spal-muted">{p.canonical_position}</td>
                        <td className="py-2 pr-4 text-spal-muted tabular-nums">
                          {p.base_price != null ? p.base_price : '—'}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => setPendingRemoveId(p.id)}
                            disabled={isProtected}
                            title={isProtected ? 'Player has draft picks or squad selections' : 'Remove from pool'}
                            className="text-xs text-spal-muted hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={pendingRemoveId != null}
        title="Remove player from pool"
        message={`Remove "${pendingRemoveName}" from this season's pool? This cannot be undone.`}
        confirmLabel={removing ? 'Removing…' : 'Remove'}
        danger
        onConfirm={handleRemove}
        onCancel={() => setPendingRemoveId(null)}
      />
    </div>
  )
}

// ── CSV Review Panel ───────────────────────────────────────────────────────────

interface CsvReviewPanelProps {
  rows: ReviewRow[]
  summary: { exact: number; ambig: number; newRows: number; inPool: number; skipped: number }
  importing: boolean
  onUpdateRow: (idx: number, patch: Partial<ReviewRow>) => void
  onConfirm: () => void
  onCancel: () => void
}

function CsvReviewPanel({ rows, summary, importing, onUpdateRow, onConfirm, onCancel }: CsvReviewPanelProps) {
  const statusLabel: Record<MatchStatus, string> = {
    exact:    'Matched',
    ambiguous: 'Ambiguous',
    new:      'New',
    in_pool:  'Already in pool',
  }
  const statusColor: Record<MatchStatus, string> = {
    exact:    'text-emerald-400',
    ambiguous: 'text-amber-400',
    new:      'text-spal-cerulean',
    in_pool:  'text-spal-muted',
  }

  const toImport = rows.filter(r => r.resolveType !== 'skip').length

  return (
    <div>
      <div className="mb-4 flex items-center gap-4 text-xs text-spal-muted">
        {summary.exact > 0    && <span><span className="text-emerald-400 font-medium">{summary.exact}</span> matched</span>}
        {summary.ambig > 0    && <span><span className="text-amber-400 font-medium">{summary.ambig}</span> ambiguous</span>}
        {summary.newRows > 0  && <span><span className="text-spal-cerulean font-medium">{summary.newRows}</span> new</span>}
        {summary.inPool > 0   && <span><span className="font-medium">{summary.inPool}</span> already in pool</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="text-left text-spal-muted border-b border-white/10">
              <th className="pb-2 pr-4 font-normal">CSV name</th>
              <th className="pb-2 pr-4 font-normal">Nation</th>
              <th className="pb-2 pr-4 font-normal">Status</th>
              <th className="pb-2 pr-4 font-normal">Resolve as</th>
              <th className="pb-2 font-normal">Include?</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className={`border-b border-white/5 ${row.status === 'in_pool' ? 'opacity-40' : ''}`}>
                <td className="py-2 pr-4 text-spal-text">{row.csvName}</td>
                <td className="py-2 pr-4 text-spal-muted">{row.csvNation}</td>
                <td className={`py-2 pr-4 text-xs ${statusColor[row.status]}`}>
                  {statusLabel[row.status]}
                </td>
                <td className="py-2 pr-4">
                  {row.status === 'exact' && (
                    <span className="text-spal-muted text-xs">{row.canonical?.display_name}</span>
                  )}
                  {row.status === 'in_pool' && (
                    <span className="text-spal-muted text-xs italic">Skipped</span>
                  )}
                  {row.status === 'ambiguous' && (
                    <select
                      value={row.resolveCanonicalId ?? ''}
                      onChange={e => {
                        const val = e.target.value
                        if (val === '__new') {
                          onUpdateRow(idx, { resolveType: 'new', resolveCanonicalId: null })
                        } else {
                          onUpdateRow(idx, { resolveType: 'canonical', resolveCanonicalId: Number(val) })
                        }
                      }}
                      className="bg-spal-bg border border-white/10 rounded px-2 py-0.5 text-spal-text text-xs focus:outline-none focus:border-spal-cerulean"
                    >
                      {row.candidates?.map(c => (
                        <option key={c.id} value={c.id}>{c.display_name} ({c.nation})</option>
                      ))}
                      <option value="__new">Create new canonical…</option>
                    </select>
                  )}
                  {(row.status === 'new' || (row.status === 'ambiguous' && row.resolveType === 'new')) && (
                    <span className="flex items-center gap-1 flex-wrap">
                      <input
                        type="text"
                        value={row.resolveEditName}
                        onChange={e => onUpdateRow(idx, { resolveEditName: e.target.value })}
                        className="bg-spal-bg border border-white/10 rounded px-2 py-0.5 text-spal-text text-xs w-32 focus:outline-none focus:border-spal-cerulean"
                        placeholder="Name"
                      />
                      <select
                        value={row.resolveEditNation}
                        onChange={e => onUpdateRow(idx, { resolveEditNation: e.target.value })}
                        className="bg-spal-bg border border-white/10 rounded px-2 py-0.5 text-spal-text text-xs focus:outline-none focus:border-spal-cerulean"
                      >
                        {NATIONS.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <select
                        value={row.resolveEditPosition}
                        onChange={e => onUpdateRow(idx, { resolveEditPosition: e.target.value })}
                        className="bg-spal-bg border border-white/10 rounded px-2 py-0.5 text-spal-text text-xs focus:outline-none focus:border-spal-cerulean"
                      >
                        {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </span>
                  )}
                </td>
                <td className="py-2">
                  {row.status !== 'in_pool' && (
                    <input
                      type="checkbox"
                      checked={row.resolveType !== 'skip'}
                      onChange={e => {
                        if (!e.target.checked) {
                          onUpdateRow(idx, { resolveType: 'skip' })
                        } else {
                          const defaultType: ResolveType = row.status === 'new' ? 'new' : 'canonical'
                          onUpdateRow(idx, {
                            resolveType: defaultType,
                            resolveCanonicalId: row.status === 'exact' ? row.canonical?.id ?? null
                              : row.status === 'ambiguous' ? (row.candidates?.[0]?.id ?? null)
                              : null,
                          })
                        }
                      }}
                      className="accent-spal-cerulean"
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onConfirm}
          disabled={importing || toImport === 0}
          className="bg-spal-cerulean text-white text-sm rounded px-4 py-1.5 hover:bg-spal-cerulean-light disabled:opacity-50 transition-colors"
        >
          {importing ? 'Importing…' : `Import ${toImport} player${toImport !== 1 ? 's' : ''}`}
        </button>
        <button
          onClick={onCancel}
          disabled={importing}
          className="text-sm text-spal-muted hover:text-spal-text transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
