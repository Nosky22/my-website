import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './components/Toast'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import AdminLayout from './components/admin/AdminLayout'
import AdminPage from './pages/AdminPage'
import AdminSeasonsPage from './pages/admin/AdminSeasonsPage'
import AdminPlayersPage from './pages/admin/AdminPlayersPage'
import AdminDraftPage from './pages/admin/AdminDraftPage'
import AdminCanonicalPage from './pages/admin/AdminCanonicalPage'
import AdminTeamSheetsPage from './pages/admin/AdminTeamSheetsPage'
import AdminImportsPage from './pages/admin/AdminImportsPage'
import AdminManagersPage from './pages/admin/AdminManagersPage'
import AdminPoolPage from './pages/admin/AdminPoolPage'
import AdminScoresPage from './pages/admin/AdminScoresPage'
import AdminSettingsPage from './pages/admin/AdminSettingsPage'
import DashboardPage from './pages/DashboardPage'
import DraftPage from './pages/DraftPage'
import DraftRoomPage from './pages/DraftRoomPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import HistoryPage from './pages/HistoryPage'
import SeasonReviewPage from './pages/SeasonReviewPage'
import AllTimePage from './pages/AllTimePage'
import ManagerProfilePage from './pages/ManagerProfilePage'
import HomePage from './pages/HomePage'
import LawsPage from './pages/LawsPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import PlayersPage from './pages/PlayersPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import SignUpPage from './pages/SignUpPage'
import SquadPage from './pages/SquadPage'
import TeamSheetsPage from './pages/TeamSheetsPage'
import H2HPage from './pages/H2HPage'
import StandingsPage from './pages/StandingsPage'

export default function App() {
  return (
    // basename strips /spal from every route so paths are defined without it
    <BrowserRouter basename="/spal">
      <AuthProvider>
        <ToastProvider>
        <Routes>
          <Route element={<Layout />}>

            {/* Public routes */}
            <Route index element={<HomePage />} />
            <Route path="standings" element={<StandingsPage />} />
            <Route path="h2h" element={<H2HPage />} />
            <Route path="teamsheets" element={<TeamSheetsPage />} />
            <Route path="players" element={<PlayersPage />} />
            <Route path="laws" element={<LawsPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="history/:year" element={<SeasonReviewPage />} />
            <Route path="alltime" element={<AllTimePage />} />
            <Route path="manager/:profileId" element={<ManagerProfilePage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="signup" element={<SignUpPage />} />
            <Route path="forgot-password" element={<ForgotPasswordPage />} />
            <Route path="reset-password" element={<ResetPasswordPage />} />

            {/* Auth-required routes */}
            <Route element={<ProtectedRoute />}>
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="draft-room" element={<DraftRoomPage />} />
              <Route path="draft" element={<DraftPage />} />
              <Route path="squad" element={<SquadPage />} />
            </Route>

            {/* Admin-only routes */}
            <Route element={<ProtectedRoute adminOnly />}>
              <Route path="admin/*" element={<AdminLayout />}>
                <Route index element={<AdminPage />} />
                <Route path="seasons"  element={<AdminSeasonsPage />} />
                <Route path="players"   element={<AdminPlayersPage />} />
                <Route path="canonical" element={<AdminCanonicalPage />} />
                <Route path="pool"        element={<AdminPoolPage />} />
                <Route path="teamsheets" element={<AdminTeamSheetsPage />} />
                <Route path="draft"      element={<AdminDraftPage />} />
                <Route path="scores"    element={<AdminScoresPage />} />
                <Route path="managers" element={<AdminManagersPage />} />
                <Route path="imports"  element={<AdminImportsPage />} />
                <Route path="settings" element={<AdminSettingsPage />} />
              </Route>
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<NotFoundPage />} />

          </Route>
        </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
