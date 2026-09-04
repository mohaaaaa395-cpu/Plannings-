import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import { fmtDuration } from '../lib/format.js';

const WEEKDAYS = [
  { v: 1, l: 'Lundi' }, { v: 2, l: 'Mardi' }, { v: 3, l: 'Mercredi' },
  { v: 4, l: 'Jeudi' }, { v: 5, l: 'Vendredi' }, { v: 6, l: 'Samedi' }, { v: 7, l: 'Dimanche' },
];
const KINDS = [
  { v: 'unavailable', l: 'Indisponible' },
  { v: 'preferred', l: 'Préféré' },
  { v: 'avoid', l: 'À éviter' },
];

function EmployeeForm({ emp, onClose, onSaved }) {
  const isNew = !emp.id;
  const [f, setF] = useState({
    name: emp.name || '',
    position: emp.position || 'Employé(e)',
    weekly_hours: emp.contract_minutes ? emp.contract_minutes / 60 : 35,
    has_keys: emp.has_keys ?? true,
    is_order_manager: emp.is_order_manager ?? false,
    weekend_only: emp.weekend_only ?? false,
    color: emp.color || '#2563eb',
    active: emp.active ?? true,
    preferences: emp.preferences || {},
  });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const setPref = (k, v) => setF((p) => ({ ...p, preferences: { ...p.preferences, [k]: v } }));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      if (isNew) await api.createEmployee(f);
      else await api.updateEmployee(emp.id, f);
      onSaved();
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <Modal
      title={isNew ? 'Nouveau salarié' : `Modifier ${emp.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn--primary" onClick={save} disabled={busy || !f.name}>Enregistrer</button>
        </>
      }
    >
      <div className="form-row">
        <div className="field"><label>Nom</label><input value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div className="field"><label>Poste</label><input value={f.position} onChange={(e) => set('position', e.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="field">
          <label>Contrat (heures / semaine)</label>
          <input type="number" step="0.5" value={f.weekly_hours} onChange={(e) => set('weekly_hours', Number(e.target.value))} />
        </div>
        <div className="field"><label>Couleur</label><input type="color" value={f.color} onChange={(e) => set('color', e.target.value)} /></div>
      </div>
      <div className="checkbox field"><input type="checkbox" id="keys" checked={f.has_keys} onChange={(e) => set('has_keys', e.target.checked)} /><label htmlFor="keys">Possède les clés (peut ouvrir / fermer)</label></div>
      <div className="checkbox field"><input type="checkbox" id="mgr" checked={f.is_order_manager} onChange={(e) => set('is_order_manager', e.target.checked)} /><label htmlFor="mgr">Responsable des commandes</label></div>
      <div className="checkbox field"><input type="checkbox" id="we" checked={f.weekend_only} onChange={(e) => set('weekend_only', e.target.checked)} /><label htmlFor="we">Travaille uniquement le week-end (samedi & dimanche)</label></div>
      <div className="checkbox field"><input type="checkbox" id="act" checked={f.active} onChange={(e) => set('active', e.target.checked)} /><label htmlFor="act">Actif</label></div>
      <h4>Préférences (souples, peuvent être ignorées)</h4>
      <div className="checkbox field"><input type="checkbox" id="pw" checked={!!f.preferences.prefWeekend} onChange={(e) => setPref('prefWeekend', e.target.checked)} /><label htmlFor="pw">Préfère le week-end</label></div>
      <div className="checkbox field"><input type="checkbox" id="po" checked={!!f.preferences.prefOpening} onChange={(e) => setPref('prefOpening', e.target.checked)} /><label htmlFor="po">Préfère les ouvertures</label></div>
      <div className="checkbox field"><input type="checkbox" id="pc" checked={!!f.preferences.prefClosing} onChange={(e) => setPref('prefClosing', e.target.checked)} /><label htmlFor="pc">Préfère les fermetures</label></div>
    </Modal>
  );
}

function AvailabilityPanel({ emp, onClose }) {
  const [rules, setRules] = useState([]);
  const [form, setForm] = useState({ weekday: 1, kind: 'unavailable', is_hard: true, note: '' });
  const load = () => api.availability(emp.id).then(setRules);
  useEffect(() => { load(); }, []);

  const add = async () => {
    await api.addAvailability(emp.id, form);
    setForm({ weekday: 1, kind: 'unavailable', is_hard: true, note: '' });
    load();
  };
  const del = async (rid) => { await api.delAvailability(emp.id, rid); load(); };

  return (
    <Modal title={`Disponibilités — ${emp.name}`} onClose={onClose}>
      <p className="muted" style={{ fontSize: '.85rem' }}>
        Une <strong>contrainte obligatoire</strong> (indisponible + obligatoire) ne sera jamais violée.
        Une <strong>préférence</strong> peut être ignorée si nécessaire.
      </p>
      {rules.length === 0 && <p className="muted">Aucune règle. {emp.name} est disponible selon les horaires du magasin.</p>}
      {rules.map((r) => (
        <div key={r.id} className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
          <span>
            {WEEKDAYS.find((w) => w.v === r.weekday)?.l || 'Tous les jours'} ·{' '}
            {KINDS.find((k) => k.v === r.kind)?.l}{' '}
            <span className={`badge ${r.is_hard ? 'badge--danger' : 'badge--warn'}`}>
              {r.is_hard ? 'Obligatoire' : 'Préférence'}
            </span>
            {r.note && <span className="muted"> — {r.note}</span>}
          </span>
          <button className="btn btn--sm btn--danger" onClick={() => del(r.id)}>Suppr.</button>
        </div>
      ))}
      <h4 style={{ marginTop: 16 }}>Ajouter une règle</h4>
      <div className="form-row">
        <div className="field">
          <label>Jour</label>
          <select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((w) => <option key={w.v} value={w.v}>{w.l}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Type</label>
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
          </select>
        </div>
      </div>
      <div className="checkbox field">
        <input type="checkbox" id="hard" checked={form.is_hard} onChange={(e) => setForm({ ...form, is_hard: e.target.checked })} />
        <label htmlFor="hard">Contrainte obligatoire</label>
      </div>
      <div className="field"><label>Note</label><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
      <button className="btn btn--primary" onClick={add}>Ajouter</button>
    </Modal>
  );
}

export default function Team() {
  const [emps, setEmps] = useState([]);
  const [editing, setEditing] = useState(null);
  const [availFor, setAvailFor] = useState(null);
  const load = () => api.employees().then(setEmps);
  useEffect(() => { load(); }, []);

  const del = async (id) => {
    if (!confirm('Désactiver ce salarié ? (l\'historique est conservé)')) return;
    await api.deleteEmployee(id);
    load();
  };

  return (
    <div>
      <div className="section-title">
        <h1>Équipe</h1>
        <button className="btn btn--primary" onClick={() => setEditing({})}>+ Ajouter un salarié</button>
      </div>

      <div className="grid cols-2">
        {emps.map((e) => (
          <div className="card" key={e.id} style={{ borderTop: `4px solid ${e.color}` }}>
            <div className="card__head">
              <h3 style={{ margin: 0 }}>
                <span className="emp-dot" style={{ background: e.color, marginRight: 8 }} />
                {e.name}
              </h3>
              <span className="badge badge--primary">{fmtDuration(e.contract_minutes)}/sem</span>
            </div>
            <div className="muted" style={{ marginBottom: 10 }}>{e.position}</div>
            <div className="row" style={{ gap: 6, marginBottom: 12 }}>
              {e.has_keys && <span className="badge">🔑 Clés</span>}
              {e.is_order_manager && <span className="badge badge--warn">📦 Commandes</span>}
              {e.weekend_only && <span className="badge badge--primary">Week-end uniquement</span>}
            </div>
            <div className="btn-row">
              <button className="btn btn--sm" onClick={() => setEditing(e)}>Modifier</button>
              <button className="btn btn--sm" onClick={() => setAvailFor(e)}>Disponibilités</button>
              <button className="btn btn--sm btn--danger" onClick={() => del(e.id)}>Désactiver</button>
            </div>
          </div>
        ))}
      </div>

      {editing && <EmployeeForm emp={editing} onClose={() => setEditing(null)} onSaved={load} />}
      {availFor && <AvailabilityPanel emp={availFor} onClose={() => setAvailFor(null)} />}
    </div>
  );
}
