import { useState } from 'react';
import Modal from './Modal.jsx';
import { frDay, frDate } from '../lib/format.js';

export default function ShiftEditor({ day, shift, employees, onClose, onSave }) {
  const [isRest, setIsRest] = useState(shift.is_rest);
  const [ms, setMs] = useState(shift.morning_start || '');
  const [me, setMe] = useState(shift.morning_end || '');
  const [as, setAs] = useState(shift.afternoon_start || '');
  const [ae, setAe] = useState(shift.afternoon_end || '');
  const [isOrder, setIsOrder] = useState(shift.is_order || false);
  const [employeeId, setEmployeeId] = useState(shift.employee_id);
  const [note, setNote] = useState(shift.note || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await onSave({
        is_rest: isRest,
        morning_start: isRest ? null : ms || null,
        morning_end: isRest ? null : me || null,
        afternoon_start: isRest ? null : as || null,
        afternoon_end: isRest ? null : ae || null,
        is_order: isRest ? false : isOrder,
        employee_id: employeeId,
        note,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${frDay(day.weekday)} ${frDate(day.date)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn--primary" onClick={save} disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Salarié</label>
        <select value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))}>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
      </div>
      <div className="checkbox field">
        <input id="rest" type="checkbox" checked={isRest} onChange={(e) => setIsRest(e.target.checked)} />
        <label htmlFor="rest">Jour de repos</label>
      </div>
      {!isRest && (
        <>
          <p className="muted" style={{ fontSize: '.82rem' }}>
            Magasin : {day.open_time} → {day.close_time}. Laisser l'après-midi vide pour une seule
            plage horaire. Formats acceptés : 9h50, 15h, 09:50…
          </p>
          <div className="form-row">
            <div className="field">
              <label>Matin — début</label>
              <input value={ms} onChange={(e) => setMs(e.target.value)} placeholder="09:50" />
            </div>
            <div className="field">
              <label>Matin — fin</label>
              <input value={me} onChange={(e) => setMe(e.target.value)} placeholder="14:00" />
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label>Après-midi — début</label>
              <input value={as} onChange={(e) => setAs(e.target.value)} placeholder="15:00" />
            </div>
            <div className="field">
              <label>Après-midi — fin</label>
              <input value={ae} onChange={(e) => setAe(e.target.value)} placeholder="19:40" />
            </div>
          </div>
          {day.weekday === 2 && (
            <div className="checkbox field">
              <input id="order" type="checkbox" checked={isOrder} onChange={(e) => setIsOrder(e.target.checked)} />
              <label htmlFor="order">📦 Responsable de la commande</label>
            </div>
          )}
          <div className="field">
            <label>Note</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </>
      )}
    </Modal>
  );
}
