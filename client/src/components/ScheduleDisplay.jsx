import { useState } from 'react';
import { frDay, frShortDate, frLongDate, fmtDuration, shiftMinutes } from '../lib/format.js';
import ShiftEditor from './ShiftEditor.jsx';
import { api } from '../api.js';

function eventTags(day) {
  const tags = [];
  if (day.events?.order) tags.push(<span key="o" className="event-tag event-order">📦 Commande</span>);
  if (day.events?.delivery) tags.push(<span key="d" className="event-tag event-delivery">📦 Livraison</span>);
  return tags;
}

function ShiftCell({ shift }) {
  if (!shift || shift.is_rest) return <span className="rest">Repos</span>;
  const segs = [];
  if (shift.morning_start) segs.push(`${shift.morning_start} → ${shift.morning_end}`);
  if (shift.afternoon_start) segs.push(`${shift.afternoon_start} → ${shift.afternoon_end}`);
  return <span className="seg">{segs.join(' | ') || '—'}</span>;
}

// Per-employee weekly table: JOUR | MATIN | APRÈS-MIDI | TOTAL
function EmployeeWeekTable({ week, emp, contractMinutes, editable, onEdit }) {
  let total = 0;
  return (
    <div className="emp-schedule">
      <div className="emp-schedule__head">
        <span className="emp-schedule__name">
          <span className="emp-dot" style={{ background: emp.color }} />
          {emp.name} <span className="muted" style={{ fontWeight: 400 }}>· {emp.position}</span>
        </span>
        <WeekTotalBadge week={week} empId={emp.id} contractMinutes={contractMinutes} />
      </div>
      <table className="planning">
        <thead>
          <tr>
            <th style={{ width: '22%' }}>Jour</th>
            <th>Matin</th>
            <th>Après-midi</th>
            <th style={{ width: 90 }} className="col-total">Total</th>
          </tr>
        </thead>
        <tbody>
          {week.days.map((day) => {
            const shift = day.shifts.find((s) => s.employee_id === emp.id);
            const mins = shiftMinutes(shift);
            total += mins;
            const rowClass = day.weekday === 7 ? 'is-sunday' : day.weekday === 6 ? 'is-weekend' : '';
            return (
              <tr key={day.date} className={rowClass}>
                <td className="day-name">
                  {frDay(day.weekday)} {frShortDate(day.date)}
                  <div>{eventTags(day)}</div>
                  {shift && !shift.is_rest && (
                    <div>
                      {shift.is_opening && <span className="role-tag">🔑 Ouverture </span>}
                      {shift.is_closing && <span className="role-tag">🔒 Fermeture </span>}
                      {shift.is_order && <span className="role-tag">📦 Commande</span>}
                      {shift.is_manual && <span className="badge badge--warn" style={{ marginLeft: 4 }}>modifié</span>}
                    </div>
                  )}
                </td>
                <td
                  className={editable ? 'editable' : ''}
                  onClick={editable ? () => onEdit(day, shift) : undefined}
                  colSpan={shift && !shift.is_rest ? 1 : 2}
                >
                  {shift && !shift.is_rest ? (
                    shift.morning_start ? `${shift.morning_start} → ${shift.morning_end}` : <span className="muted">—</span>
                  ) : (
                    <span className="rest">Repos</span>
                  )}
                </td>
                {shift && !shift.is_rest && (
                  <td className={editable ? 'editable' : ''} onClick={editable ? () => onEdit(day, shift) : undefined}>
                    {shift.afternoon_start ? `${shift.afternoon_start} → ${shift.afternoon_end}` : <span className="muted">—</span>}
                  </td>
                )}
                <td className="col-total">{mins > 0 ? fmtDuration(mins) : '00:00'}</td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>Total hebdomadaire</td>
            <td className="col-total">{fmtDuration(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function WeekTotalBadge({ week, empId, contractMinutes }) {
  let total = 0;
  for (const day of week.days) {
    const s = day.shifts.find((x) => x.employee_id === empId);
    total += shiftMinutes(s);
  }
  const diff = total - contractMinutes;
  const tol = 60;
  let cls = 'badge--success';
  let txt = '✓ Conforme';
  if (diff > tol) { cls = 'badge--warn'; txt = `+${fmtDuration(diff)}`; }
  else if (diff < -tol) { cls = 'badge--warn'; txt = `${fmtDuration(diff)}`; }
  return (
    <span className="row" style={{ gap: 8 }}>
      <span className="emp-total">{fmtDuration(total)} / {fmtDuration(contractMinutes)}</span>
      <span className={`badge ${cls}`}>{txt}</span>
    </span>
  );
}

// Overview grid: employees × days for a week.
function OverviewGrid({ week, employees }) {
  return (
    <div className="grid-table-wrap">
      <table className="overview">
        <thead>
          <tr>
            <th>Salarié</th>
            {week.days.map((d) => (
              <th key={d.date} className={d.weekday === 7 ? 'is-sunday' : ''}>
                {frDay(d.weekday).slice(0, 3)} {frShortDate(d.date)}
                <div>{eventTags(d)}</div>
              </th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => {
            let total = 0;
            return (
              <tr key={emp.id}>
                <td className="empname">
                  <span className="emp-dot" style={{ background: emp.color }} /> {emp.name}
                </td>
                {week.days.map((d) => {
                  const s = d.shifts.find((x) => x.employee_id === emp.id);
                  const mins = shiftMinutes(s);
                  total += mins;
                  return (
                    <td key={d.date}>
                      {s && !s.is_rest ? (
                        <>
                          {s.morning_start && <div>{s.morning_start}-{s.morning_end}</div>}
                          {s.afternoon_start && <div>{s.afternoon_start}-{s.afternoon_end}</div>}
                          <div className="muted" style={{ fontSize: '.7rem' }}>
                            {s.is_opening ? '🔑' : ''}{s.is_closing ? '🔒' : ''}{s.is_order ? '📦' : ''}
                          </div>
                        </>
                      ) : (
                        <span className="rest">—</span>
                      )}
                    </td>
                  );
                })}
                <td style={{ fontWeight: 700 }}>{fmtDuration(total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ScheduleDisplay({ schedule, employees, editable = false, onShiftSaved }) {
  const [view, setView] = useState('week'); // week | global | employee
  const [empFilter, setEmpFilter] = useState(employees[0]?.id || null);
  const [editing, setEditing] = useState(null); // {day, shift}
  const contractById = Object.fromEntries(employees.map((e) => [e.id, e.contract_minutes]));

  const handleEdit = (day, shift) => {
    if (!shift) return;
    setEditing({ day, shift });
  };

  const saveEdit = async (patch) => {
    const data = await api.updateShift(editing.shift.id, patch);
    if (onShiftSaved) onShiftSaved(data);
  };

  return (
    <div>
      <div className="tabs no-print">
        <div className={`tab ${view === 'week' ? 'active' : ''}`} onClick={() => setView('week')}>
          Par semaine
        </div>
        <div className={`tab ${view === 'global' ? 'active' : ''}`} onClick={() => setView('global')}>
          Vue globale
        </div>
        <div className={`tab ${view === 'employee' ? 'active' : ''}`} onClick={() => setView('employee')}>
          Par salarié
        </div>
      </div>

      {view === 'employee' && (
        <div className="field no-print" style={{ maxWidth: 260 }}>
          <label>Salarié</label>
          <select value={empFilter || ''} onChange={(e) => setEmpFilter(Number(e.target.value))}>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
      )}

      {schedule.weeks.map((week) => (
        <div className="week-block" key={week.id || week.week_index}>
          <div className="week-head">
            <h3>Semaine {week.week_index}</h3>
            <span className="range">
              du {frLongDate(week.start_date)} au {frLongDate(week.end_date)}
            </span>
          </div>

          {view === 'global' && <OverviewGrid week={week} employees={employees} />}
          {view === 'week' &&
            employees.map((emp) => (
              <EmployeeWeekTable
                key={emp.id}
                week={week}
                emp={emp}
                contractMinutes={contractById[emp.id]}
                editable={editable}
                onEdit={handleEdit}
              />
            ))}
          {view === 'employee' && empFilter && (
            <EmployeeWeekTable
              week={week}
              emp={employees.find((e) => e.id === empFilter)}
              contractMinutes={contractById[empFilter]}
              editable={editable}
              onEdit={handleEdit}
            />
          )}
        </div>
      ))}

      {editing && (
        <ShiftEditor
          day={editing.day}
          shift={editing.shift}
          employees={employees}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
        />
      )}
    </div>
  );
}
