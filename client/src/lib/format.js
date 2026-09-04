const FR_DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const FR_MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

export function frDay(weekday) {
  return FR_DAYS[weekday - 1] || '';
}

// "YYYY-MM-DD" -> Date parts (UTC-safe)
function parts(dateStr) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map((x) => parseInt(x, 10));
  return { y, m, d };
}

export function frShortDate(dateStr) {
  const { d, m } = parts(dateStr);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

export function frDate(dateStr) {
  const { y, m, d } = parts(dateStr);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export function frLongDate(dateStr) {
  const { y, m, d } = parts(dateStr);
  return `${d} ${FR_MONTHS[m - 1]} ${y}`;
}

export function frMonthYear(dateStr) {
  const { y, m } = parts(dateStr);
  return `${FR_MONTHS[m - 1]} ${y}`;
}

export function isoWeekday(dateStr) {
  const { y, m, d } = parts(dateStr);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

// minutes -> "HH:MM"
export function fmtDuration(min) {
  if (min == null) min = 0;
  const sign = min < 0 ? '-' : '';
  min = Math.abs(Math.round(min));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function fmtHours(min) {
  return `${(min / 60).toFixed(1)}h`;
}

// worked minutes of a shift (morning + afternoon, break excluded)
export function shiftMinutes(s) {
  if (!s || s.is_rest) return 0;
  let t = 0;
  const toMin = (x) => {
    const [h, m] = x.split(':').map(Number);
    return h * 60 + m;
  };
  if (s.morning_start && s.morning_end) t += toMin(s.morning_end) - toMin(s.morning_start);
  if (s.afternoon_start && s.afternoon_end) t += toMin(s.afternoon_end) - toMin(s.afternoon_start);
  return Math.max(0, t);
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// next Monday from today (nice default start date)
export function nextMondayISO() {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = (8 - (day === 0 ? 7 : day)) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
