import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './lib/api.js';
import AppShell from './components/AppShell.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ComposePage from './pages/ComposePage.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import LibraryPage from './pages/LibraryPage.jsx';
import ProductsPage from './pages/ProductsPage.jsx';
import AccountsPage from './pages/AccountsPage.jsx';
import AdsPage from './pages/AdsPage.jsx';
import AnalyticsPage from './pages/AnalyticsPage.jsx';
import ActivityPage from './pages/ActivityPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import { PrivacyPage, TermsPage, DataDeletionPage } from './pages/PublicPages.jsx';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function ProtectedLayout() {
  const { user, loading, setUser } = useAuth();
  const location = useLocation();
  if (loading) return <div className="full-loader"><div className="spinner" /><p>관리자 세션을 확인하고 있습니다.</p></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <AppShell user={user} onLogout={() => setUser(null)} />;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/api/auth/me')
      .then((payload) => setUser(payload.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const auth = useMemo(() => ({ user, setUser, loading }), [user, loading]);
  return (
    <AuthContext.Provider value={auth}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/data-deletion" element={<DataDeletionPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/compose" element={<ComposePage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/ads" element={<AdsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}
