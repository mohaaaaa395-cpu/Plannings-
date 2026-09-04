import { toMinutes, fromMinutes } from '../time.js';
import { isoWeekday, isSunday as dateIsSunday, withinRange } from '../dates.js';
import { dayBounds } from './shifts.js';

// ============================================================
// Continuous-coverage engine.
// Guarantees (by construction) that the store is never empty during
// opening hours: the union of all present intervals covers [open, close]
// with no gap, and unpaid breaks are only placed when another employee
// is present. Also enforces per-employee availability windows (partial
// unavailabilities).
// ============================================================

// ---------- interval helpers (minutes since midnight) ----------
export function mergeIntervals(list) {
  const arr = list.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of arr) {
    if (out.length && s <= out[out.length - 1][1]) {
      out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
    } else {
      out.push([s, e]);
    }
  }
  return out;
}

export function findGaps(intervals, open, close) {
  const merged = mergeIntervals(intervals);
  const gaps = [];
  let cursor = open;
  for (const [s, e] of merged) {
    if (s > cursor) gaps.push([cursor, Math.min(s, close)]);
    cursor = Math.max(cursor, e);
    if (cursor >= close) break;
  }
  if (cursor < close) gaps.push([cursor, close]);
  return gaps.filter(([s, e]) => e > s);
}

export function intervalCoveredBy(target, coverList) {
  const merged = mergeIntervals(coverList);
  let cursor = target[0];
  for (const [s, e] of merged) {
    if (s > cursor) return false;
    if (e > cursor) cursor = e;
    if (cursor >= target[1]) return true;
  }
  return cursor >= target[1];
}

function subtractHole(windows, hs, he) {
  const out = [];
  for (const [s, e] of windows) {
    if (he <= s || hs >= e) { out.push([s, e]); continue; }
    if (hs > s) out.push([s, hs]);
    if (he < e) out.push([he, e]);
  }
  return out.filter(([s, e]) => e - s > 0);
}

// Convert a stored/generated shift (morning/afternoon strings) to intervals.
export function shiftIntervals(shift) {
  if (!shift || shift.is_rest) return [];
  const iv = [];
  if (shift.morning_start && shift.morning_end) iv.push([toMinutes(shift.morning_start), toMinutes(shift.morning_end)]);
  if (shift.afternoon_start && shift.afternoon_end) iv.push([toMinutes(shift.afternoon_start), toMinutes(shift.afternoon_end)]);
  return iv;
}

// Verify the store is fully covered by the given shifts.
export function verifyCoverage(shifts, open, close) {
  const all = [];
  for (const s of shifts) all.push(...shiftIntervals(s));
  const gaps = findGaps(all, open, close);
  return { covered: gaps.length === 0, gaps };
}

// ---------- availability windows ----------
// Allowed working intervals for an employee on a date (within opening hours).
// Returns [] when the employee cannot work at all that day.
export function computeWindows(emp, date, ctx) {
  const wd = isoWeekday(date);
  const config = ctx.config;
  if (!config.store.open_days.includes(wd)) return [];
  if (emp.weekend_only && wd < 6) return [];

  const abs = ctx.absencesByEmp?.[emp.id] || [];
  for (const a of abs) if (withinRange(date, a.start_date, a.end_date)) return [];

  const { open, close } = dayBounds(config, dateIsSunday(date));
  let windows = [[open, close]];

  // Recurring hard unavailability rules (legacy availability table)
  for (const av of emp.availability || []) {
    if (!av.is_hard || av.kind !== 'unavailable') continue;
    if (av.weekday != null && av.weekday !== wd) continue;
    if (av.start_time && av.end_time) {
      windows = subtractHole(windows, toMinutes(av.start_time), toMinutes(av.end_time));
    } else {
      return []; // whole-day recurring unavailability
    }
  }

  // Date-specific / recurring unavailabilities (dedicated table)
  for (const u of ctx.unavailabilitiesByEmp?.[emp.id] || []) {
    const matchesDate = u.date && String(u.date).slice(0, 10) === date;
    const matchesWeekday = u.weekday != null && u.weekday === wd;
    if (!matchesDate && !matchesWeekday) continue;
    if (u.all_day || !u.start_time || !u.end_time) return [];
    windows = subtractHole(windows, toMinutes(u.start_time), toMinutes(u.end_time));
  }

  // clamp to opening hours
  return windows
    .map(([s, e]) => [Math.max(s, open), Math.min(e, close)])
    .filter(([s, e]) => e - s > 0);
}

