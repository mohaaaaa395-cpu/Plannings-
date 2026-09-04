import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { frDate } from '../lib/format.js';

export default function History() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    api.schedules().then(setRows).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const statusBadge = (s) => ({
    validated: <span className="badge badge--success">Validé</span>,
    draft: <span className="badge badge--warn">Brouillon</span>,
    archived: <span className="badge">Archivé</span>,
  }[s]);

  const duplicate = async (id) => {
    const c = await api.duplicate(id);
    navigate(`/planning/${c.id}`);
  };
  const archive = async (id) => { await api.archive(id); load(); };
  const remove = async (id) => {
    if (!confirm('Supprimer définitivement ce planning ?')) return;
    await api.deleteSchedule(id);
    load();
  };

  if (loading) return <div className="loading">Chargement…</div>;

  return (
    <div>
      <div className="section-title">
        <h1>Historique des plannings</h1>
        <Link to="/generer" className="btn btn--primary">⚙️ Nouveau planning</Link>
      </div>

      {rows.length === 0 ? (
        <div className="card empty">Aucun planning enregistré.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th>Période</th>
                <th>Nom</th>
                <th>Statut</th>
                <th>Score</th>
                <th>Modifs</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td><strong>{frDate(s.start_date)}</strong> → {frDate(s.end_date)}</td>
                  <td>{s.label} {s.version > 1 && <span className="muted">v{s.version}</span>}</td>
                  <td>{statusBadge(s.status)}</td>
                  <td>{s.score != null ? `${s.score}/100` : '—'}</td>
                  <td>{s.manual_changes_count > 0 ? `✍️ ${s.manual_changes_count}` : '—'}</td>
                  <td>
                    <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                      <Link className="btn btn--sm" to={`/planning/${s.id}`}>Consulter</Link>
                      <button className="btn btn--sm" onClick={() => duplicate(s.id)}>Dupliquer</button>
                      {s.status !== 'archived' && (
                        <button className="btn btn--sm" onClick={() => archive(s.id)}>Archiver</button>
                      )}
                      <button className="btn btn--sm btn--danger" onClick={() => remove(s.id)}>Suppr.</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
