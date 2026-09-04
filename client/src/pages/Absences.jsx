import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import { frDate } from '../lib/format.js';

const TYPES = [
  { v: 'conges', l: 'Congés payés' },
  { v: 'formation', l: 'Formation' },
  { v: 'maladie', l: 'Maladie' },
  { v: 'absence', l: 'Absence' },
  { v: 'indisponibilite', l: 'Indisponibilité' },
  { v: 'autre', l: 'Autre' },
];

export default function Absences() {
  const [rows, setRows] = useState([]);
  const [emps, setEmps] = useState([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ employee_id: '', type: 'conges', start_date: '', end_date: '', note: '' });

  const load = () => {
    api.absences().then(setRows);
    api.employees().then((e) => { setEmps(e); if (e[0]) setForm((f) => ({ ...f, employee_id: f.employee_id || e[0].id })); });
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    await api.createAbsence({ ...form, employee_id: Number(form.employee_id) });
    setAdding(false);
    setForm({ employee_id: emps[0]?.id || '', type: 'conges', start_date: '', end_date: '', note: '' });
    load();
  };
  const del = async (id) => { if (confirm('Supprimer cette absence ?')) { await api.deleteAbsence(id); load(); } };

  const typeLabel = (t) => TYPES.find((x) => x.v === t)?.l || t;

  return (
    <div>
      <div className="section-title">
        <h1>Absences & congés</h1>
        <button className="btn btn--primary" onClick={() => setAdding(true)}>+ Ajouter une absence</button>
      </div>
      <p className="muted">
        Le générateur ne planifiera jamais un salarié pendant une période d'absence.
      </p>

      {rows.length === 0 ? (
        <div className="card empty">Aucune absence enregistrée.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data">
            <thead>
              <tr><th>Salarié</th><th>Type</th><th>Du</th><th>Au</th><th>Note</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <span className="emp-dot" style={{ background: a.employee_color, marginRight: 6 }} />
                    {a.employee_name}
                  </td>
                  <td><span className="badge">{typeLabel(a.type)}</span></td>
                  <td>{frDate(a.start_date)}</td>
                  <td>{frDate(a.end_date)}</td>
                  <td className="muted">{a.note}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn--sm btn--danger" onClick={() => del(a.id)}>Suppr.</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <Modal
          title="Nouvelle absence"
          onClose={() => setAdding(false)}
          footer={
            <>
              <button className="btn" onClick={() => setAdding(false)}>Annuler</button>
              <button className="btn btn--primary" onClick={save} disabled={!form.employee_id || !form.start_date || !form.end_date}>Enregistrer</button>
            </>
          }
        >
          <div className="field">
            <label>Salarié</label>
            <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Type</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </div>
          <div className="form-row">
            <div className="field"><label>Du</label><input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
            <div className="field"><label>Au</label><input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
          </div>
          <div className="field"><label>Note</label><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
        </Modal>
      )}
    </div>
  );
}
