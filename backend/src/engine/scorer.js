import { formatDuration, toMinutes } from '../time.js';
import { verifyCoverage } from './coverage.js';
import { dayBounds } from './shifts.js';

// ============================================================
// Candidate scorer.
// Turns a built candidate into a 0-100 score plus a breakdown and a
// list of human-readable alerts. Weights are configurable.
// ============================================================

function stddev(values) {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(v);
}

export function scoreCandidate(candidate, ctx) {
  const { config, employees, weightedHistory } = ctx;
  const W = config.weights;
  const tol = config.generator.hours_tolerance_minutes;
  const breakdown = {};
  const alerts = [];
  let penalty = 0;

  const add = (key, pts) => {
    if (pts <= 0) return;
    breakdown[key] = (breakdown[key] || 0) + pts;
    penalty += pts;
  };

  const empById = Object.fromEntries(employees.map((e) => [e.id, e]));

  // ---- Contracts: planned vs contract per week ----
  for (const emp of employees) {
    const per = candidate.perEmployee[emp.id];
    if (!per) continue;
    per.plannedMinutesByWeek.forEach((planned, wi) => {
      const diff = planned - emp.contract_minutes;
      if (diff > tol) {
        add('hours_over', (W.hours_over * (diff - tol)) / 15);
        alerts.push({
          level: 'warn',
          type: 'hours_over',
          employee_id: emp.id,
          week: wi + 1,
          message: `${emp.name} dépasse son contrat de ${formatDuration(diff)} (semaine ${wi + 1})`,
        });
      } else if (diff < -tol) {
        add('hours_under', (W.hours_under * (-diff - tol)) / 15);
        alerts.push({
          level: 'warn',
          type: 'hours_under',
          employee_id: emp.id,
          week: wi + 1,
          message: `${emp.name} : manque ${formatDuration(-diff)} vs contrat (semaine ${wi + 1})`,
        });
      }
    });
  }

  // ---- Coverage: opening / closing / order / continuity ----
  for (const week of candidate.weeks) {
    for (const day of week.days) {
      const working = day.shifts.filter((s) => !s.is_rest);
      const openers = working.filter((s) => s.is_opening);
      const closers = working.filter((s) => s.is_closing);
      if (openers.length < config.coverage.min_opening) {
        add('opening_missing', W.opening_missing);
        alerts.push({
          level: 'error',
          type: 'opening_missing',
          date: day.date,
          message: `Ouverture non couverte le ${day.date}`,
        });
      }
      if (closers.length < config.coverage.min_closing) {
        add('closing_missing', W.closing_missing);
        alerts.push({
          level: 'error',
          type: 'closing_missing',
          date: day.date,
          message: `Fermeture non couverte le ${day.date}`,
        });
      }
      // Tuesday order
      if (day.weekday === config.order.weekday) {
        const hasOrder = working.some((s) => s.is_order);
        if (!hasOrder) {
          add('order_missing', W.order_missing);
          alerts.push({
            level: 'error',
            type: 'order_missing',
            date: day.date,
            message: `Aucun responsable prévu pour la commande du mardi avant ${config.order.deadline} (${day.date})`,
          });
        }
      }
      // Continuous coverage: the store must never be empty.
      if (config.coverage.require_continuous) {
        const { open, close } = dayBounds(config, day.is_sunday);
        const { covered, gaps } = verifyCoverage(working, open, close);
        if (!covered) {
          add('coverage_gap', W.coverage_gap * gaps.length * 5);
          for (const g of gaps) {
            alerts.push({
              level: 'error',
              type: 'coverage_gap',
              date: day.date,
              message: `Magasin sans personnel le ${day.date} (créneau non couvert)`,
            });
          }
        }
      }
    }
  }

  // ---- Balance / rotation (capacity-weighted spread) ----
  const balanceFields = [
    ['saturdays', W.saturday_balance],
    ['sundays', W.sunday_balance],
    ['openings', W.opening_balance],
    ['closings', W.closing_balance],
  ];
  for (const [field, weight] of balanceFields) {
    const shares = [];
    for (const emp of employees) {
      // structural weekend-only employees excluded from weekend rotation spread
      if ((field === 'saturdays' || field === 'sundays') && emp.weekend_only) continue;
      const hist = weightedHistory[emp.id]?.[field] || 0;
      const contrib = candidate.perEmployee[emp.id]?.contributions?.[field] || 0;
      const cap = candidate.perEmployee[emp.id]?.capacity?.[field] || 1;
      shares.push((hist + contrib) / cap);
    }
    add(`${field}_balance`, weight * stddev(shares));
  }

  // hours balance (fill ratio spread)
  const fillRatios = employees.map((e) => {
    const per = candidate.perEmployee[e.id];
    if (!per) return 1;
    const planned = per.plannedMinutesByWeek.reduce((a, b) => a + b, 0);
    return planned / (e.contract_minutes * 3 || 1);
  });
  add('hours_balance', W.hours_balance * stddev(fillRatios) * 10);

  // ---- Long days & consecutive runs ----
  for (const emp of employees) {
    const per = candidate.perEmployee[emp.id];
    if (!per) continue;
    add('long_day', W.long_day * (per.contributions.long_days || 0) * 0.5);
    if (per.maxConsecutive > 5) {
      add('consecutive_days', W.consecutive_days * (per.maxConsecutive - 5));
      alerts.push({
        level: 'warn',
        type: 'consecutive_days',
        employee_id: emp.id,
        message: `${emp.name} enchaîne ${per.maxConsecutive} jours consécutifs`,
      });
    }
  }

  // ---- Soft preference violations ----
  add('preference_violation', W.preference_violation * (candidate.softViolations || 0));

  const score = Math.max(0, Math.round((100 * 80) / (80 + penalty)));

  return { score, penalty: Math.round(penalty), breakdown, alerts };
}
