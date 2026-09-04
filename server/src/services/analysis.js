import { formatDuration, shiftMinutes, toMinutes } from '../time.js';
import { verifyCoverage } from '../engine/coverage.js';

// ============================================================
// Analyse a stored (nested) schedule: per-employee stats, coverage
// checks, contract comparison and human-readable alerts. Used by the
// dashboard, the schedule view and the validation summary — always
// computed from the actually stored shifts (so manual edits count).
// ============================================================

export function analyzeSchedule(schedule, employees, config) {
  const empById = Object.fromEntries(employees.map((e) => [e.id, e]));
  const perEmployee = {};
  for (const e of employees) {
    perEmployee[e.id] = {
      employee_id: e.id,
      name: e.name,
      contract_minutes: e.contract_minutes,
      planned_by_week: [0, 0, 0],
      worked_days_by_week: [0, 0, 0],
      planned_total: 0,
      saturdays: 0,
      sundays: 0,
      weekends: 0,
      openings: 0,
      closings: 0,
      worked_days: 0,
      long_days: 0,
    };
  }

  const alerts = [];
  const checks = {
    contracts: true,
    rest: true,
    coverage: true,
    openings: true,
    closings: true,
    order: true,
    deliveries: true,
    availability: true,
    rotation: true,
    equity: true,
  };

  (schedule.weeks || []).forEach((week, wi) => {
    const weekendWorked = {}; // empId -> bool
    for (const day of week.days) {
      const working = (day.shifts || []).filter((s) => !s.is_rest);
      const openers = working.filter((s) => s.is_opening);
      const closers = working.filter((s) => s.is_closing);

      // Continuous coverage indicator (store never empty)
      const open = toMinutes(day.open_time);
      const close = toMinutes(day.close_time);
      const cov = verifyCoverage(working, open, close);
      day.coverage_ok = cov.covered;
      if (!cov.covered) {
        checks.coverage = false;
        for (const g of cov.gaps) {
          alerts.push({
            level: 'error',
            type: 'coverage_gap',
            date: day.date,
            message: `⚠ Magasin sans personnel le ${day.date} (créneau non couvert)`,
          });
        }
      }

      if (openers.length < config.coverage.min_opening) {
        checks.openings = false;
        alerts.push({ level: 'error', type: 'opening_missing', date: day.date,
          message: `⚠ Ouverture non couverte le ${day.date}` });
      }
      if (closers.length < config.coverage.min_closing) {
        checks.closings = false;
        alerts.push({ level: 'error', type: 'closing_missing', date: day.date,
          message: `⚠ Fermeture non couverte le ${day.date}` });
      }
      if (day.weekday === config.order.weekday) {
        const orderShift = working.find((s) => s.is_order);
        const deadline = toMinutes(config.order.deadline);
        let ok = false;
        if (orderShift) {
          const starts = [orderShift.morning_start, orderShift.afternoon_start]
            .filter(Boolean)
            .map(toMinutes);
          ok = starts.length > 0 && Math.min(...starts) < deadline;
          const emp = empById[orderShift.employee_id];
          if (emp && !emp.is_order_manager) ok = false;
        }
        if (!ok) {
          checks.order = false;
          alerts.push({ level: 'error', type: 'order_missing', date: day.date,
            message: `⚠ Aucun responsable prévu pour la commande du mardi avant ${config.order.deadline} (${day.date})` });
        }
      }

      for (const s of working) {
        const pe = perEmployee[s.employee_id];
        if (!pe) continue;
        const mins = shiftMinutes(s);
        pe.planned_by_week[wi] += mins;
        pe.planned_total += mins;
        pe.worked_days += 1;
        pe.worked_days_by_week[wi] += 1;
        if (s.is_opening) pe.openings += 1;
        if (s.is_closing) pe.closings += 1;
        if (day.weekday === 6) pe.saturdays += 1;
        if (day.weekday === 7) pe.sundays += 1;
        if (mins >= config.shifts.long_day_minutes) pe.long_days += 1;
        if (day.weekday === 6 || day.weekday === 7) weekendWorked[s.employee_id] = true;
      }
    }
    for (const id of Object.keys(weekendWorked)) {
      if (perEmployee[id]) perEmployee[id].weekends += 1;
    }
  });

  // contract comparison
  const tol = config.generator.hours_tolerance_minutes;
  for (const e of employees) {
    const pe = perEmployee[e.id];
    const weeklyAvg = pe.planned_total / 3;
    pe.weekly_avg = Math.round(weeklyAvg);
    pe.contract_diff = Math.round(weeklyAvg - e.contract_minutes);
    pe.conform = Math.abs(pe.contract_diff) <= tol;
    if (!pe.conform) {
      checks.contracts = false;
      if (pe.contract_diff > 0) {
        alerts.push({ level: 'warn', type: 'hours_over', employee_id: e.id,
          message: `⚠ ${e.name} dépasse son contrat de ${formatDuration(pe.contract_diff)}/semaine` });
      } else {
        alerts.push({ level: 'warn', type: 'hours_under', employee_id: e.id,
          message: `⚠ ${e.name} : ${formatDuration(-pe.contract_diff)} de moins que son contrat/semaine` });
      }
    }
  }

  // rest days (hard rule): each employee must keep the guaranteed rest days
  const minRest = config.rest?.min_days_per_week ?? 0;
  const maxWork = (config.store.open_days.length || 7) - minRest;
  if (minRest > 0) {
    for (const e of employees) {
      const pe = perEmployee[e.id];
      if (pe.worked_days_by_week.some((n) => n > maxWork)) {
        checks.rest = false;
        alerts.push({ level: 'warn', type: 'rest', employee_id: e.id,
          message: `⚠ ${e.name} n'a pas ${minRest} jour(s) de repos sur une semaine` });
      }
    }
  }

  // success confirmations
  const ok = [];
  if (checks.contracts) ok.push({ level: 'ok', message: '✓ Contrats respectés' });
  if (minRest > 0 && checks.rest) ok.push({ level: 'ok', message: `✓ ${minRest} jours de repos respectés` });
  if (checks.coverage) ok.push({ level: 'ok', message: '✓ Magasin couvert en continu' });
  if (checks.openings) ok.push({ level: 'ok', message: '✓ Ouvertures assurées' });
  if (checks.closings) ok.push({ level: 'ok', message: '✓ Fermetures assurées' });
  if (checks.order) ok.push({ level: 'ok', message: '✓ Commande du mardi assurée' });

  return { perEmployee: Object.values(perEmployee), alerts, ok, checks };
}
