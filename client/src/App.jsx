import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';

const NAV = [
  { to: '/', label: 'Tableau de bord', icon: '📊', end: true },
  { to: '/generer', label: 'Générer un planning', icon: '⚙️' },
  { to: '/historique', label: 'Historique', icon: '🗂️' },
  { to: '/equipe', label: 'Équipe', icon: '👥' },
  { to: '/absences', label: 'Absences & congés', icon: '🌴' },
  { to: '/indisponibilites', label: 'Indisponibilités', icon: '🚫' },
  { to: '/statistiques', label: 'Statistiques', icon: '📈' },
  { to: '/parametres', label: 'Paramètres', icon: '🔧' },
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
          <div className="muted" style={{ marginBottom: 8, color: '#94a3b8' }}>
            Connecté : <strong style={{ color: '#e2e8f0' }}>{user?.username}</strong>
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
