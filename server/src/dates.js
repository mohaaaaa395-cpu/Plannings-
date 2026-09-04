// ============================================================
// Date helpers — all computed in UTC to avoid timezone drift.
// Dates are handled as "YYYY-MM-DD" strings.
// Weekday is ISO: 1 = Monday .. 7 = Sunday.
// Automatically handles month/year rollover and leap years
// because it delegates to the JS Date engine (UTC).
// ============================================================

export function parseDate(str) {
  // Accept "YYYY-MM-DD" or Date. Returns a UTC Date at midnight.
  if (str instanceof Date) {
    return new Date(Date.UTC(str.getUTCFullYear(), str.getUTCMonth(), str.getUTCDate()));
  }
  const s = String(str).slice(0, 10);
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(date) {
  const d = date instanceof Date ? date : parseDate(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(date, n) {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

// ISO weekday: 1=Mon .. 7=Sun
export function isoWeekday(date) {
  const d = parseDate(date);
  const js = d.getUTCDay(); // 0=Sun..6=Sat
  return js === 0 ? 7 : js;
}

export function isSunday(date) {
  return isoWeekday(date) === 7;
}
export function isSaturday(date) {
  return isoWeekday(date) === 6;
}

// Build a 3-week structure starting at startDate (inclusive), 7 days each.
export function buildThreeWeeks(startDate) {
  const start = parseDate(startDate);
  const weeks = [];
  for (let w = 0; w < 3; w++) {
    const weekStart = addDays(start, w * 7);
    const weekEnd = addDays(weekStart, 6);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(weekStart, i);
      days.push({
        date: formatDate(day),
        weekday: isoWeekday(day),
      });
    }
    weeks.push({
      week_index: w + 1,
      start_date: formatDate(weekStart),
      end_date: formatDate(weekEnd),
      days,
    });
  }
  return {
    start_date: formatDate(start),
    end_date: formatDate(addDays(start, 20)),
    weeks,
  };
}

const FR_MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];
const FR_DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

export function frDayName(date) {
  return FR_DAYS[isoWeekday(date) - 1];
}

export function frLongDate(date) {
  const d = parseDate(date);
  return `${d.getUTCDate()} ${FR_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function frMonthYear(date) {
  const d = parseDate(date);
  return `${FR_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Is `date` within [start, end] inclusive?
export function withinRange(date, start, end) {
  const t = parseDate(date).getTime();
  return t >= parseDate(start).getTime() && t <= parseDate(end).getTime();
}
