import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Alerts from '../components/Alerts.jsx';
import { fmtDuration, frLongDate } from '../lib/format.js';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.dashboard().then(setData).catch(() => setData({ schedule: null })).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Chargement du tableau de bord…</div>;

  if (!data || !data.schedule) {
    return (
      <div>
        <h1>Tableau de bord</h1>
        <div className="card empty">
          <p>Aucun planning enregistré pour le moment.</p>
          <Link to="/generer" className="btn btn--primary">⚙️ Générer le premier planning</Link>
        </div>
      </div>
    );
  }

  const { schedule, analysis } = data;
  const statusBadge = {
    validated: <span className="badge badge--success">Validé</span>,
    draft: <span className="badge badge--warn">Brouillon</span>,
    archived: <span className="badge">Archivé</span>,
  }[schedule.status];

  return (
    <div>
      <div className="section-title">
        <h1>Tableau de bord</h1>
        <Link to="/generer" className="btn btn--primary">⚙️ Nouveau planning</Link>
      </div>

      <div className="card">
        <div className="card__head">
          <div>
            <h2 style={{ marginBottom: 4 }}>Planning actuel {statusBadge}</h2>
            <div className="muted">
              du {frLongDate(schedule.start_date)} au {frLongDate(schedule.end_date)}
            </div>
          </div>
          <div className="row">
            {schedule.score != null && (
              <span className="score-badge" style={{ color: 'var(--primary)' }}>{schedule.score}/100</span>
            )}
            <Link to={`/planning/${schedule.id}`} className="btn">Ouvrir le planning →</Link>
          </div>
        </div>
        <Alerts alerts={analysis.alerts} ok={analysis.ok} />
      </div>

      <h2>Statistiques du planning en cours</h2>
      <div className="grid cols-4">
        {analysis.perEmployee.map((pe) => (
          <div className="stat-tile emp-card" key={pe.employee_id}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{pe.name}</strong>
              {pe.conform ? (
                <span className="badge badge--success">✓</span>
              ) : (
                <span className="badge badge--warn">⚠</span>
              )}
            </div>
            <div className="emp-stats-row">
              <span className="k">Heures / sem.</span>
              <span className="v">{fmtDuration(pe.weekly_avg)} / {fmtDuration(pe.contract_minutes)}</span>
            </div>
            <div className="emp-stats-row"><span className="k">Samedis</span><span className="v">{pe.saturdays}</span></div>
            <div className="emp-stats-row"><span className="k">Dimanches</span><span className="v">{pe.sundays}</span></div>
            <div className="emp-stats-row"><span className="k">Ouvertures</span><span className="v">{pe.openings}</span></div>
            <div className="emp-stats-row"><span className="k">Fermetures</span><span className="v">{pe.closings}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}
