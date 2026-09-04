import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import { frDate } from '../lib/format.js';

const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

const EMPTY = {
  employee_id: '',
  mode: 'date', // 'date' | 'weekday'
  date: '',
  weekday: 3,
  all_day: true,
  start_time: '',
  end_time: '',
  reason: '',
};

export default function Unavailabilities() {
  const [rows, setRows] = useState([]);
  const [emps, setEmps] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    api.unavailabilities().then(setRows);
    api.employees().then(setEmps);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setError('');
    setEditing({ ...EMPTY, employee_id: emps[0]?.id || '' });
  };
  const openEdit = (u) => {
    setError('');
    setEditing({
      id: u.id,
      employee_id: u.employee_id,
      mode: u.date ? 'date' : 'weekday',
      date: u.date ? String(u.date).slice(0, 10) : '',
      weekday: u.weekday || 3,
      all_day: u.all_day,
      start_time: u.start_time || '',
      end_time: u.end_time || '',
      reason: u.reason || '',
    });
  };

  const save = async () => {
    setError('');
    const e = editing;
    const payload = {
      employee_id: Number(e.employee_id),
      date: e.mode === 'date' ? e.date : null,
      weekday: e.mode === 'weekday' ? Number(e.weekday) : null,
      all_day: e.all_day,
      start_time: e.all_day ? null : e.start_time,
      end_time: e.all_day ? null : e.end_time,
      reason: e.reason,
    };
    try {
      if (e.id) await api.updateUnavailability(e.id, payload);
      else await api.createUnavailability(payload);
      setEditing(null);
      load();
    } catch (err) { setError(err.message); }
  };

  const del = async (id) => {
    if (!confirm('Supprimer cette indisponibilité ?')) return;
    await api.deleteUnavailability(id);
    load();
  };

  const empName = (u) => u.employee_name;
  const scope = (u) => (u.date ? frDate(u.date) : `Tous les ${DAY_NAMES[u.weekday - 1]?.toLowerCase()}`);
  const range = (u) => (u.all_day ? 'Toute la journée' : `${u.start_time} → ${u.end_time}`);

  return (
    <div>
      <div className="section-title">
        <h1>Indisponibilités</h1>
        <button className="btn btn--primary" onClick={openNew}>+ Ajouter une indisponibilité</button>
      </div>
      <p className="muted">
        Contrainte <strong>dure</strong> : le moteur ne planifiera jamais un salarié pendant son
        indisponibilité (jour entier ou plage horaire), et réorganisera automatiquement les autres
        pour maintenir la couverture du magasin.
      </p>

      {rows.length === 0 ? (
        <div className="card empty">Aucune indisponibilité enregistrée.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data">
            <thead>
              <tr><th>Salarié</th><th>Quand</th><th>Créneau</th><th>Motif</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="emp-dot" style={{ background: u.employee_color, marginRight: 6 }} />
                    {empName(u)}
                  </td>
                  <td>{scope(u)}</td>
                  <td>
                    {u.all_day
                      ? <span className="badge badge--danger">Toute la journée</span>
                      : <span className="badge badge--warn">{range(u)}</span>}
                  </td>
                  <td className="muted">{u.reason}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn btn--sm" onClick={() => openEdit(u)}>Modifier</button>
                      <button className="btn btn--sm btn--danger" onClick={() => del(u.id)}>Suppr.</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id ? 'Modifier l\'indisponibilité' : 'Nouvelle indisponibilité'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>Annuler</button>
              <button className="btn btn--primary" onClick={save}>Enregistrer</button>
            </>
          }
        >
          {error && <div className="alert alert--error">{error}</div>}
          <div className="field">
            <label>Salarié</label>
            <select value={editing.employee_id} onChange={(e) => setEditing({ ...editing, employee_id: e.target.value })}>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>

          <div className="field">
            <label>Type</label>
            <div className="btn-row">
              <button type="button" className={`btn btn--sm ${editing.mode === 'date' ? 'btn--primary' : ''}`}
                onClick={() => setEditing({ ...editing, mode: 'date' })}>Date précise</button>
              <button type="button" className={`btn btn--sm ${editing.mode === 'weekday' ? 'btn--primary' : ''}`}
                onClick={() => setEditing({ ...editing, mode: 'weekday' })}>Récurrent (jour de semaine)</button>
            </div>
          </div>

          {editing.mode === 'date' ? (
            <div className="field">
              <label>Date</label>
              <input type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
            </div>
          ) : (
            <div className="field">
              <label>Jour de la semaine</label>
              <select value={editing.weekday} onChange={(e) => setEditing({ ...editing, weekday: Number(e.target.value) })}>
                {DAY_NAMES.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
              </select>
            </div>
          )}

          <div className="checkbox field">
            <input id="allday" type="checkbox" checked={editing.all_day}
              onChange={(e) => setEditing({ ...editing, all_day: e.target.checked })} />
            <label htmlFor="allday">Toute la journée</label>
          </div>

          {!editing.all_day && (
            <div className="form-row">
              <div className="field">
                <label>Indisponible de</label>
                <input value={editing.start_time} placeholder="09:50"
                  onChange={(e) => setEditing({ ...editing, start_time: e.target.value })} />
              </div>
              <div className="field">
                <label>à</label>
                <input value={editing.end_time} placeholder="14:00"
                  onChange={(e) => setEditing({ ...editing, end_time: e.target.value })} />
              </div>
            </div>
          )}

          <div className="field">
            <label>Motif (optionnel)</label>
            <input value={editing.reason} onChange={(e) => setEditing({ ...editing, reason: e.target.value })} />
          </div>
        </Modal>
      )}
    </div>
  );
}
