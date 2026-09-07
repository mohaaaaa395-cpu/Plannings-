import { toMinutes, fromMinutes } from '../time.js';

// ============================================================
// Parametric shift builder.
// Given a day's open/close, an anchor (open|close|full|free) and a
// target worked-minutes, produce a concrete shift with morning /
// afternoon segments. The unpaid break is inserted only when the worked
// span is long enough, and is never counted as working time.
// ============================================================

export function dayBounds(config, isSunday) {
  const s = config.store;
  return {
    open: toMinutes(isSunday ? s.sunday_open : s.weekday_open),
    close: toMinutes(isSunday ? s.sunday_close : s.weekday_close),
  };
}

// Worked minutes for a full open->close day (with break if long).
export function fullDayMinutes(config, isSunday) {
  const { open, close } = dayBounds(config, isSunday);
  const span = close - open;
  const brk = config.shifts.break_minutes;
  const threshold = config.shifts.break_threshold_minutes;
  return span > threshold ? span - brk : span;
}

export function maxDayMinutes(config, isSunday) {
  return fullDayMinutes(config, isSunday);
}

// Build a shift. Returns { is_rest, morning_start, morning_end,
// afternoon_start, afternoon_end, worked_minutes, is_opening, is_closing }.
export function buildShift(config, isSunday, anchor, targetMinutes) {
  const { open, close } = dayBounds(config, isSunday);
  const brkStart = toMinutes(config.shifts.break_start);
  const brkEnd = toMinutes(config.shifts.break_end);
  const brkLen = config.shifts.break_minutes;
  const threshold = config.shifts.break_threshold_minutes;
  const minDay = config.shifts.min_day_minutes;
  const maxDay = maxDayMinutes(config, isSunday);

  let worked = Math.max(minDay, Math.min(targetMinutes, maxDay));

  let start;
  let end;

  if (anchor === 'full') {
    start = open;
    end = close;
    worked = (end - start) > threshold ? (end - start) - brkLen : (end - start);
  } else {
    const needsBreak = worked >= threshold;
    const span = needsBreak ? worked + brkLen : worked;
    if (anchor === 'open') {
      start = open;
      end = start + span;
      if (end > close) {
        end = close;
      }
    } else if (anchor === 'close') {
      end = close;
      start = end - span;
      if (start < open) start = open;
    } else {
      // 'free' — centre the shift inside the day.
      const avail = close - open;
      const offset = Math.max(0, Math.floor((avail - span) / 2));
      start = open + offset;
      end = start + span;
      if (end > close) {
        end = close;
        start = Math.max(open, end - span);
      }
    }
  }

  // Recompute the concrete segments and worked minutes from start/end.
  const spanReal = end - start;
  const useBreak = spanReal > threshold && start < brkStart && end > brkEnd;

  let shift;
  if (useBreak) {
    shift = {
      is_rest: false,
      morning_start: fromMinutes(start),
      morning_end: fromMinutes(brkStart),
      afternoon_start: fromMinutes(brkEnd),
      afternoon_end: fromMinutes(end),
    };
    shift.worked_minutes = (brkStart - start) + (end - brkEnd);
  } else {
    // Single continuous segment. Place in morning fields if it starts
    // before the break window, otherwise in the afternoon fields.
    const inAfternoon = start >= brkStart;
    shift = {
      is_rest: false,
      morning_start: inAfternoon ? null : fromMinutes(start),
      morning_end: inAfternoon ? null : fromMinutes(end),
      afternoon_start: inAfternoon ? fromMinutes(start) : null,
      afternoon_end: inAfternoon ? fromMinutes(end) : null,
    };
    shift.worked_minutes = end - start;
  }

  shift.is_opening = start <= open;
  shift.is_closing = end >= close;
  shift.role = anchor;
  return shift;
}

export function restShift() {
  return {
    is_rest: true,
    morning_start: null,
    morning_end: null,
    afternoon_start: null,
    afternoon_end: null,
    worked_minutes: 0,
    is_opening: false,
    is_closing: false,
    role: 'rest',
  };
}

// Does a shift cover presence before a given deadline (e.g. Tuesday order)?
export function coversMorningBefore(shift, deadline) {
  if (!shift || shift.is_rest) return false;
  const dl = toMinutes(deadline);
  const ms = shift.morning_start ? toMinutes(shift.morning_start) : null;
  const as = shift.afternoon_start ? toMinutes(shift.afternoon_start) : null;
  const starts = [ms, as].filter((x) => x != null);
  if (starts.length === 0) return false;
  return Math.min(...starts) < dl;
}
