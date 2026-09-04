import { query } from '../db.js';
import { parseDate } from '../dates.js';

// ============================================================
// Equity engine.
// Loads historical statistics from validated/archived schedules and
// builds weighted, capacity-aware fairness figures so the generator
// favours whoever has done the least of a given resource *relative to
// what they can realistically do*.
// ============================================================

const EMPTY = () => ({
  saturdays: 0,
  sundays: 0,
  weekends: 0,
  openings: 0,
  closings: 0,
  worked_minutes: 0,
  worked_days: 0,
  long_days: 0,
});

// Load weighted history for all employees up to (and excluding) refDate.
// config.rotation.history_weeks (0 = all) and config.rotation.decay drive weighting.
export async function loadHistory(config, refDate) {
  const { rows } = await query(
    `SELECT es.*
       FROM equity_statistics es
       JOIN schedules s ON s.id = es.schedule_id
      WHERE s.status IN ('validated', 'archived')
        AND es.week_start < $1`,
    [refDate]
  );

  const decay = config.rotation?.decay ?? 0.9;
  const historyWeeks = config.rotation?.history_weeks ?? 12;
  const ref = parseDate(refDate).getTime();

  const weighted = {}; // empId -> weighted aggregates
  const raw = {}; // empId -> raw aggregates (for display)

  for (const r of rows) {
    const weeksAgo = Math.max(
      0,
      Math.floor((ref - parseDate(r.week_start).getTime()) / (7 * 86400000))
    );
    if (historyWeeks > 0 && weeksAgo >= historyWeeks) continue;
    const w = Math.pow(decay, weeksAgo);

    if (!weighted[r.employee_id]) weighted[r.employee_id] = EMPTY();
    if (!raw[r.employee_id]) raw[r.employee_id] = EMPTY();
    const acc = weighted[r.employee_id];
    const rawAcc = raw[r.employee_id];
    for (const k of Object.keys(EMPTY())) {
      acc[k] += (r[k] || 0) * w;
      rawAcc[k] += r[k] || 0;
    }
  }

  return { weighted, raw };
}

// A running equity tracker used during a single candidate generation.
// Seeds from weighted history, then accumulates as the candidate fills up,
// so rotation improves both against history and within the 3 generated weeks.
export class EquityTracker {
  constructor(employees, weightedHistory) {
    this.counts = {};
    for (const e of employees) {
      this.counts[e.id] = weightedHistory[e.id]
        ? { ...weightedHistory[e.id] }
        : EMPTY();
    }
  }

  add(empId, field, n = 1) {
    if (!this.counts[empId]) this.counts[empId] = EMPTY();
    this.counts[empId][field] += n;
  }

  get(empId, field) {
    return this.counts[empId]?.[field] ?? 0;
  }

  // Fairness score for assigning `field` to emp: lower = more deserving.
  // Weighted by capacity so structural constraints (e.g. weekend-only
  // Noussia) don't unfairly skew comparisons.
  fairnessScore(emp, field, capacity) {
    const c = this.get(emp.id, field);
    const cap = capacity && capacity > 0 ? capacity : 1;
    return (c + 0.5) / cap; // +0.5 smoothing
  }
}

// Rough capacity of an employee for a resource, used to weight fairness.
// The idea: someone who can realistically do a lot of X should be expected
// to have a higher raw count of X — so we divide by capacity.
export function capacityFor(field, emp, availableDaysPerWeek) {
  const contractDays = Math.max(1, availableDaysPerWeek);
  switch (field) {
    case 'saturdays':
    case 'sundays':
      // Weekend-only employees are structurally expected to work weekends;
      // give them high capacity so their (naturally high) counts are not
      // treated as "over-serving".
      if (emp.weekend_only) return 3.0;
      return 1.0;
    case 'weekends':
      if (emp.weekend_only) return 3.0;
      return 1.0;
    case 'openings':
    case 'closings':
      return contractDays; // more working days => more open/close capacity
    default:
      return 1.0;
  }
}
