import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/Toast'
import { EmptyState } from '../../components/EmptyState'
import { toSearchName } from '../../lib/positions'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Season { id: number; year: number }

interface Match {
  id: string
  home_nation: string
  away_nation: string
  kickoff_at: string | null
}

interface SquadPlayer {
  player_id: number
  match_id: string
  status: 'starting' | 'bench' | 'not_selected'
  display_name: string
  nation: string
  canonical_position: string
}

interface PoolPlayer {
  id: number
  display_name: string
  search_name: string
  nation: string
  canonical_position: string
}

interface TsCsvRow { csvMatch: string; csvPlayer: string; csvStatus: string }

interface TsReviewRow {
  csvMatch: string
  csvPlayer: string
  csvStatus: string
  matchId: string | null
  matchLabel: string | null
  playerId: number | null
  playerLabel: string | null
  resolvedStatus: 'starting' | 'bench' | 'not_selected' | null
  issue: string | null
  include: boolean
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ROUNDS = [1, 2, 3, 4, 5] as const

const NATION_BADGE: Record<string, { abbr: string; cls: string }> = {
  England:  { abbr: 'ENG', cls: 'bg-red-900/40 text-red-300' },
  Ireland:  { abbr: 'IRE', cls: 'bg-green-900/40 text-green-300' },
  Scotland: { abbr: 'SCO', cls: 'bg-blue-900/40 text-blue-300' },
  Wales:    { abbr: 'WAL', cls: 'bg-rose-900/40 text-rose-300' },
  France:   { abbr: 'FRA', cls: 'bg-indigo-900/40 text-indigo-300' },
  Italy:    { abbr: 'ITA', cls: 'bg-sky-900/40 text-sky-300' },
}

const NATION_BY_LOWER: Record<string, string> = {
  england: 'England', eng: 'England',
  ireland: 'Ireland', ire: 'Ireland',
  scotland: 'Scotland', sco: 'Scotland',
  wales: 'Wales', wal: 'Wales',
  france: 'France', fra: 'France',
  italy: 'Italy', ita: 'Italy',
}

const POSITION_ORDER: Record<string, number> = {
  'Prop': 1, 'Hooker': 2, 'Second Row': 3, 'Flanker': 4, 'Number 8': 5,
  'Scrum-half': 6, 'Fly-half': 7, 'Centre': 8, 'Wing': 9, 'Fullback': 10,
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

function parseTsCsv(text: string): TsCsvRow[] {
  const lines = text.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase())
  const matchIdx  = header.findIndex(h => ['match', 'fixture', 'game'].includes(h))
  const playerIdx = header.findIndex(h => ['player_name', 'player', 'name', 'display_name'].includes(h))
  const statusIdx = header.findIndex(h => ['status', 'real_life_status'].includes(h))
  if (matchIdx === -1 || playerIdx === -1 || statusIdx === -1) return []

  return lines.slice(1).flatMap(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    const csvMatch  = cols[matchIdx]  ?? ''
    const csvPlayer = cols[playerIdx] ?? ''
    const csvStatus = cols[statusIdx] ?? ''
    if (!csvMatch || !csvPlayer || !csvStatus) return []
    return [{ csvMatch, csvPlayer, csvStatus }]
  })
}

function normalizeStatus(s: string): 'starting' | 'bench' | 'not_selected' | null {
  const l = s.toLowerCase().trim()
  if (['starting', 'starter', 's'].includes(l)) return 'starting'
  if (['bench', 'b', 'replacement', 'r'].includes(l)) return 'bench'
  if (['not_selected', 'not selected', 'ns', 'n/a', 'na', 'out'].includes(l)) return 'not_selected'
  return null
}

