import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';
import { AuthProvider, useAuth } from './auth.jsx';
import App from './App.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Generate from './pages/Generate.jsx';
import ScheduleView from './pages/ScheduleView.jsx';
import History from './pages/History.jsx';
import Absences from './pages/Absences.jsx';
import Team from './pages/Team.jsx';
import Statistics from './pages/Statistics.jsx';
import Settings from './pages/Settings.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading">Chargement…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function Root() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <Protected>
                <App />
              </Protected>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="generer" element={<Generate />} />
            <Route path="planning/:id" element={<ScheduleView />} />
            <Route path="historique" element={<History />} />
            <Route path="absences" element={<Absences />} />
            <Route path="equipe" element={<Team />} />
            <Route path="statistiques" element={<Statistics />} />
            <Route path="parametres" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
