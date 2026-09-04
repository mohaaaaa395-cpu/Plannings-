// ============================================================
// Time helpers — normalization, formatting, duration.
// Times are stored as "HH:MM" 24h strings.
// ============================================================

// Parse a user-entered time into "HH:MM".
// Accepts: "9h50" -> "09:50", "15h" -> "15:00", "9h15" -> "09:15",
// "09:50", "9:5" -> "09:05", "950" -> "09:50", "9" -> "09:00".
export function normalizeTime(input) {
  if (input === null || input === undefined) return null;
  let s = String(input).trim().toLowerCase();
  if (s === '') return null;
  s = s.replace(/\s+/g, '');

  let h = null;
  let m = null;

  // formats with a separator: h, :, .
  const sepMatch = s.match(/^(\d{1,2})[h:.](\d{0,2})$/);
  if (sepMatch) {
    h = parseInt(sepMatch[1], 10);
    m = sepMatch[2] === '' ? 0 : parseInt(sepMatch[2], 10);
  } else if (/^\d{1,2}$/.test(s)) {
    // "9" -> 09:00
    h = parseInt(s, 10);
    m = 0;
  } else if (/^\d{3,4}$/.test(s)) {
    // "950" -> 9:50, "0950" -> 09:50, "1540" -> 15:40
    const padded = s.padStart(4, '0');
    h = parseInt(padded.slice(0, 2), 10);
    m = parseInt(padded.slice(2), 10);
  } else {
    return null;
  }

  if (h == null || m == null || Number.isNaN(h) || Number.isNaN(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// "HH:MM" -> minutes since midnight
export function toMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  return h * 60 + m;
}

// minutes since midnight -> "HH:MM"
export function fromMinutes(min) {
  if (min == null) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Format a duration in minutes as "HH:MM" (e.g. 530 -> "08:50").
export function formatDuration(min) {
  if (min == null) min = 0;
  const sign = min < 0 ? '-' : '';
  min = Math.abs(min);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Minutes worked given morning/afternoon segments (break not counted).
export function shiftMinutes(shift) {
  if (!shift || shift.is_rest) return 0;
  let total = 0;
  if (shift.morning_start && shift.morning_end) {
    total += toMinutes(shift.morning_end) - toMinutes(shift.morning_start);
  }
  if (shift.afternoon_start && shift.afternoon_end) {
    total += toMinutes(shift.afternoon_end) - toMinutes(shift.afternoon_start);
  }
  return Math.max(0, total);
}
