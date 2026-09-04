import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtDuration } from '../lib/format.js';

const PERIOD_LABELS = {
  '7w': '7 semaines',
  '12w': '12 semaines',
  '3m': '3 mois',
  '6m': '6 mois',
  all: 'Depuis le début',
};

export default function Statistics() {
  const [period, setPeriod] = useState('12w');
  const [data, setData] = useState(null);

  useEffect(() => { api.stats(period).then(setData); }, [period]);

  if (!data) return <div className="loading">Chargement…</div>;

  const max = (field) => Math.max(1, ...data.employees.map((e) => e[field] || 0));
  const Bar = ({ value, field, color }) => (
    <div className="progress" style={{ marginTop: 4 }}>
      <span style={{ width: `${((value || 0) / max(field)) * 100}%`, background: color }} />
    </div>
  );

  return (
    <div>
      <div className="section-title">
        <h1>Statistiques & équité</h1>
        <div className="tabs" style={{ borderBottom: 0 }}>
          {Object.keys(PERIOD_LABELS).map((p) => (
            <div key={p} className={`tab ${period === p ? 'active' : ''}`} onClick={() => setPeriod(p)}>
              {PERIOD_LABELS[p]}
            </div>
          ))}
        </div>
      </div>
      <p className="muted">
        Statistiques cumulées sur les plannings validés. L'équité est pondérée par les possibilités
        réelles de chaque salarié (contrat, disponibilités, contraintes) — Noussia travaillant
        uniquement le week-end n'est donc pas considérée comme désavantagée.
      </p>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="data">
          <thead>
            <tr>
              <th>Salarié</th>
              <th>Samedis</th>
              <th>Dimanches</th>
              <th>Week-ends</th>
              <th>Ouvertures</th>
              <th>Fermetures</th>
              <th>Heures</th>
              <th>Jours</th>
              <th>Journées longues</th>
            </tr>
          </thead>
          <tbody>
            {data.employees.map((e) => (
              <tr key={e.id}>
                <td>
                  <span className="emp-dot" style={{ background: e.color, marginRight: 6 }} />
                  <strong>{e.name}</strong>
                  {e.weekend_only && <span className="badge badge--primary" style={{ marginLeft: 6 }}>WE</span>}
                </td>
                <td>{e.saturdays}</td>
                <td>{e.sundays}</td>
                <td>{e.weekends}</td>
                <td>{e.openings}</td>
                <td>{e.closings}</td>
                <td>{fmtDuration(e.worked_minutes)}</td>
                <td>{e.worked_days}</td>
                <td>{e.long_days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid cols-2">
        {[
          ['Samedis travaillés', 'saturdays'],
          ['Dimanches travaillés', 'sundays'],
          ['Ouvertures', 'openings'],
          ['Fermetures', 'closings'],
        ].map(([title, key]) => (
          <div className="card" key={key}>
            <h3>{title}</h3>
            {data.employees.map((e) => (
              <div key={e.id} style={{ marginBottom: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{e.name}</span>
                  <strong>{e[key]}</strong>
                </div>
                <Bar value={e[key]} field={key} color={e.color} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
