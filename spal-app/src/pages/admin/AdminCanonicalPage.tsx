import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/Toast'
import { ConfirmModal } from '../../components/ConfirmModal'
import { POSITION_GROUP, CANONICAL_POSITIONS as POSITIONS, NATIONS } from '../../lib/positions'

interface CanonicalPlayer {
  id: number
  display_name: string
  search_name: string
  nation: string
  canonical_position: string
}

const EMPTY_FORM = { display_name: '', nation: 'England' as string, canonical_position: 'Prop' as string }

function toSearchName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export default function AdminCanonicalPage() {
  const { addToast } = useToast()
  const [players, setPlayers]     = useState<CanonicalPlayer[]>([])
  const [loading, setLoading]     = useState(true)

  const [form, setForm]           = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery]     = useState('')
  const [filterNation, setFilterNation]   = useState('')
  const [filterPosition, setFilterPosition] = useState('')

  const [editingId, setEditingId]   = useState<number | null>(null)
  const [editForm, setEditForm]     = useState({ display_name: '', nation: '', canonical_position: '' })
  const [saving, setSaving]         = useState(false)

  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)

  async function load() {
    const { data, error } = await supabase
      .from('canonical_players')
      .select('id, display_name, search_name, nation, canonical_position')
      .order('display_name')
    if (error) { addToast(error.message, 'error'); return }
    setPlayers(data ?? [])
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return players.filter(p => {
      if (q && !p.display_name.toLowerCase().includes(q) && !p.search_name.includes(q)) return false
      if (filterNation && p.nation !== filterNation) return false
      if (filterPosition && p.canonical_position !== filterPosition) return false
      return true
    })
  }, [players, searchQuery, filterNation, filterPosition])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    const display_name = form.display_name.trim()

    const { error } = await supabase.from('canonical_players').insert({
      display_name,
      search_name:        toSearchName(display_name),
      nation:             form.nation,
      canonical_position: form.canonical_position,
      position_group:     POSITION_GROUP[form.canonical_position] ?? 'Other',
    })

    if (error) { setFormError(error.message); setSubmitting(false); return }
    setForm(EMPTY_FORM)
    addToast(`${display_name} added`, 'success')
    setSubmitting(false)
    load()
  }

  function startEdit(p: CanonicalPlayer) {
    setEditingId(p.id)
    setEditForm({ display_name: p.display_name, nation: p.nation, canonical_position: p.canonical_position })
  }

  async function commitEdit() {
    if (editingId == null) return
    setSaving(true)
    const display_name = editForm.display_name.trim()

    const { error } = await supabase
      .from('canonical_players')
      .update({
        display_name,
        search_name:        toSearchName(display_name),
        nation:             editForm.nation,
        canonical_position: editForm.canonical_position,
        position_group:     POSITION_GROUP[editForm.canonical_position] ?? 'Other',
      })
      .eq('id', editingId)

    setSaving(false)
    if (error) { addToast(error.message, 'error'); return }
    setEditingId(null)
    addToast('Player updated', 'success')
    load()
  }

  async function handleDelete() {
    if (pendingDeleteId == null) return
    const { error } = await supabase.from('canonical_players').delete().eq('id', pendingDeleteId)
    setPendingDeleteId(null)
    if (error) { addToast(error.message, 'error'); return }
    addToast('Player deleted', 'success')
    load()
  }

  const pendingDeleteName = players.find(p => p.id === pendingDeleteId)?.display_name

  return (
    <div>
      <h1 className="text-2xl font-bold text-spal-yellow mb-6">Canonical Players</h1>

      <div className="flex gap-8 items-start">
        {/* Create form */}
        <section className="bg-spal-surface rounded p-5 w-64 shrink-0">
          <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-4">Add player</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <Field label="Name" htmlFor="cn-name">
              <input
                id="cn-name"
                type="text"
                value={form.display_name}
                onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                required
                placeholder="e.g. Sergio Parisse"
                className={inputClass}
              />
            </Field>
            <Field label="Nation" htmlFor="cn-nation">
              <select
                id="cn-nation"
                value={form.nation}
                onChange={e => setForm(f => ({ ...f, nation: e.target.value }))}
                className={inputClass}
              >
                {NATIONS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Position" htmlFor="cn-position">
              <select
                id="cn-position"
                value={form.canonical_position}
                onChange={e => setForm(f => ({ ...f, canonical_position: e.target.value }))}
                className={inputClass}
              >
                {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            {formError && <p className="text-red-400 text-xs mt-1">{formError}</p>}
            <button type="submit" disabled={submitting} className={submitClass}>
              {submitting ? 'Adding…' : 'Add player'}
            </button>
          </form>
        </section>

        {/* Table */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by name…"
              className="bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean w-48"
            />
            <select
              value={filterNation}
              onChange={e => setFilterNation(e.target.value)}
              className="bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean"
            >
              <option value="">All nations</option>
              {NATIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <select
              value={filterPosition}
              onChange={e => setFilterPosition(e.target.value)}
              className="bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean"
            >
              <option value="">All positions</option>
              {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <span className="text-xs text-spal-muted ml-auto">{visible.length} of {players.length}</span>
          </div>

          {loading ? (
            <p className="text-spal-muted text-sm">Loading…</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-spal-muted border-b border-white/10">
                  <th className="pb-2 pr-4 font-normal">Name</th>
                  <th className="pb-2 pr-4 font-normal">Nation</th>
                  <th className="pb-2 pr-4 font-normal">Position</th>
                  <th className="pb-2 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(p => {
                  const isEditing = editingId === p.id
                  return (
                    <tr key={p.id} className="border-b border-white/5">
                      <td className="py-2 pr-4">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editForm.display_name}
                            onChange={e => setEditForm(f => ({ ...f, display_name: e.target.value }))}
                            className={inlineInputClass + ' w-44'}
                            autoFocus
                          />
                        ) : (
                          <span className="text-spal-text">{p.display_name}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {isEditing ? (
                          <select
                            value={editForm.nation}
                            onChange={e => setEditForm(f => ({ ...f, nation: e.target.value }))}
                            className={inlineInputClass}
                          >
                            {NATIONS.map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                        ) : (
                          <span className="text-spal-muted">{p.nation}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {isEditing ? (
                          <select
                            value={editForm.canonical_position}
                            onChange={e => setEditForm(f => ({ ...f, canonical_position: e.target.value }))}
                            className={inlineInputClass}
                          >
                            {POSITIONS.map(pos => <option key={pos} value={pos}>{pos}</option>)}
                          </select>
                        ) : (
                          <span className="text-spal-muted">{p.canonical_position}</span>
                        )}
                      </td>
                      <td className="py-2">
                        {isEditing ? (
                          <span className="flex items-center gap-3 justify-end">
                            <button
                              onClick={commitEdit}
                              disabled={saving}
                              className="text-xs text-spal-cerulean hover:text-spal-cerulean-light transition-colors disabled:opacity-50"
                            >
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="text-xs text-spal-muted hover:text-spal-text transition-colors"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <span className="flex items-center gap-3 justify-end">
                            <button
                              onClick={() => startEdit(p)}
                              className="text-xs text-spal-muted hover:text-spal-cerulean transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setPendingDeleteId(p.id)}
                              className="text-xs text-spal-muted hover:text-red-400 transition-colors"
                            >
                              Delete
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <ConfirmModal
        open={pendingDeleteId != null}
        title="Delete canonical player"
        message={`Remove "${pendingDeleteName}" from the canonical list? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm text-spal-muted mb-1">{label}</label>
      {children}
    </div>
  )
}

const inputClass =
  'w-full bg-spal-bg border border-white/10 rounded px-3 py-1.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'

const inlineInputClass =
  'bg-spal-bg border border-spal-cerulean/50 rounded px-2 py-0.5 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'

const submitClass =
  'bg-spal-cerulean text-white text-sm rounded px-4 py-1.5 hover:bg-spal-cerulean-light disabled:opacity-50 transition-colors w-full'