function windowContaining(windows, t) {
  for (const w of windows) if (w[0] <= t && w[1] > t) return w;
  return null;
}
function largestWindow(windows) {
  return windows.reduce((a, b) => (b[1] - b[0] > (a ? a[1] - a[0] : -1) ? b : a), null);
}

function buildBlockInWindow(win, span, prefer) {
  const len = Math.min(span, win[1] - win[0]);
  if (prefer === 'open') return [win[0], win[0] + len];
  if (prefer === 'close') return [win[1] - len, win[1]];
  const s = win[0] + Math.max(0, Math.floor((win[1] - win[0] - len) / 2));
  return [s, s + len];
}

function findBreakSlot(s, e, othersMerged, config) {
  const breakLen = config.shifts.break_minutes;
  const minSeg = config.coverage.min_segment_minutes;
  const earliest = s + minSeg;
  const latest = e - minSeg - breakLen;
  if (latest < earliest) return null;
  const pref = toMinutes(config.shifts.break_start);
  const candidates = [];
  if (pref >= earliest && pref <= latest) candidates.push(pref);
  for (let t = earliest; t <= latest; t += 15) candidates.push(t);
  for (const bs of candidates) {
    const be = bs + breakLen;
    if (intervalCoveredBy([bs, be], othersMerged)) return [bs, be];
  }
  return null;
}

// ---------- the day builder ----------
// workers: [{emp, windows, target, isOrder, openScore, closeScore}]
// extra:   [{emp, windows}] available employees not chosen (for relief)
// Returns { shifts, addedEmpIds, covered, gap }.
export function buildDayShifts(config, day, workers, extra, rng = Math.random) {
  const { open, close } = dayBounds(config, day.is_sunday);
  const threshold = config.shifts.break_threshold_minutes;
  const breakLen = config.shifts.break_minutes;
  const minSeg = config.coverage.min_segment_minutes;
  const brkStart = toMinutes(config.shifts.break_start);
  const addedEmpIds = [];

  const rt = workers.map((w) => ({ ...w, intervals: [] }));

  const canOpen = (w) => w.windows.some((win) => win[0] <= open && win[1] > open);
  const canClose = (w) => w.windows.some((win) => win[1] >= close && win[0] < close);

  // --- choose opener (prefer the order manager, else best openScore) ---
  let opener = rt.find((w) => w.isOrder && canOpen(w));
  if (!opener) {
    const cands = rt.filter(canOpen).sort((a, b) => (a.openScore ?? 0) - (b.openScore ?? 0));
    opener = cands[0];
  }
  if (!opener) {
    const ex = extra.find((e) => e.windows.some((win) => win[0] <= open && win[1] > open));
    if (ex) {
      opener = { emp: ex.emp, windows: ex.windows, target: defaultTarget(config, day), intervals: [], _relief: true };
      rt.push(opener); addedEmpIds.push(ex.emp.id);
    }
  }
  if (!opener) return { shifts: [], addedEmpIds, covered: false, gap: [open, close] };

  // --- choose closer (distinct if possible) ---
  let closer = rt
    .filter((w) => w !== opener && canClose(w))
    .sort((a, b) => (a.closeScore ?? 0) - (b.closeScore ?? 0))[0];
  if (!closer && !canClose(opener)) {
    const ex = extra.find(
      (e) => e.emp.id !== opener.emp.id && e.windows.some((win) => win[1] >= close && win[0] < close)
    );
    if (ex) {
      closer = { emp: ex.emp, windows: ex.windows, target: defaultTarget(config, day), intervals: [], _relief: true };
      rt.push(closer); addedEmpIds.push(ex.emp.id);
    }
  }

  // --- initial continuous blocks ---
  for (const w of rt) {
    const prefer = w === opener ? 'open' : w === closer ? 'close' : 'free';
    let win;
    if (prefer === 'open') win = windowContaining(w.windows, open) || largestWindow(w.windows);
    else if (prefer === 'close') win = windowContaining(w.windows, close - 1) || largestWindow(w.windows);
    else win = largestWindow(w.windows);
    if (!win) continue;
    const span = w.target + (w.target >= threshold ? breakLen : 0);
    w.intervals = [buildBlockInWindow(win, span, prefer)];
  }

  // --- coverage repair: fill any gap ---
  let guard = 0;
  while (guard++ < 40) {
    const all = [];
    for (const w of rt) all.push(...w.intervals);
    const gaps = findGaps(all, open, close);
    if (gaps.length === 0) break;
    const [g1, g2] = gaps[0];
    if (!fillGap(rt, extra, addedEmpIds, g1, g2, config, day)) {
      return { shifts: buildShiftObjects(rt, open, close, brkStart), addedEmpIds, covered: false, gap: [g1, g2] };
    }
  }

  // --- staggered break insertion (only where others cover) ---
  for (const w of rt) {
    const merged = mergeIntervals(w.intervals);
    if (merged.length !== 1) { w.intervals = merged; continue; }
    const [s, e] = merged[0];
    if (e - s < threshold) { w.intervals = merged; continue; }
    const others = [];
    for (const o of rt) if (o !== w) others.push(...o.intervals);
    const othersMerged = mergeIntervals(others);
    const slot = findBreakSlot(s, e, othersMerged, config);
    if (slot) w.intervals = [[s, slot[0]], [slot[1], e]];
    else w.intervals = merged;
  }

  const shifts = buildShiftObjects(rt, open, close, brkStart);
  const { covered, gaps } = verifyCoverage(shifts, open, close);
  return { shifts, addedEmpIds, covered, gap: gaps[0] || null };
}

