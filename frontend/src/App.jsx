import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';

// Minimal line icons (stroke = currentColor), drawn to a 24 viewBox.
const S = (paths) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
);
const ICONS = {
  dashboard: S(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="11" width="7" height="10" rx="1.5" /><rect x="3" y="15" width="7" height="6" rx="1.5" /></>),
  generate: S(<><path d="M5 3v4M3 5h4M6 17v4M4 19h4" /><path d="M13 4l3 3-9 9-3 1 1-3 8-10z" /><path d="M15 7l2 2" /></>),
  history: S(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></>),
  team: S(<><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 5.5a3 3 0 0 1 0 5.5" /><path d="M18 14c2.2.7 3.8 2.6 3.8 5" /></>),
  absences: S(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></>),
  unavail: S(<><circle cx="12" cy="12" r="9" /><path d="M6 6l12 12" /></>),
  stats: S(<><path d="M4 20V4" /><path d="M4 20h16" /><rect x="7" y="12" width="3" height="5" rx="0.5" /><rect x="12" y="8" width="3" height="9" rx="0.5" /><rect x="17" y="5" width="3" height="12" rx="0.5" /></>),
  settings: S(<><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2.2" /><circle cx="8" cy="17" r="2.2" /></>),
};

const NAV = [
  { to: '/', label: 'Tableau de bord', icon: ICONS.dashboard, end: true },
  { to: '/generer', label: 'Générer un planning', icon: ICONS.generate },
  { to: '/historique', label: 'Historique', icon: ICONS.history },
  { to: '/equipe', label: 'Équipe', icon: ICONS.team },
  { to: '/absences', label: 'Absences & congés', icon: ICONS.absences },
  { to: '/indisponibilites', label: 'Indisponibilités', icon: ICONS.unavail },
  { to: '/statistiques', label: 'Statistiques', icon: ICONS.stats },
  { to: '/parametres', label: 'Paramètres', icon: ICONS.settings },
];

export default function App() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const doLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar__brand">
          <strong>CEDIF Saint-Antoine</strong>
          <span>70 rue Saint-Antoine · 75004 Paris</span>
        </div>
        <nav className="sidebar__nav">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `sidebar__link ${isActive ? 'active' : ''}`}
              onClick={() => setOpen(false)}
            >
              <span className="ico">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          <div style={{ marginBottom: 8, color: 'var(--ink-faint)' }}>
            Connecté : <strong style={{ color: 'var(--ink-text)' }}>{user?.username}</strong>
          </div>
          <button className="btn btn--sm btn--block" onClick={doLogout}>
            Déconnexion
          </button>
        </div>
      </aside>

      <div className={`overlay ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button className="burger" onClick={() => setOpen(!open)} aria-label="Menu">
            ☰
          </button>
          <strong>CEDIF Saint-Antoine</strong>
          <span style={{ width: 30 }} />
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
