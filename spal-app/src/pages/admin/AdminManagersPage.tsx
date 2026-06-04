import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/Toast'
import { ConfirmModal } from '../../components/ConfirmModal'
import { useAuth } from '../../hooks/useAuth'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorCard from '../../components/ErrorCard'

interface Profile {
  id: string
  email: string
  display_name: string
  team_name: string
  is_admin: boolean
  created_at: string
}

interface AuthMeta {
  last_sign_in_at: string | null
}

interface AuditEntry {
  id: string
  actor_id: string
  action: string
  entity_type: string
  entity_id: string
  metadata: Record<string, unknown>
  created_at: string
}

type FlowStep = 'search' | 'preview' | 'success'

interface InviteToken {
  id: number
  token: string
  created_at: string
  claimed_by: string | null
  claimedByName: string | null
}

const FK_TABLES = [
  'draft_order',
  'draft_picks',
  'manager_round_squads',
  'manager_match_scores',
  'fixture_group_members',
  'season_standings',
  'league_penalties',
] as const

function isPlaceholder(email: string) {
  return email.endsWith('@spal.placeholder')
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function makeToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => chars[b % chars.length]).join('')
}

function inviteUrl(token: string): string {
  return `${window.location.origin}/spal/signup?token=${token}`
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text)
}