function defaultTarget(config, day) {
  return Math.min(config.shifts.long_day_minutes, 300);
}

function fillGap(rt, extra, addedEmpIds, g1, g2, config, day) {
  // (a) extend an existing worker whose window covers g1 and whose interval
  //     is adjacent (keeps a single interval where possible).
  const adj = rt
    .filter((w) => w.windows.some((win) => win[0] <= g1 && win[1] > g1))
    .sort((a, b) => coverEnd(b, g1) - coverEnd(a, g1));
  // prefer one whose interval currently ends exactly at (or before) g1 to merge
  for (const w of adj) {
    const win = windowContaining(w.windows, g1);
    if (!win) continue;
    const newEnd = Math.min(win[1], g2);
    if (newEnd <= g1) continue;
    // merge/extend: if an interval ends at g1, extend it; else add contiguous piece
    const touching = w.intervals.find((iv) => iv[1] >= g1 - 1 && iv[0] <= g1);
    if (touching) touching[1] = Math.max(touching[1], newEnd);
    else w.intervals.push([g1, newEnd]);
    return true;
  }
  // (b) bring in an extra (not-yet-working) employee whose window covers g1.
  const ex = extra.find(
    (e) => !addedEmpIds.includes(e.emp.id) && e.windows.some((win) => win[0] <= g1 && win[1] > g1)
  );
  if (ex) {
    const win = windowContaining(ex.windows, g1);
    const newEnd = Math.min(win[1], g2);
    rt.push({ emp: ex.emp, windows: ex.windows, target: newEnd - g1, intervals: [[g1, newEnd]], _relief: true });
    addedEmpIds.push(ex.emp.id);
    return true;
  }
  return false;
}

function coverEnd(w, t) {
  const win = windowContaining(w.windows, t);
  return win ? win[1] : -1;
}

function buildShiftObjects(rt, open, close, brkStart) {
  const shifts = [];
  for (const w of rt) {
    let iv = mergeIntervals(w.intervals);
    if (iv.length === 0) continue;
    // safety: collapse to at most 2 segments
    if (iv.length > 2) iv = [iv[0], [iv[1][0], iv[iv.length - 1][1]]];
    const worked = iv.reduce((s, [a, b]) => s + (b - a), 0);
    let morning = null, afternoon = null;
    if (iv.length === 1) {
      if (iv[0][0] < brkStart) morning = iv[0];
      else afternoon = iv[0];
    } else {
      morning = iv[0];
      afternoon = iv[1];
    }
    const firstStart = iv[0][0];
    const lastEnd = iv[iv.length - 1][1];
    shifts.push({
      employee_id: w.emp.id,
      is_rest: false,
      morning_start: morning ? fromMinutes(morning[0]) : null,
      morning_end: morning ? fromMinutes(morning[1]) : null,
      afternoon_start: afternoon ? fromMinutes(afternoon[0]) : null,
      afternoon_end: afternoon ? fromMinutes(afternoon[1]) : null,
      worked_minutes: worked,
      is_opening: firstStart <= open,
      is_closing: lastEnd >= close,
      is_order: !!w.isOrder,
      role: w._relief ? 'relief' : w === undefined ? 'free' : w.role || 'free',
    });
  }
  return shifts;
}