function buildTsReviewRows(csvRows: TsCsvRow[], matches: Match[], pool: PoolPlayer[]): TsReviewRow[] {
  function resolveMatch(s: string): Match | null {
    const parts = s.split(/\s+vs\.?\s+/i)
    if (parts.length !== 2) return null
    const home = NATION_BY_LOWER[parts[0].trim().toLowerCase()]
    const away = NATION_BY_LOWER[parts[1].trim().toLowerCase()]
    if (!home || !away) return null
    return matches.find(m => m.home_nation === home && m.away_nation === away) ?? null
  }

  return csvRows.map(row => {
    const match  = resolveMatch(row.csvMatch)
    const player = pool.find(p => p.search_name === toSearchName(row.csvPlayer)) ?? null
    const status = normalizeStatus(row.csvStatus)

    let issue: string | null = null
    if (!match) {
      issue = `Match not found: "${row.csvMatch}"`
    } else if (!player) {
      issue = `Player not in pool: "${row.csvPlayer}"`
    } else if (player.nation !== match.home_nation && player.nation !== match.away_nation) {
      // Player's nation must be one of the two teams in this match
      issue = `Player's nation (${player.nation}) is not in this match (${match.home_nation} vs ${match.away_nation})`
    } else if (!status) {
      issue = `Unknown status: "${row.csvStatus}"`
    }

    return {
      csvMatch:       row.csvMatch,
      csvPlayer:      row.csvPlayer,
      csvStatus:      row.csvStatus,
      matchId:        match?.id ?? null,
      matchLabel:     match ? `${match.home_nation} vs ${match.away_nation}` : null,
      playerId:       player?.id ?? null,
      playerLabel:    player ? `${player.display_name} (${player.nation})` : null,
      resolvedStatus: status,
      issue,
      include:        !issue,
    }
  })
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminTeamSheetsPage() {
  const { addToast } = useToast()

  const [seasons, setSeasons]                   = useState<Season[]>([])
  const [selectedSeasonId, setSelectedSeasonId] = useState<number | null>(null)
  const [selectedRound, setSelectedRound]       = useState(1)
  const [tab, setTab]                           = useState<'manual' | 'csv'>('manual')

  const [matches, setMatches]   = useState<Match[]>([])
  const [squadMap, setSquadMap] = useState<Map<string, SquadPlayer[]>>(new Map())
  const [pool, setPool]         = useState<PoolPlayer[]>([])
  const [loading, setLoading]   = useState(false)

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

  useEffect(() => {
    if (selectedSeasonId == null) return
    supabase
      .from('players')
      .select('id, display_name, search_name, nation, canonical_position')
      .eq('season_id', selectedSeasonId)
      .order('display_name')
      .then(({ data }) => setPool(data ?? []))
  }, [selectedSeasonId])

  useEffect(() => {
    if (selectedSeasonId == null) return
    loadRound(selectedSeasonId, selectedRound)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeasonId, selectedRound])

  async function loadRound(seasonId: number, round: number) {
    setLoading(true)
    const { data: matchData } = await supabase
      .from('matches')
      .select('id, home_nation, away_nation, kickoff_at')
      .eq('season_id', seasonId)
      .eq('round_number', round)
      .order('kickoff_at')

    const newMatches = (matchData ?? []) as Match[]
    setMatches(newMatches)

    if (newMatches.length === 0) {
      setSquadMap(new Map())
      setLoading(false)
      return
    }
    await loadSquads(newMatches.map(m => m.id))
    setLoading(false)
  }

  async function loadSquads(matchIds: string[]) {
    const { data: mdData } = await supabase
      .from('matchday_squads')
      .select('match_id, status, player_id, players!player_id(display_name, nation, canonical_position)')
      .in('match_id', matchIds)

    const map = new Map<string, SquadPlayer[]>()
    for (const id of matchIds) map.set(id, [])

    for (const row of (mdData ?? []) as unknown as Array<{
      match_id: string; status: string; player_id: number
      players: { display_name: string; nation: string; canonical_position: string } | null
    }>) {
      if (!row.players) continue
      const entry: SquadPlayer = {
        player_id:          row.player_id,
        match_id:           row.match_id,
        status:             row.status as SquadPlayer['status'],
        display_name:       row.players.display_name,
        nation:             row.players.nation,
        canonical_position: row.players.canonical_position,
      }
      const list = map.get(row.match_id) ?? []
      list.push(entry)
      map.set(row.match_id, list)
    }
    setSquadMap(map)
  }

  async function handleAdd(matchId: string, playerId: number, status: 'starting' | 'bench') {
    const match  = matches.find(m => m.id === matchId)
    const player = pool.find(p => p.id === playerId)

    if (match && player && player.nation !== match.home_nation && player.nation !== match.away_nation) {
      addToast(
        `This player's nation (${player.nation}) is not playing in this match (${match.home_nation} vs ${match.away_nation})`,
        'error'
      )
      return
    }

    const { error } = await supabase
      .from('matchday_squads')
      .upsert(
        { match_id: matchId, player_id: playerId, status, source: 'admin' },
        { onConflict: 'match_id,player_id' }
      )
    if (error) { addToast(error.message, 'error'); return }
    await loadSquads(matches.map(m => m.id))
  }

  async function handleRemove(matchId: string, playerId: number) {
    const { error } = await supabase
      .from('matchday_squads')
      .delete()
      .eq('match_id', matchId)
      .eq('player_id', playerId)
    if (error) { addToast(error.message, 'error'); return }
    await loadSquads(matches.map(m => m.id))
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-spal-yellow mb-6">Team Sheets</h1>

      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-spal-muted">Season</label>
          <select
            value={selectedSeasonId ?? ''}
            onChange={e => setSelectedSeasonId(Number(e.target.value))}
            className="bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean"
          >
            {seasons.map(s => <option key={s.id} value={s.id}>{s.year}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1">
          {ROUNDS.map(r => (
            <button
              key={r}
              onClick={() => setSelectedRound(r)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
                selectedRound === r
                  ? 'border-spal-cerulean bg-spal-cerulean/10 text-spal-cerulean'
                  : 'border-white/10 text-spal-muted hover:border-white/30 hover:text-spal-text'
              }`}
            >
              R{r}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4 mb-6 border-b border-white/10">
        {(['manual', 'csv'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm border-b-2 transition-colors -mb-px ${
              tab === t
                ? 'border-spal-cerulean text-spal-cerulean'
                : 'border-transparent text-spal-muted hover:text-spal-text'
            }`}
          >
            {t === 'manual' ? 'Manual entry' : 'CSV import'}
          </button>
        ))}
      </div>

      {tab === 'manual' && (
        loading ? (
          <p className="text-spal-muted text-sm">Loading…</p>
        ) : matches.length === 0 ? (
          <EmptyState
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            }
            title="No matches for this round"
            body="Add matches via the Seasons page first."
          />
        ) : (
          <div className="space-y-6">
            {matches.map(match => (
              <MatchPanel
                key={match.id}
                match={match}
                players={squadMap.get(match.id) ?? []}
                pool={pool}
                onAdd={handleAdd}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )
      )}

      {tab === 'csv' && (
        <CsvTeamSheetsPanel
          matches={matches}
          pool={pool}
          onImportDone={() => loadSquads(matches.map(m => m.id))}
        />
      )}
    </div>
  )
}

// ── MatchPanel ────────────────────────────────────────────────────────────────

interface MatchPanelProps {
  match: Match
  players: SquadPlayer[]
  pool: PoolPlayer[]
  onAdd: (matchId: string, playerId: number, status: 'starting' | 'bench') => Promise<void>
  onRemove: (matchId: string, playerId: number) => Promise<void>
}

function MatchPanel({ match, players, pool, onAdd, onRemove }: MatchPanelProps) {
  const [addingFor, setAddingFor] = useState<{ nation: string; status: 'starting' | 'bench' } | null>(null)
  const [query, setQuery]         = useState('')
  const [saving, setSaving]       = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const presentIds = useMemo(
    () => new Set(players.map(p => p.player_id)),
    [players]
  )

  // Pool is the season's player pool — the source of truth for which players are
  // available. Only pool players can be added to a matchday squad, by design.
  // Results are further scoped to the nation of the section being added to.
  const searchResults = useMemo(() => {
    if (!addingFor || !query.trim()) return []
    const q = query.toLowerCase()
    return pool
      .filter(p =>
        !presentIds.has(p.id) &&
        p.nation === addingFor.nation &&
        p.display_name.toLowerCase().includes(q)
      )
      .slice(0, 8)
  }, [query, addingFor, pool, presentIds])

  function startAdding(nation: string, status: 'starting' | 'bench') {
    setAddingFor({ nation, status })
    setQuery('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function cancelAdding() {
    setAddingFor(null)
    setQuery('')
  }

  async function addPlayer(player: PoolPlayer) {
    if (!addingFor) return
    setSaving(true)
    await onAdd(match.id, player.id, addingFor.status)
    setSaving(false)
    cancelAdding()
  }

  const badge = (nation: string) => {
    const info = NATION_BADGE[nation]
    return (
      <span className={`text-xs font-mono rounded px-1.5 py-0.5 ${info?.cls ?? 'bg-white/10 text-spal-muted'}`}>
        {info?.abbr ?? nation.slice(0, 3).toUpperCase()}
      </span>
    )
  }

  const kickoffLabel = match.kickoff_at
    ? new Date(match.kickoff_at).toLocaleDateString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit',
      })
    : null

  // Render one team's starters + bench with add controls
  function renderTeam(nation: string) {
    const starters = players
      .filter(p => p.nation === nation && p.status === 'starting')
      .sort((a, b) => (POSITION_ORDER[a.canonical_position] ?? 99) - (POSITION_ORDER[b.canonical_position] ?? 99))
    const bench = players.filter(p => p.nation === nation && p.status === 'bench')
    const addingHereStart = addingFor?.nation === nation && addingFor?.status === 'starting'
    const addingHereBench = addingFor?.nation === nation && addingFor?.status === 'bench'

    return (
      <div>
        {/* Nation subheading */}
        <div className="flex items-center gap-2 mb-3">
          {badge(nation)}
          <span className="text-sm font-semibold text-spal-text">{nation}</span>
        </div>

        {/* Starters */}
        <div className="mb-4 pl-3 border-l border-white/5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs text-spal-muted uppercase tracking-wider">Starters</span>
            <span className="text-xs text-spal-muted">{starters.length}/15</span>
          </div>
          {starters.map(p => (
            <PlayerRow key={p.player_id} player={p} badgeFn={badge} onRemove={() => onRemove(match.id, p.player_id)} />
          ))}
          {addingHereStart ? (
            <AddSearch inputRef={inputRef} query={query} results={searchResults} saving={saving}
              onChange={setQuery} onSelect={addPlayer} onCancel={cancelAdding} />
          ) : (
            <button onClick={() => startAdding(nation, 'starting')}
              className="mt-1 text-xs text-spal-muted hover:text-spal-cerulean transition-colors">
              + Add starter
            </button>
          )}
        </div>

        {/* Bench */}
        <div className="pl-3 border-l border-white/5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs text-spal-muted uppercase tracking-wider">Bench</span>
            <span className="text-xs text-spal-muted">{bench.length}/8</span>
          </div>
          {bench.map(p => (
            <PlayerRow key={p.player_id} player={p} badgeFn={badge} onRemove={() => onRemove(match.id, p.player_id)} />
          ))}
          {addingHereBench ? (
            <AddSearch inputRef={inputRef} query={query} results={searchResults} saving={saving}
              onChange={setQuery} onSelect={addPlayer} onCancel={cancelAdding} />
          ) : (
            <button onClick={() => startAdding(nation, 'bench')}
              className="mt-1 text-xs text-spal-muted hover:text-spal-cerulean transition-colors">
              + Add bench player
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-spal-surface rounded-lg p-5 border border-white/5">
      {/* Match header */}
      <div className="flex items-center gap-2 mb-6">
        {badge(match.home_nation)}
        <span className="text-spal-text font-semibold">
          {match.home_nation} vs {match.away_nation}
        </span>
        {badge(match.away_nation)}
        {kickoffLabel && (
          <span className="text-xs text-spal-muted ml-auto">{kickoffLabel}</span>
        )}
      </div>

      {renderTeam(match.home_nation)}
      <div className="border-t border-white/10 my-5" />
      {renderTeam(match.away_nation)}
    </div>
  )
}

interface PlayerRowProps {
  player: SquadPlayer
  badgeFn: (nation: string) => React.ReactNode
  onRemove: () => void
}

function PlayerRow({ player, badgeFn, onRemove }: PlayerRowProps) {
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-white/5 last:border-0">
      {badgeFn(player.nation)}
      <span className="text-spal-text text-sm flex-1">{player.display_name}</span>
      <span className="text-spal-muted text-xs">{player.canonical_position}</span>
      <button
        onClick={onRemove}
        className="text-xs text-spal-muted hover:text-red-400 transition-colors ml-2"
      >
        Remove
      </button>
    </div>
  )
}

interface AddSearchProps {
  inputRef: React.RefObject<HTMLInputElement>
  query: string
  results: PoolPlayer[]
  saving: boolean
  onChange: (q: string) => void
  onSelect: (p: PoolPlayer) => void
  onCancel: () => void
}

function AddSearch({ inputRef, query, results, saving, onChange, onSelect, onCancel }: AddSearchProps) {
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => onChange(e.target.value)}
          placeholder="Search pool by name…"
          disabled={saving}
          className="bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean w-56 disabled:opacity-50"
        />
        <button onClick={onCancel} className="text-xs text-spal-muted hover:text-spal-text transition-colors">
          Cancel
        </button>
      </div>
      {results.length > 0 && (
        <ul className="mt-1 bg-spal-bg border border-white/10 rounded divide-y divide-white/5 max-h-48 overflow-y-auto">
          {results.map(p => (
            <li key={p.id}>
              <button
                onClick={() => onSelect(p)}
                disabled={saving}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                <span className="text-spal-text">{p.display_name}</span>
                <span className="text-spal-muted ml-2 text-xs">{p.canonical_position}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── CsvTeamSheetsPanel ────────────────────────────────────────────────────────

interface CsvTeamSheetsPanelProps {
  matches: Match[]
  pool: PoolPlayer[]
  onImportDone: () => void
}

function CsvTeamSheetsPanel({ matches, pool, onImportDone }: CsvTeamSheetsPanelProps) {
  const { addToast } = useToast()
  const fileInputRef  = useRef<HTMLInputElement>(null)

  const [step, setStep]             = useState<'idle' | 'review' | 'done'>('idle')
  const [reviewRows, setReviewRows] = useState<TsReviewRow[]>([])
  const [importing, setImporting]   = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError(null)

    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const csvRows = parseTsCsv(text)

      if (csvRows.length === 0) {
        setParseError('No valid rows found. Expected columns: match, player_name, status.')
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }

      setReviewRows(buildTsReviewRows(csvRows, matches, pool))
      setStep('review')
    }
    reader.readAsText(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleConfirm() {
    setImporting(true)
    const toImport = reviewRows.filter(r => r.include && !r.issue)
    let inserted = 0

    for (const row of toImport) {
      if (!row.matchId || !row.playerId || !row.resolvedStatus) continue
      const { error } = await supabase
        .from('matchday_squads')
        .upsert(
          { match_id: row.matchId, player_id: row.playerId, status: row.resolvedStatus, source: 'admin_csv' },
          { onConflict: 'match_id,player_id' }
        )
      if (!error) inserted++
    }

    setImporting(false)
    setStep('done')
    addToast(`${inserted} entries saved`, inserted > 0 ? 'success' : 'error')
    onImportDone()
  }

  function toggleInclude(idx: number) {
    setReviewRows(rows => rows.map((r, i) => i === idx ? { ...r, include: !r.include } : r))
  }

  const toImportCount = reviewRows.filter(r => r.include && !r.issue).length
  const issueCount    = reviewRows.filter(r => !!r.issue).length

  if (step === 'idle') {
    return (
      <div>
        {matches.length === 0 && (
          <p className="text-sm text-amber-400 mb-4">No matches loaded for this round — select a round with matches first.</p>
        )}
        {parseError && (
          <p className="text-sm text-red-400 mb-4 bg-red-500/10 border border-red-500/20 rounded px-4 py-2">{parseError}</p>
        )}
        <div className="flex items-center gap-4">
          <label className="cursor-pointer">
            <span className="text-sm text-spal-cerulean border border-spal-cerulean/40 rounded px-4 py-2 hover:bg-spal-cerulean/10 transition-colors">
              Upload CSV
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={handleFileChange}
              disabled={matches.length === 0}
            />
          </label>
          <a
            href="data:text/csv;charset=utf-8,match,player_name,status%0AEngland%20vs%20Ireland,Owen%20Farrell,starting%0AEngland%20vs%20Ireland,Tom%20Curry,bench"
            download="teamsheet-template.csv"
            className="text-xs text-spal-muted hover:text-spal-text transition-colors"
          >
            Download template
          </a>
        </div>
        <p className="text-xs text-spal-muted mt-3">
          Format: <span className="text-spal-text font-mono">match</span> (e.g. "England vs Ireland"),{' '}
          <span className="text-spal-text font-mono">player_name</span>,{' '}
          <span className="text-spal-text font-mono">status</span> (starting / bench / not_selected).
          Player's nation must match one of the two teams in the match.
        </p>
      </div>
    )
  }

  if (step === 'done') {
    return (
      <div>
        <p className="text-spal-text mb-4">Import complete.</p>
        <button
          onClick={() => { setStep('idle'); setReviewRows([]) }}
          className="text-sm text-spal-cerulean hover:text-spal-cerulean-light transition-colors"
        >
          Import another file
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-4 text-xs text-spal-muted mb-4">
        <span><span className="text-spal-text font-medium">{reviewRows.length}</span> rows</span>
        {issueCount > 0 && <span><span className="text-amber-400 font-medium">{issueCount}</span> with issues (will be skipped)</span>}
        <span><span className="text-emerald-400 font-medium">{toImportCount}</span> ready to import</span>
      </div>

      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-spal-muted border-b border-white/10">
              <th className="pb-2 pr-4 font-normal">Match</th>
              <th className="pb-2 pr-4 font-normal">Player</th>
              <th className="pb-2 pr-4 font-normal">Status</th>
              <th className="pb-2 pr-4 font-normal">Issue</th>
              <th className="pb-2 font-normal">Include</th>
            </tr>
          </thead>
          <tbody>
            {reviewRows.map((row, idx) => (
              <tr key={idx} className={`border-b border-white/5 ${row.issue ? 'opacity-50' : ''}`}>
                <td className="py-2 pr-4 text-spal-muted text-xs">{row.matchLabel ?? row.csvMatch}</td>
                <td className="py-2 pr-4 text-spal-text">{row.playerLabel ?? row.csvPlayer}</td>
                <td className="py-2 pr-4 text-spal-muted text-xs">{row.resolvedStatus ?? row.csvStatus}</td>
                <td className="py-2 pr-4 text-xs text-amber-400">{row.issue ?? '—'}</td>
                <td className="py-2">
                  {!row.issue && (
                    <input type="checkbox" checked={row.include} onChange={() => toggleInclude(idx)}
                      className="accent-spal-cerulean" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleConfirm}
          disabled={importing || toImportCount === 0}
          className="bg-spal-cerulean text-white text-sm rounded px-4 py-1.5 hover:bg-spal-cerulean-light disabled:opacity-50 transition-colors"
        >
          {importing ? 'Importing…' : `Import ${toImportCount} row${toImportCount !== 1 ? 's' : ''}`}
        </button>
        <button
          onClick={() => { setStep('idle'); setReviewRows([]) }}
          disabled={importing}
          className="text-sm text-spal-muted hover:text-spal-text transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
