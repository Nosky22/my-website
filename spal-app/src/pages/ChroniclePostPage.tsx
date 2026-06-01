import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { marked } from 'marked'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { EmptyState } from '../components/EmptyState'

interface Post {
  id: number
  title: string
  body: string
  published_at: string | null
  author: string
}

interface Comment {
  id: number
  post_id: number
  parent_id: number | null
  author_id: string
  author_name: string
  body: string
  created_at: string
}

export default function ChroniclePostPage() {
  const { slug } = useParams<{ slug: string }>()
  const { user, profile } = useAuth()

  const [post, setPost]         = useState<Post | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Comment form state
  const [commentBody, setCommentBody]       = useState('')
  const [replyingTo, setReplyingTo]         = useState<number | null>(null)
  const [replyBody, setReplyBody]           = useState('')
  const [submitting, setSubmitting]         = useState(false)
  const [submitError, setSubmitError]       = useState<string | null>(null)
  const [pendingDelete, setPendingDelete]   = useState<number | null>(null)

  async function loadPost(s: string) {
    const { data: postData } = await supabase
      .from('chronicle_posts')
      .select('id, title, body, published_at, profiles!author_id(display_name)')
      .eq('slug', s)
      .eq('published', true)
      .maybeSingle()

    if (!postData) { setNotFound(true); setLoading(false); return }

    type RawPost = typeof postData & { profiles: { display_name: string } | null }
    const raw = postData as unknown as RawPost
    setPost({
      id: raw.id,
      title: raw.title,
      body: raw.body,
      published_at: raw.published_at,
      author: raw.profiles?.display_name ?? 'Admin',
    })
    await loadComments(raw.id)
    setLoading(false)
  }

  async function loadComments(postId: number) {
    const { data } = await supabase
      .from('chronicle_comments')
      .select('id, post_id, parent_id, author_id, body, created_at, profiles!author_id(display_name)')
      .eq('post_id', postId)
      .order('created_at')

    type RawComment = { id: number; post_id: number; parent_id: number | null; author_id: string; body: string; created_at: string; profiles: { display_name: string } | null }
    setComments(
      ((data ?? []) as unknown as RawComment[]).map(c => ({
        id:          c.id,
        post_id:     c.post_id,
        parent_id:   c.parent_id,
        author_id:   c.author_id,
        author_name: c.profiles?.display_name ?? 'Unknown',
        body:        c.body,
        created_at:  c.created_at,
      }))
    )
  }

  useEffect(() => {
    if (!slug) return
    loadPost(slug)
  }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  // Parse markdown once
  const bodyHtml = useMemo(() => {
    if (!post) return ''
    return marked.parse(post.body, { async: false }) as string
  }, [post])

  async function handleAddComment(e: React.FormEvent, parentId: number | null) {
    e.preventDefault()
    if (!user || !post) return
    const body = parentId == null ? commentBody.trim() : replyBody.trim()
    if (!body) return
    setSubmitting(true); setSubmitError(null)

    const { error } = await supabase.from('chronicle_comments').insert({
      post_id:   post.id,
      parent_id: parentId ?? null,
      author_id: user.id,
      body,
    })

    setSubmitting(false)
    if (error) { setSubmitError(error.message); return }
    if (parentId == null) { setCommentBody('') } else { setReplyBody(''); setReplyingTo(null) }
    await loadComments(post.id)
  }

  async function handleDelete(commentId: number) {
    const { error } = await supabase.from('chronicle_comments').delete().eq('id', commentId)
    setPendingDelete(null)
    if (error) return
    setComments(prev => prev.filter(c => c.id !== commentId && c.parent_id !== commentId))
  }

  // Thread structure: top-level comments with their replies
  const topLevel = comments.filter(c => c.parent_id == null)
  const repliesFor = (id: number) => comments.filter(c => c.parent_id === id)

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  if (loading) return <p className="text-spal-muted text-sm">Loading…</p>

  if (notFound) {
    return (
      <EmptyState
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" />
          </svg>
        }
        title="Post not found"
        body="This post doesn't exist or hasn't been published yet."
      />
    )
  }

  return (
    <div className="max-w-2xl space-y-10">
      {/* Back link */}
      <Link to="/chronicle" className="text-xs text-spal-muted hover:text-spal-text transition-colors">
        ← Chronicle
      </Link>

      {/* Post */}
      {post && (
        <article>
          <h1 className="text-2xl font-bold text-spal-yellow mb-2">{post.title}</h1>
          <div className="flex items-center gap-3 text-xs text-spal-muted mb-8">
            <span>{post.author}</span>
            {post.published_at && (
              <>
                <span>·</span>
                <time dateTime={post.published_at}>{fmtDate(post.published_at)}</time>
              </>
            )}
          </div>
          {/* Rendered markdown */}
          <div
            className="prose-spal"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        </article>
      )}

      {/* Comments */}
      <section>
        <h2 className="text-xs font-semibold text-spal-muted uppercase tracking-wider mb-5">
          Comments ({topLevel.length + comments.filter(c => c.parent_id != null).length})
        </h2>

        {topLevel.length === 0 && (
          <p className="text-spal-muted text-sm mb-6">No comments yet.</p>
        )}

        <div className="space-y-6">
          {topLevel.map(comment => (
            <div key={comment.id}>
              <CommentRow
                comment={comment}
                user={user}
                onReply={() => { setReplyingTo(comment.id); setReplyBody('') }}
                onDelete={() => setPendingDelete(comment.id)}
              />

              {/* Reply form */}
              {replyingTo === comment.id && user && (
                <form
                  onSubmit={e => handleAddComment(e, comment.id)}
                  className="ml-8 mt-3 space-y-2"
                >
                  <textarea
                    value={replyBody}
                    onChange={e => setReplyBody(e.target.value)}
                    placeholder={`Reply as ${profile?.display_name ?? 'you'}…`}
                    rows={3}
                    required
                    className={textareaClass}
                  />
                  <div className="flex items-center gap-3">
                    <button type="submit" disabled={submitting || !replyBody.trim()} className={submitClass}>
                      {submitting ? 'Posting…' : 'Post reply'}
                    </button>
                    <button type="button" onClick={() => setReplyingTo(null)} className="text-sm text-spal-muted hover:text-spal-text transition-colors">
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {/* Replies */}
              {repliesFor(comment.id).map(reply => (
                <div key={reply.id} className="ml-8 mt-3 border-l-2 border-white/5 pl-4">
                  <CommentRow
                    comment={reply}
                    user={user}
                    onDelete={() => setPendingDelete(reply.id)}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Add comment */}
        {user ? (
          <form onSubmit={e => handleAddComment(e, null)} className="mt-8 space-y-3">
            <h3 className="text-sm font-medium text-spal-text">
              Add a comment as {profile?.display_name ?? 'you'}
            </h3>
            <textarea
              value={commentBody}
              onChange={e => setCommentBody(e.target.value)}
              placeholder="Write a comment…"
              rows={4}
              required
              className={textareaClass}
            />
            {submitError && <p className="text-spal-error text-xs">{submitError}</p>}
            <button type="submit" disabled={submitting || !commentBody.trim()} className={submitClass}>
              {submitting ? 'Posting…' : 'Post comment'}
            </button>
          </form>
        ) : (
          <p className="text-spal-muted text-sm mt-8">
            <Link to="/login" className="text-spal-cerulean hover:underline">Sign in</Link> to leave a comment.
          </p>
        )}

        {/* Delete confirmation */}
        {pendingDelete != null && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-spal-surface border border-white/10 rounded-lg p-6 max-w-sm w-full">
              <p className="text-spal-text font-medium mb-2">Delete this comment?</p>
              <p className="text-sm text-spal-muted mb-5">
                Any replies to this comment will also be removed.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleDelete(pendingDelete)}
                  className="bg-red-600 text-white text-sm rounded px-4 py-1.5 hover:bg-red-500 transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={() => setPendingDelete(null)}
                  className="text-sm text-spal-muted hover:text-spal-text transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function CommentRow({
  comment, user, onReply, onDelete,
}: {
  comment: Comment
  user: { id: string } | null
  onReply?: () => void
  onDelete: () => void
}) {
  const isOwn  = user?.id === comment.author_id
  // isAdmin check: handled by the admin policy; for the UI we rely on the user's profile
  // from useAuth — but CommentRow doesn't have access to isAdmin. We pass delete always
  // and let the server RLS reject unauthorised deletes.
  const canDel = !!user && isOwn

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-sm font-medium ${isOwn ? 'text-spal-cerulean' : 'text-spal-text'}`}>
          {comment.author_name}
        </span>
        <span className="text-xs text-spal-muted">
          {new Date(comment.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </div>
      <p className="text-sm text-spal-text whitespace-pre-wrap">{comment.body}</p>
      <div className="flex items-center gap-4 mt-1">
        {onReply && user && (
          <button onClick={onReply} className="text-xs text-spal-muted hover:text-spal-text transition-colors">
            Reply
          </button>
        )}
        {canDel && (
          <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-300 transition-colors">
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

const textareaClass = 'w-full bg-spal-bg border border-white/10 rounded px-3 py-2 text-spal-text text-sm focus:outline-none focus:border-spal-cerulean resize-none'
const submitClass   = 'bg-spal-cerulean text-white text-sm rounded px-4 py-1.5 hover:bg-spal-cerulean-light disabled:opacity-50 transition-colors'
