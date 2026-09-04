import { query } from '../db.js';

// Period key -> number of days to look back (null = all history).
const PERIODS = {
  '7w': 49,
  '12w': 84,
  '3m': 92,
  '6m': 183,
  all: null,
};

export function periodCutoff(period) {
  const days = PERIODS[period];
  if (days == null) return null;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Aggregate equity statistics per employee for a period.
export async function employeeStats(period = '12w') {
  const cutoff = periodCutoff(period);
  const params = [];
  let where = `s.status IN ('validated','archived')`;
  if (cutoff) {
    params.push(cutoff);
    where += ` AND es.week_start >= $${params.length}`;
  }
  const { rows } = await query(
    `SELECT e.id, e.name, e.color, e.position, e.weekend_only,
        COALESCE(SUM(es.saturdays),0)::int AS saturdays,
        COALESCE(SUM(es.sundays),0)::int AS sundays,
        COALESCE(SUM(es.weekends),0)::int AS weekends,
        COALESCE(SUM(es.openings),0)::int AS openings,
        COALESCE(SUM(es.closings),0)::int AS closings,
        COALESCE(SUM(es.worked_minutes),0)::int AS worked_minutes,
        COALESCE(SUM(es.worked_days),0)::int AS worked_days,
        COALESCE(SUM(es.long_days),0)::int AS long_days
     FROM employees e
     LEFT JOIN equity_statistics es ON es.employee_id = e.id
     LEFT JOIN schedules s ON s.id = es.schedule_id AND ${where}
     WHERE e.active = true
     GROUP BY e.id, e.name, e.color, e.position, e.weekend_only
     ORDER BY e.sort_order, e.id`,
    params
  );
  return rows;
}

export async function availablePeriods() {
  return Object.keys(PERIODS);
}
