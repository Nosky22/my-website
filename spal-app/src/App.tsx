import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import AdminPage from './pages/AdminPage'
import DashboardPage from './pages/DashboardPage'
import DraftPage from './pages/DraftPage'
import HistoryPage from './pages/HistoryPage'
import HomePage from './pages/HomePage'
import LawsPage from './pages/LawsPage'
import LoginPage from './pages/LoginPage'
import PlayersPage from './pages/PlayersPage'
import SquadPage from './pages/SquadPage'
import StandingsPage from './pages/StandingsPage'

export default function App() {
  return (
    // basename strips /spal from every route so paths are defined without it
    <BrowserRouter basename="/spal">
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="standings" element={<StandingsPage />} />
          <Route path="players" element={<PlayersPage />} />
          <Route path="laws" element={<LawsPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="login" element={<LoginPage />} />
          {/* Auth-required routes — guards added in Phase 1 */}
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="draft" element={<DraftPage />} />
          <Route path="squad" element={<SquadPage />} />
          <Route path="admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
