import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

interface Props {
  adminOnly?: boolean
}

export default function ProtectedRoute({ adminOnly = false }: Props) {
  const { user, isAdmin, loading } = useAuth()
  const location = useLocation()

  console.log(`[Route] ProtectedRoute render — path="${location.pathname}" loading=${loading} user=${user?.email ?? 'null'} adminOnly=${adminOnly} isAdmin=${isAdmin}`)

  // Hold until auth state is resolved — avoids a flash redirect to /login
  // for users who have a valid session. Show a spinner rather than null so
  // the user sees feedback instead of a blank screen.
  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <div className="w-6 h-6 rounded-full border-2 border-spal-cerulean border-t-transparent animate-spin" />
    </div>
  )

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (adminOnly && !isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}
