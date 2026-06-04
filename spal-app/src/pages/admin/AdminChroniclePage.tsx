import { useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../components/Toast'
import { ConfirmModal } from '../../components/ConfirmModal'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorCard from '../../components/ErrorCard'

interface Post {
  id: number
  slug: string
  title: string
  body: string
  published: boolean
  published_at: string | null
  created_at: string
  author: string
}

type FormMode = 'create' | 'edit'

interface PostForm {
  title: string
  slug: string
  body: string
  published: boolean
}

const EMPTY_FORM: PostForm = { title: '', slug: '', body: '', published: false }

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export default function AdminChroniclePage() {
  const { user } = useAuth()
  const { addToast } = useToast()

  const [posts, setPosts]           = useState<Post[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(false)
  const [mode, setMode]             = useState<FormMode | null>(null)
  const [editingId, setEditingId]   = useState<number | null>(null)
  const [form, setForm]             = useState<PostForm>(EMPTY_FORM)
  const [slugTouched, setSlugTouched] = useState(false)
  const [saving, setSaving]         = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Post | null>(null)

  async function loadPosts() {
    setError(false)
    const { data, error: fetchError } = await supabase
      .from('chronicle_posts')
      .select('id, slug, title, body, published, published_at, created_at, profiles!author_id(display_name)')
      .order('created_at', { ascending: false })

    if (fetchError) { setError(true); setLoading(false); return }

    type Raw = { id: number; slug: string; title: string; body: string; published: boolean; published_at: string | null; created_at: string; profiles: { display_name: string } | null }
    setPosts(
      ((data ?? []) as unknown as Raw[]).map(p => ({
        id:           p.id,
        slug:         p.slug,
        title:        p.title,
        body:         p.body,
        published:    p.published,
        published_at: p.published_at,
        created_at:   p.created_at,
        author:       p.profiles?.display_name ?? 'Admin',
      }))
    )
    setLoading(false)
  }

  useEffect(() => { loadPosts() }, [])

  function openCreate() {
    setMode('create')
    setEditingId(null)
    setForm(EMPTY_FORM)
    setSlugTouched(false)
    setShowPreview(false)
  }

  function openEdit(post: Post) {
    setMode('edit')
    setEditingId(post.id)
    setForm({ title: post.title, slug: post.slug, body: post.body, published: post.published })
    setSlugTouched(true)
    setShowPreview(false)
  }

  function handleTitleChange(title: string) {
    setForm(f => ({
      ...f,
      title,
      slug: slugTouched ? f.slug : slugify(title),
    }))
  }

  async function handleSave() {
    if (!user || !form.title.trim() || !form.slug.trim() || !form.body.trim()) return
    setSaving(true)

    const payload = {
      title:        form.title.trim(),
      slug:         form.slug.trim(),
      body:         form.body,
      published:    form.published,
      published_at: form.published ? (mode === 'create' ? new Date().toISOString() : undefined) : null,
    }

    let error: { message: string } | null = null

    if (mode === 'create') {
      const res = await supabase.from('chronicle_posts').insert({ ...payload, author_id: user.id })
      error = res.error
    } else if (editingId != null) {
      const updatePayload: Record<string, unknown> = { ...payload }
      // Only set published_at if publishing for the first time (existing post without published_at)
      const existing = posts.find(p => p.id === editingId)
      if (form.published && !existing?.published_at) {
        updatePayload.published_at = new Date().toISOString()
      } else if (!form.published) {
        updatePayload.published_at = null
      } else {
        delete updatePayload.published_at
      }
      const res = await supabase.from('chronicle_posts').update(updatePayload).eq('id', editingId)
      error = res.error
    }

    setSaving(false)
    if (error) { addToast(error.message, 'error'); return }
    addToast(mode === 'create' ? 'Post created' : 'Post saved', 'success')
    setMode(null)
    await loadPosts()
  }

  async function handleTogglePublish(post: Post) {
    const nowPublished = !post.published
    const { error } = await supabase
      .from('chronicle_posts')
      .update({
        published:    nowPublished,
        published_at: nowPublished ? (post.published_at ?? new Date().toISOString()) : null,
      })
      .eq('id', post.id)
    if (error) { addToast(error.message, 'error'); return }
    addToast(nowPublished ? 'Post published' : 'Post unpublished', 'success')
    await loadPosts()
  }

  async function handleDelete() {
    if (!pendingDelete) return
    const { error } = await supabase.from('chronicle_posts').delete().eq('id', pendingDelete.id)
    setPendingDelete(null)
    if (error) { addToast(error.message, 'error'); return }
    addToast('Post deleted', 'success')
    await loadPosts()
  }

  const previewHtml = useMemo(
    () => (showPreview ? (marked.parse(form.body, { async: false }) as string) : ''),
    [form.body, showPreview]
  )

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  const inputClass    = 'w-full bg-spal-bg border border-white/10 rounded px-3 py-2 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean'
  const textareaClass = `${inputClass} resize-none font-mono`
  const btnPrimary    = 'bg-spal-cerulean text-white text-sm rounded px-4 py-1.5 hover:bg-spal-cerulean-light disabled:opacity-50 transition-colors'
  const btnGhost      = 'text-sm text-spal-muted hover:text-spal-text transition-colors'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-spal-yellow">Chronicle</h1>
        {mode == null && (
          <button onClick={openCreate} className={btnPrimary}>
            New post
          </button>
        )}
      </div>

      {/* Create / Edit form */}
      {mode != null && (
        <div className="bg-spal-surface border border-white/10 rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold text-spal-text">
            {mode === 'create' ? 'New post' : 'Edit post'}
          </h2>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-spal-muted mb-1">Title</label>
              <input
                value={form.title}
                onChange={e => handleTitleChange(e.target.value)}
                className={inputClass}
                placeholder="Post title"
              />
            </div>

            <div>
              <label className="block text-xs text-spal-muted mb-1">Slug</label>
              <input
                value={form.slug}
                onChange={e => { setSlugTouched(true); setForm(f => ({ ...f, slug: e.target.value })) }}
                className={inputClass}
                placeholder="url-slug"
              />
              <p className="text-xs text-spal-muted mt-1">/spal/chronicle/{form.slug || '…'}</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-spal-muted">Body (Markdown)</label>
                <button
                  type="button"
                  onClick={() => setShowPreview(p => !p)}
                  className="text-xs text-spal-cerulean hover:text-spal-cerulean-light transition-colors"
                >
                  {showPreview ? 'Edit' : 'Preview'}
                </button>
              </div>
              {showPreview ? (
                <div
                  className="prose-spal min-h-[200px] bg-spal-bg border border-white/10 rounded px-3 py-2"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              ) : (
                <textarea
                  value={form.body}
                  onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                  className={textareaClass}
                  rows={16}
                  placeholder="Write in Markdown…"
                />
              )}
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.published}
                onChange={e => setForm(f => ({ ...f, published: e.target.checked }))}
                className="rounded"
              />
              <span className="text-sm text-spal-text">Published</span>
            </label>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button onClick={handleSave} disabled={saving || !form.title.trim() || !form.slug.trim() || !form.body.trim()} className={btnPrimary}>
              {saving ? 'Saving…' : mode === 'create' ? 'Create post' : 'Save changes'}
            </button>
            <button onClick={() => setMode(null)} className={btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      {/* Post list */}
      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorCard onRetry={loadPosts} />
      ) : posts.length === 0 ? (
        <p className="text-spal-muted text-sm">No posts yet.</p>
      ) : (
        <div className="space-y-3">
          {posts.map(post => (
            <div
              key={post.id}
              className="bg-spal-surface border border-white/10 rounded-lg p-4 flex items-start justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-spal-text truncate">{post.title}</span>
                  <span className={`text-xs rounded-full px-2 py-0.5 ${post.published ? 'bg-green-900/40 text-green-400' : 'bg-white/5 text-spal-muted'}`}>
                    {post.published ? 'Published' : 'Draft'}
                  </span>
                </div>
                <p className="text-xs text-spal-muted">/spal/chronicle/{post.slug}</p>
                <p className="text-xs text-spal-muted mt-0.5">
                  {post.author} · {fmtDate(post.created_at)}
                  {post.published_at && ` · published ${fmtDate(post.published_at)}`}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button onClick={() => handleTogglePublish(post)} className="text-xs text-spal-cerulean hover:text-spal-cerulean-light transition-colors">
                  {post.published ? 'Unpublish' : 'Publish'}
                </button>
                <button onClick={() => openEdit(post)} className="text-xs text-spal-muted hover:text-spal-text transition-colors">
                  Edit
                </button>
                <button onClick={() => setPendingDelete(post)} className="text-xs text-red-400 hover:text-red-300 transition-colors">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={pendingDelete != null}
        title="Delete post?"
        message={pendingDelete ? `"${pendingDelete.title}" and all its comments will be permanently deleted.` : ''}
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