export default function AdminManagersPage() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [authMeta, setAuthMeta] = useState<Record<string, AuthMeta>>({})
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(false)

  // Link Account side-panel state
  const [activePlaceholder, setActivePlaceholder] = useState<Profile | null>(null)
  const [flowStep, setFlowStep]                   = useState<FlowStep>('search')

  // Step 1: search
  const [searchQuery, setSearchQuery]       = useState('')
  const [searchResults, setSearchResults]   = useState<Profile[]>([])
  const searchRef = useRef<HTMLInputElement>(null)

  // Step 2: preview
  const [selectedReal, setSelectedReal]           = useState<Profile | null>(null)
  const [preview, setPreview]                     = useState<Record<string, number> | null>(null)
  const [previewLoading, setPreviewLoading]       = useState(false)
  const [confirmText, setConfirmText]             = useState('')
  const [merging, setMerging]                     = useState(false)
  const [showMergeModal, setShowMergeModal]       = useState(false)

  // Step 3: success
  const [auditResult, setAuditResult] = useState<AuditEntry | null>(null)

  // Invite tokens
  const [tokens, setTokens]           = useState<InviteToken[]>([])
  const [tokensLoading, setTokensLoading] = useState(true)
  const [tokensError, setTokensError] = useState(false)
  const [generating, setGenerating]   = useState(false)
  const [newToken, setNewToken]       = useState<string | null>(null)
  const [revokingId, setRevokingId]   = useState<number | null>(null)

  // ── Load profiles + auth metadata ────────────────────────────────────────

  async function load() {
    setLoading(true)
    setError(false)

    const [profilesRes, metaRes] = await Promise.all([
      supabase.from('profiles').select('id, email, display_name, team_name, is_admin, created_at').order('display_name'),
      supabase.functions.invoke('admin-managers'),
    ])

    if (profilesRes.error) {
      setError(true)
      setLoading(false)
      return
    }

    setProfiles(profilesRes.data as Profile[])

    if (!metaRes.error && metaRes.data?.users) {
      setAuthMeta(metaRes.data.users as Record<string, AuthMeta>)
    }

    setLoading(false)
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Invite tokens ─────────────────────────────────────────────────────────

  async function loadTokens() {
    setTokensLoading(true)
    setTokensError(false)
    const { data, error: fetchError } = await supabase
      .from('invite_tokens')
      .select('id, token, created_at, claimed_by, profiles!claimed_by(display_name)')
      .order('created_at', { ascending: false })
    if (fetchError) { setTokensError(true); setTokensLoading(false); return }
    type Raw = { id: number; token: string; created_at: string; claimed_by: string | null; profiles: { display_name: string } | null }
    setTokens((data ?? []).map((r: unknown) => {
      const t = r as Raw
      return { id: t.id, token: t.token, created_at: t.created_at, claimed_by: t.claimed_by, claimedByName: t.profiles?.display_name ?? null }
    }))
    setTokensLoading(false)
  }

  useEffect(() => { loadTokens() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleGenerateToken() {
    if (!user) return
    setGenerating(true)
    const token = makeToken()
    const { error } = await supabase
      .from('invite_tokens')
      .insert({ token, created_by: user.id })
    if (error) { addToast(error.message, 'error'); setGenerating(false); return }
    setNewToken(token)
    await loadTokens()
    setGenerating(false)
  }

  async function handleRevokeToken(id: number) {
    setRevokingId(id)
    const revokedToken = tokens.find(t => t.id === id)
    const { error } = await supabase
      .from('invite_tokens')
      .delete()
      .eq('id', id)
      .is('claimed_by', null)
    if (error) { addToast(error.message, 'error'); setRevokingId(null); return }
    if (revokedToken?.token === newToken) setNewToken(null)
    addToast('Token revoked', 'success')
    await loadTokens()
    setRevokingId(null)
  }

  // ── Search for real accounts ──────────────────────────────────────────────

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    const q = searchQuery.toLowerCase()
    const results = profiles.filter(p =>
      !isPlaceholder(p.email) &&
      p.id !== activePlaceholder?.id &&
      (p.display_name.toLowerCase().includes(q) ||
       p.email.toLowerCase().includes(q) ||
       p.team_name.toLowerCase().includes(q))
    )
    setSearchResults(results)
  }, [searchQuery, profiles, activePlaceholder])

  // ── Open Link Account panel ───────────────────────────────────────────────

  function openLink(profile: Profile) {
    setActivePlaceholder(profile)
    setFlowStep('search')
    setSearchQuery('')
    setSearchResults([])
    setSelectedReal(null)
    setPreview(null)
    setConfirmText('')
    setShowMergeModal(false)
    setAuditResult(null)
    setTimeout(() => searchRef.current?.focus(), 50)
  }

  function closePanel() {
    setActivePlaceholder(null)
  }

  // ── Select a real profile and fetch preview counts ────────────────────────

  async function selectReal(real: Profile) {
    if (!activePlaceholder) return
    setSelectedReal(real)
    setFlowStep('preview')
    setPreviewLoading(true)

    const counts = await Promise.all(
      FK_TABLES.map(async (table) => {
        const { count } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true })
          .eq('profile_id', activePlaceholder.id)
        return { table, count: count ?? 0 }
      })
    )

    const map: Record<string, number> = {}
    for (const { table, count } of counts) map[table] = count
    setPreview(map)
    setPreviewLoading(false)
  }

  // ── Execute merge ─────────────────────────────────────────────────────────

  async function handleMerge() {
    if (!activePlaceholder || !selectedReal) return
    setMerging(true)

    const { data, error } = await supabase.functions.invoke('merge-profiles', {
      body: { placeholder_id: activePlaceholder.id, real_id: selectedReal.id },
    })

    if (error || data?.error) {
      addToast(data?.error ?? error?.message ?? 'Merge failed', 'error')
      setMerging(false)
      return
    }

    setAuditResult(data.audit as AuditEntry)
    setFlowStep('success')
    addToast('Merge complete', 'success')
    setMerging(false)
    load()
  }

  const totalRows = preview ? Object.values(preview).reduce((a, b) => a + b, 0) : 0
  const canConfirm = confirmText === activePlaceholder?.display_name && !merging

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col md:flex-row gap-6 items-start">
      {/* Main list */}
      <div className="flex-1 min-w-0">
        <h1 className="text-xl font-bold text-spal-yellow mb-4">Managers</h1>

        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <ErrorCard onRetry={load} />
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-spal-muted border-b border-spal-surface-raised">
                <th className="pb-2 pr-4 font-medium">Manager</th>
                <th className="pb-2 pr-4 font-medium">Team</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 pr-4 font-medium">Last sign in</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {profiles.map(p => {
                const placeholder = isPlaceholder(p.email)
                const meta = authMeta[p.id]
                const isActive = activePlaceholder?.id === p.id
                return (
                  <tr
                    key={p.id}
                    className={`border-b border-spal-surface-raised/50 ${isActive ? 'bg-spal-surface-raised/30' : ''}`}
                  >
                    <td className="py-2.5 pr-4">
                      <div className="font-medium text-spal-text">{p.display_name}</div>
                      <div className="text-spal-muted text-xs mt-0.5">{p.email}</div>
                    </td>
                    <td className="py-2.5 pr-4 text-spal-muted">{p.team_name}</td>
                    <td className="py-2.5 pr-4">
                      {placeholder ? (
                        <span className="px-2 py-0.5 rounded text-xs bg-amber-500/20 text-amber-400 font-medium">
                          Placeholder
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-400 font-medium">
                          Linked
                        </span>
                      )}
                      {p.is_admin && (
                        <span className="ml-2 px-2 py-0.5 rounded text-xs bg-spal-cerulean/20 text-spal-cerulean font-medium">
                          Admin
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-spal-muted">
                      {fmtDate(meta?.last_sign_in_at ?? null)}
                    </td>
                    <td className="py-2.5 text-right">
                      {placeholder && (
                        <button
                          onClick={() => openLink(p)}
                          className="text-xs text-spal-cerulean hover:text-spal-cerulean-light transition-colors"
                        >
                          Link account
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
        {/* ── Invite Tokens ──────────────────────────────────────────────── */}
        <div className="mt-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider">Invite Tokens</h2>
            <button
              onClick={handleGenerateToken}
              disabled={generating}
              className="text-xs text-spal-cerulean hover:text-spal-cerulean-light disabled:opacity-40 transition-colors"
            >
              {generating ? 'Generating…' : '+ Generate token'}
            </button>
          </div>

          {/* Newly generated token */}
          {newToken && (
            <div className="mb-4 p-4 bg-spal-cerulean/10 border border-spal-cerulean/20 rounded">
              <div className="flex items-start justify-between mb-3">
                <p className="text-xs text-spal-muted">New token — share with the manager</p>
                <button
                  onClick={() => setNewToken(null)}
                  className="text-spal-muted hover:text-spal-text text-lg leading-none ml-2"
                >
                  ×
                </button>
              </div>
              <div className="flex items-center gap-3 mb-2">
                <code className="text-spal-cerulean font-mono text-base font-bold tracking-widest">
                  {newToken}
                </code>
                <button
                  onClick={() => { copyToClipboard(newToken); addToast('Token copied', 'success') }}
                  className="text-xs text-spal-muted hover:text-spal-text transition-colors"
                >
                  Copy code
                </button>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-spal-muted truncate flex-1 font-mono">
                  {inviteUrl(newToken)}
                </span>
                <button
                  onClick={() => { copyToClipboard(inviteUrl(newToken)); addToast('URL copied', 'success') }}
                  className="text-xs text-spal-muted hover:text-spal-text transition-colors shrink-0"
                >
                  Copy URL
                </button>
              </div>
            </div>
          )}

          {/* Token list */}
          {tokensLoading ? (
            <LoadingSpinner />
          ) : tokensError ? (
            <ErrorCard onRetry={loadTokens} />
          ) : tokens.length === 0 ? (
            <p className="text-spal-muted text-sm">No invite tokens yet.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-spal-muted border-b border-spal-surface-raised">
                  <th className="pb-2 pr-4 font-medium">Token</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Claimed by</th>
                  <th className="pb-2 pr-4 font-medium">Created</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {tokens.map(t => (
                  <tr key={t.id} className="border-b border-spal-surface-raised/50">
                    <td className="py-2.5 pr-4 font-mono text-spal-text tracking-wider">{t.token}</td>
                    <td className="py-2.5 pr-4">
                      {t.claimed_by ? (
                        <span className="px-2 py-0.5 rounded text-xs bg-white/10 text-spal-muted">Claimed</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-400">Unclaimed</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-spal-muted">{t.claimedByName ?? '—'}</td>
                    <td className="py-2.5 pr-4 text-spal-muted">{fmtDate(t.created_at)}</td>
                    <td className="py-2.5 text-right">
                      {!t.claimed_by && (
                        <button
                          onClick={() => handleRevokeToken(t.id)}
                          disabled={revokingId === t.id}
                          className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40 transition-colors"
                        >
                          {revokingId === t.id ? 'Revoking…' : 'Revoke'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>

      {/* Link Account side panel */}
      {activePlaceholder && (
        <div className="w-full md:w-80 md:shrink-0 bg-spal-surface rounded p-4 md:sticky md:top-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="font-semibold text-spal-text">Link account</h2>
              <p className="text-xs text-spal-muted mt-0.5">{activePlaceholder.display_name}</p>
            </div>
            <button
              onClick={closePanel}
              className="text-spal-muted hover:text-spal-text transition-colors text-lg leading-none"
            >
              ×
            </button>
          </div>

          {/* Step 1: search */}
          {flowStep === 'search' && (
            <div>
              <p className="text-xs text-spal-muted mb-3">
                Search for the real account to link this placeholder to.
              </p>
              <input
                ref={searchRef}
                type="text"
                placeholder="Name, email, or team…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-spal-surface-raised text-spal-text px-3 py-2 rounded text-sm outline-none focus:ring-1 focus:ring-spal-cerulean"
              />
              {searchQuery && searchResults.length === 0 && (
                <p className="text-spal-muted text-xs mt-3">No matching accounts found.</p>
              )}
              {searchResults.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {searchResults.map(r => (
                    <li key={r.id}>
                      <button
                        onClick={() => selectReal(r)}
                        className="w-full text-left px-3 py-2 rounded bg-spal-surface-raised hover:bg-spal-surface-raised/80 transition-colors text-sm"
                      >
                        <div className="font-medium text-spal-text">{r.display_name}</div>
                        <div className="text-spal-muted text-xs">{r.email}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Step 2: preview + confirm */}
          {flowStep === 'preview' && selectedReal && (
            <div>
              <div className="mb-3 text-xs text-spal-muted">
                Merging <span className="text-spal-text font-medium">{activePlaceholder.display_name}</span>
                {' '}into{' '}
                <span className="text-spal-text font-medium">{selectedReal.display_name}</span>
                {' '}({selectedReal.email})
              </div>

              {previewLoading ? (
                <div className="flex justify-center py-4">
                  <div className="w-5 h-5 rounded-full border-2 border-spal-cerulean border-t-transparent animate-spin" />
                </div>
              ) : preview && (
                <>
                  <table className="w-full text-xs mb-3">
                    <thead>
                      <tr className="text-left text-spal-muted border-b border-spal-surface-raised">
                        <th className="pb-1 font-medium">Table</th>
                        <th className="pb-1 text-right font-medium">Rows</th>
                      </tr>
                    </thead>
                    <tbody>
                      {FK_TABLES.map(t => (
                        <tr key={t} className="border-b border-spal-surface-raised/30">
                          <td className="py-1 text-spal-muted">{t.replace(/_/g, ' ')}</td>
                          <td className="py-1 text-right text-spal-text">{preview[t]}</td>
                        </tr>
                      ))}
                      <tr>
                        <td className="pt-2 font-medium text-spal-text">Total</td>
                        <td className="pt-2 text-right font-medium text-spal-text">{totalRows}</td>
                      </tr>
                    </tbody>
                  </table>

                  <p className="text-xs text-spal-muted mb-1">
                    Type <span className="font-mono text-spal-text">{activePlaceholder.display_name}</span> to confirm.
                  </p>
                  <input
                    type="text"
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value)}
                    placeholder={activePlaceholder.display_name}
                    className="w-full bg-spal-surface-raised text-spal-text px-3 py-2 rounded text-sm outline-none focus:ring-1 focus:ring-spal-cerulean mb-3"
                  />

                  <div className="flex gap-2">
                    <button
                      onClick={() => { setFlowStep('search'); setSelectedReal(null); setPreview(null); setConfirmText('') }}
                      className="flex-1 py-2 rounded bg-spal-surface-raised text-spal-muted hover:text-spal-text text-xs transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={() => setShowMergeModal(true)}
                      disabled={!canConfirm}
                      className="flex-1 py-2 rounded bg-spal-cerulean text-white text-xs font-medium hover:bg-spal-cerulean-light transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {merging ? 'Merging…' : 'Merge'}
                    </button>
                  </div>

                  <ConfirmModal
                    open={showMergeModal}
                    title="Confirm merge"
                    message={`Reassign ${totalRows} row${totalRows !== 1 ? 's' : ''} from "${activePlaceholder?.display_name}" to "${selectedReal?.display_name}". This cannot be undone.`}
                    confirmLabel="Yes, merge"
                    danger
                    onConfirm={() => { setShowMergeModal(false); handleMerge() }}
                    onCancel={() => setShowMergeModal(false)}
                  />
                </>
              )}
            </div>
          )}

          {/* Step 3: success */}
          {flowStep === 'success' && auditResult && (
            <div>
              <div className="text-emerald-400 font-medium text-sm mb-3">Merge complete</div>
              <div className="bg-spal-surface-raised rounded p-3 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-spal-muted">Placeholder</span>
                  <span className="text-spal-text">{String((auditResult.metadata as Record<string,unknown>).placeholder_email ?? '')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-spal-muted">Linked to</span>
                  <span className="text-spal-text">{String((auditResult.metadata as Record<string,unknown>).real_email ?? '')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-spal-muted">Display name</span>
                  <span className="text-spal-text">{String((auditResult.metadata as Record<string,unknown>).display_name ?? '')}</span>
                </div>
                {(() => {
                  const rows = (auditResult.metadata as Record<string,unknown>).rows_moved as Record<string,number> | undefined
                  const total = rows ? Object.values(rows).reduce((a, b) => a + b, 0) : 0
                  return (
                    <div className="flex justify-between pt-1 border-t border-spal-surface">
                      <span className="text-spal-muted">Rows moved</span>
                      <span className="text-spal-text font-medium">{total}</span>
                    </div>
                  )
                })()}
                <div className="pt-1 border-t border-spal-surface text-spal-muted">
                  Audit ID: <span className="font-mono text-spal-text break-all">{auditResult.id}</span>
                </div>
              </div>
              <button
                onClick={closePanel}
                className="mt-3 w-full py-2 rounded bg-spal-surface-raised text-spal-muted hover:text-spal-text text-xs transition-colors"
              >
                Close
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
