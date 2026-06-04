import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { EmptyState } from '../components/EmptyState'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorCard from '../components/ErrorCard'

interface Post {
  id: number
  slug: string
  title: string
  body: string
  published_at: string | null
  author: string
}

export default function ChroniclePage() {
  const [posts, setPosts]     = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    setError(false)
    supabase
      .from('chronicle_posts')
      .select('id, slug, title, body, published_at, profiles!author_id(display_name)')
      .eq('published', true)
      .order('published_at', { ascending: false })
      .then(({ data, error: fetchError }) => {
        if (fetchError) { setError(true); setLoading(false); return }
        type Raw = { id: number; slug: string; title: string; body: string; published_at: string | null; profiles: { display_name: string } | null }
        setPosts(
          ((data ?? []) as unknown as Raw[]).map(p => ({
            id: p.id,
            slug: p.slug,
            title: p.title,
            body: p.body,
            published_at: p.published_at,
            author: p.profiles?.display_name ?? 'Admin',
          }))
        )
        setLoading(false)
      })
  }, [retryKey])

  function excerpt(body: string): string {
    const stripped = body.replace(/[#*`>_\[\]()]/g, '').trim()
    return stripped.length > 160 ? stripped.slice(0, 160).trimEnd() + '…' : stripped
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-spal-yellow mb-1">Chronicle</h1>
      <p className="text-spal-muted text-sm mb-8">News and commentary from the league.</p>

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorCard onRetry={() => setRetryKey(k => k + 1)} />
      ) : posts.length === 0 ? (
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" />
            </svg>
          }
          title="No posts yet"
          body="Check back soon for news and commentary from the league."
        />
      ) : (
        <div className="space-y-6">
          {posts.map(post => (
            <article key={post.id} className="bg-spal-surface border border-white/5 rounded-lg p-5 hover:border-white/10 transition-colors">
              <Link to={`/chronicle/${post.slug}`} className="block group">
                <h2 className="text-lg font-semibold text-spal-text group-hover:text-spal-cerulean transition-colors mb-1">
                  {post.title}
                </h2>
                <p className="text-sm text-spal-muted mb-3">{excerpt(post.body)}</p>
                <div className="flex items-center gap-3 text-xs text-spal-muted">
                  <span>{post.author}</span>
                  {post.published_at && (
                    <>
                      <span>·</span>
                      <time dateTime={post.published_at}>
                        {new Date(post.published_at).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'long', year: 'numeric',
                        })}
                      </time>
                    </>
                  )}
                </div>
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
