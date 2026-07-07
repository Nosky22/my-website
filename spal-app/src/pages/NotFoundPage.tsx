import { useEffect } from 'react'
import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  useEffect(() => { document.title = 'Not Found — SPAL' }, [])
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] text-center px-4">
      <p className="text-6xl font-bold text-spal-cerulean mb-4">404</p>
      <h1 className="text-2xl font-bold text-spal-yellow mb-2">Page not found</h1>
      <p className="text-spal-muted text-sm mb-8 max-w-xs">
        This page doesn't exist. Maybe the URL is wrong, or it moved.
      </p>
      <Link
        to="/"
        className="bg-spal-cerulean text-white text-sm rounded px-5 py-2 hover:bg-spal-cerulean-light transition-colors"
      >
        Go to home
      </Link>
    </div>
  )
}
