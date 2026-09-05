import { isoWeekday, isSunday as dateIsSunday, isSaturday, addDays, formatDate } from '../dates.js';
import { restShift, maxDayMinutes, dayBounds } from './shifts.js';
import { EquityTracker, capacityFor } from './equity.js';
import { scoreCandidate } from './scorer.js';
import { computeWindows, buildDayShifts, findGaps } from './coverage.js';
import { toMinutes, fromMinutes } from '../time.js';

// Seeded PRNG (mulberry32) for reproducible, diverse candidates.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// An employee can work a date iff they have at least one availability window.
export function availableOnDate(emp, date, ctx) {
  return computeWindows(emp, date, ctx).length > 0;
}

// A manager can perform the Tuesday order iff a window starts before the deadline.
function canDoOrder(emp, date, ctx) {
  const deadline = toMinutes(ctx.config.order.deadline);
  return computeWindows(emp, date, ctx).some((win) => win[0] < deadline);
}

function softCostForWorking(emp, date, ctx) {
  const wd = isoWeekday(date);
  let cost = 0;
  for (const av of emp.availability || []) {
    if (av.is_hard) continue;
    if (av.kind === 'avoid' && (av.weekday == null || av.weekday === wd)) cost += 1;
  }
  return cost;
}

// Structural feasibility analysis. Returns { hard: [...], soft: [...] }.
export function analyzeFeasibility(ctx) {
  const hard = [];
  const soft = [];
  const order = ctx.config.order;

  for (const week of ctx.weeks.weeks) {
    for (const d of week.days) {
      const wd = d.weekday;
      if (!ctx.config.store.open_days.includes(wd)) continue;
      const { open, close } = dayBounds(ctx.config, dateIsSunday(d.date));

      const avail = ctx.employees.filter((e) => availableOnDate(e, d.date, ctx));
      if (avail.length === 0) {
        hard.push(`Aucun salarié disponible le ${d.date} alors que le magasin est ouvert.`);
        continue;
      }
      // Continuous coverage feasibility: union of all available windows must
      // cover the full opening range.
      const allWindows = [];
      for (const e of avail) allWindows.push(...computeWindows(e, d.date, ctx));
      const gaps = findGaps(allWindows, open, close);
      if (gaps.length > 0) {
        const g = gaps[0];
        hard.push(
          `Couverture impossible le ${d.date} : le magasin ne peut pas être tenu de ` +
            `${fromMinutes(g[0])} à ${fromMinutes(g[1])} (aucun salarié disponible sur ce créneau).`
        );
      }
      if (wd === order.weekday && order.require_manager) {
        const mgr = avail.filter((e) => e.is_order_manager && canDoOrder(e, d.date, ctx));
        if (mgr.length === 0) {
          hard.push(
            `Aucun responsable (Yassine ou Rose) disponible le mardi ${d.date} avant ${order.deadline} pour la commande.`
          );
        }
      }
    }
  }

  for (const emp of ctx.employees) {
    for (const week of ctx.weeks.weeks) {
      const availDates = week.days.map((d) => d.date).filter((date) => availableOnDate(emp, date, ctx));
      const maxPossible = availDates.reduce(
        (sum, date) => sum + maxDayMinutes(ctx.config, dateIsSunday(date)),
        0
      );
      if (maxPossible < emp.contract_minutes - ctx.config.generator.hours_tolerance_minutes) {
        soft.push(
          `${emp.name} : ${(emp.contract_minutes / 60).toFixed(1)}h contractuelles mais seulement ` +
            `${(maxPossible / 60).toFixed(1)}h réalisables (semaine du ${week.start_date}).`
        );
      }
    }
  }

  return { hard: [...new Set(hard)], soft: [...new Set(soft)] };
}

function pickLowest(list, scoreFn) {
  let best = null;
  let bestScore = Infinity;
  for (const item of list) {
    const s = scoreFn(item);
    if (s < bestScore) { bestScore = s; best = item; }
  }
  return best;
}

// Minimum rest days per week for an employee (per-employee override wins).
function minRestFor(emp, config) {
  const p = emp.preferences && emp.preferences.min_rest_days;
  if (p != null) return p;
  return config.rest && config.rest.min_days_per_week != null ? config.rest.min_days_per_week : 0;
}
// Maximum working days per week (hard cap) = week length - guaranteed rest,
// never more than the days the employee is actually available.
function workCapFor(emp, availCount, config) {
  const weekDays = config.store.open_days.length || 7;
  const cap = weekDays - minRestFor(emp, config);
  return Math.min(availCount, Math.max(1, cap));
}

function chooseWorkingDayCount(emp, dates, config) {
  if (dates.length === 0) return 0;
  const maxNonFull = 480;
  const kMin = Math.max(1, Math.ceil(emp.contract_minutes / maxNonFull));
  return Math.min(dates.length, kMin, workCapFor(emp, dates.length, config));
}

function shiftDate(date, delta) { return formatDate(addDays(date, delta)); }
// Would adding `date` to `set` keep the consecutive-working-day run <= max?
function runOk(set, date, max) {
  if (!max || max <= 0) return true;
  let len = 1;
  let cur = date;
  for (;;) { cur = shiftDate(cur, -1); if (set.has(cur)) len++; else break; }
  cur = date;
  for (;;) { cur = shiftDate(cur, 1); if (set.has(cur)) len++; else break; }
  return len <= max;
}

// Pick working days for the week — equity/random biased, but never creating a
// consecutive run longer than maxConsec (checked against days already assigned
// in previous weeks + the ones picked here).
function pickWorkingDays(emp, dates, k, tracker, rng, ctx, priorSet, maxConsec) {
  const scored = dates.map((date) => {
    const wd = isoWeekday(date);
    let s = rng();
    if (wd === 6 && !emp.weekend_only) s += tracker.fairnessScore(emp, 'saturdays', 1) * 0.4;
    if (wd === 7 && !emp.weekend_only) s += tracker.fairnessScore(emp, 'sundays', 1) * 0.4;
    s += softCostForWorking(emp, date, ctx) * 0.5;
    return { date, s };
  });
  scored.sort((a, b) => a.s - b.s);
  const acc = new Set(priorSet || []);
  const chosen = [];
  for (const { date } of scored) {
    if (chosen.length >= k) break;
    if (!runOk(acc, date, maxConsec)) continue;
    chosen.push(date);
    acc.add(date);
  }
  return chosen;
}

// Distribute an employee's weekly contract across chosen days (hints only;
// the coverage builder adjusts real worked time). Returns date -> minutes.
function distributeWeekTargets(emp, chosenDates, config) {
  const targets = {};
  if (chosenDates.length === 0) return targets;
  const minDay = config.shifts.min_day_minutes;
  if (emp.weekend_only) {
    const satR = config.noussia.saturday_ratio;
    const sunR = config.noussia.sunday_ratio;
    const weights = chosenDates.map((d) => (isSaturday(d) ? satR : dateIsSunday(d) ? sunR : 0.5));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    chosenDates.forEach((d, i) => {
      targets[d] = clamp(Math.round((emp.contract_minutes * weights[i]) / sum), minDay, maxDayMinutes(config, dateIsSunday(d)));
    });
  } else {
    const per = Math.round(emp.contract_minutes / chosenDates.length);
    chosenDates.forEach((d) => {
      targets[d] = clamp(per, minDay, maxDayMinutes(config, dateIsSunday(d)));
    });
  }
  return targets;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }

function maxConsecutive(dates) {
  if (!dates.length) return 0;
  const sorted = [...new Set(dates)].sort();
  let max = 1, run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + 'T00:00:00Z').getTime();
    const cur = new Date(sorted[i] + 'T00:00:00Z').getTime();
    if (cur - prev === 86400000) { run++; max = Math.max(max, run); } else { run = 1; }
  }
  return max;
}

function buildCandidate(ctx, seed) {
  const rng = mulberry32(seed);
  const { config } = ctx;
  const tracker = new EquityTracker(ctx.employees, ctx.weightedHistory);
  const maxConsec = config.rest?.max_consecutive_days ?? 0;
  // Days each employee is assigned across the WHOLE 3-week window (for the
  // continuous consecutive-day limit, which spans week boundaries).
  const assignedAll = {};
  for (const emp of ctx.employees) assignedAll[emp.id] = new Set();

  // precompute windows per employee per date
  const windowsPerDate = {};
  for (const emp of ctx.employees) {
    windowsPerDate[emp.id] = {};
    for (const week of ctx.weeks.weeks) {
      for (const d of week.days) windowsPerDate[emp.id][d.date] = computeWindows(emp, d.date, ctx);
    }
  }
  const availOn = (emp, date) => windowsPerDate[emp.id][date].length > 0;

  const availPerWeek = {};
  for (const emp of ctx.employees) {
    availPerWeek[emp.id] = ctx.weeks.weeks.map((week) =>
      week.days.map((d) => d.date).filter((date) => availOn(emp, date))
    );
  }
  const avgAvailDays = {};
  for (const emp of ctx.employees) {
    avgAvailDays[emp.id] = availPerWeek[emp.id].reduce((a, w) => a + w.length, 0) / 3 || 1;
  }

  const perEmployee = {};
  for (const emp of ctx.employees) {
    perEmployee[emp.id] = {
      plannedMinutesByWeek: [0, 0, 0],
      contributions: { saturdays: 0, sundays: 0, weekends: 0, openings: 0, closings: 0, worked_minutes: 0, worked_days: 0, long_days: 0 },
      weekStats: [],
      capacity: {
        saturdays: capacityFor('saturdays', emp, avgAvailDays[emp.id]),
        sundays: capacityFor('sundays', emp, avgAvailDays[emp.id]),
        openings: capacityFor('openings', emp, avgAvailDays[emp.id]),
        closings: capacityFor('closings', emp, avgAvailDays[emp.id]),
      },
      workDates: [],
      maxConsecutive: 0,
    };
  }

  let softViolations = 0;
  const hardIssues = [];
  const outWeeks = [];

  for (let wi = 0; wi < ctx.weeks.weeks.length; wi++) {
    const week = ctx.weeks.weeks[wi];

    // 1. choose working days per employee (rest cap + consecutive-day limit)
    const empChosen = {};
    const cap = {};
    const workSet = {};
    for (const emp of ctx.employees) {
      const dates = availPerWeek[emp.id][wi];
      cap[emp.id] = workCapFor(emp, dates.length, config);
      const k = chooseWorkingDayCount(emp, dates, config);
      const chosen = pickWorkingDays(emp, dates, k, tracker, rng, ctx, assignedAll[emp.id], maxConsec);
      empChosen[emp.id] = new Set(chosen);
      workSet[emp.id] = new Set(chosen);
      for (const d of chosen) assignedAll[emp.id].add(d);
    }
    const underCap = (e, date) => workSet[e.id].has(date) || workSet[e.id].size < cap[e.id];
    const consecOk = (e, date) => workSet[e.id].has(date) || runOk(assignedAll[e.id], date, maxConsec);

    // 2. presence per date + ensure at least one worker (within all limits)
    const dayPlan = {};
    for (const d of week.days) {
      if (!config.store.open_days.includes(d.weekday)) { dayPlan[d.date] = { closed: true }; continue; }
      const present = ctx.employees.filter((e) => empChosen[e.id].has(d.date));
      dayPlan[d.date] = { present, orderEmpId: null };
      if (present.length === 0) {
        const avail = ctx.employees.filter((e) => availOn(e, d.date) && workSet[e.id].size < cap[e.id] && consecOk(e, d.date));
        if (avail.length === 0) {
          const anyAvail = ctx.employees.some((e) => availOn(e, d.date));
          hardIssues.push(anyAvail
            ? `Impossible de couvrir le ${d.date} sans dépasser les limites de repos / jours consécutifs.`
            : `Aucun salarié disponible le ${d.date}.`);
          continue;
        }
        const chosen = pickLowest(avail, (e) => perEmployee[e.id].plannedMinutesByWeek[wi] + rng() * 30);
        empChosen[chosen.id].add(d.date); workSet[chosen.id].add(d.date); assignedAll[chosen.id].add(d.date);
        present.push(chosen);
      }
    }

    // 3. Tuesday order: ensure a manager present who can order before deadline
    for (const d of week.days) {
      const plan = dayPlan[d.date];
      if (plan.closed) continue;
      if (d.weekday !== config.order.weekday) continue;
      let mgr = plan.present.find((e) => e.is_order_manager && canDoOrder(e, d.date, ctx));
      if (!mgr && config.order.require_manager) {
        const mgrAvail = ctx.employees.filter(
          (e) => e.is_order_manager && canDoOrder(e, d.date, ctx) && underCap(e, d.date) && consecOk(e, d.date)
        );
        if (mgrAvail.length === 0) { hardIssues.push(`Aucun responsable disponible le mardi ${d.date} pour la commande (repos / jours consécutifs).`); continue; }
        mgr = pickLowest(mgrAvail, (e) => tracker.get(e.id, 'worked_minutes') / 1000 + rng());
        empChosen[mgr.id].add(d.date); workSet[mgr.id].add(d.date); assignedAll[mgr.id].add(d.date);
        plan.present.push(mgr);
      }
      if (mgr) plan.orderEmpId = mgr.id;
    }

    // 4. weekly hour hints
    const weekTargets = {};
    for (const emp of ctx.employees) {
      weekTargets[emp.id] = distributeWeekTargets(emp, [...empChosen[emp.id]], config);
    }

    // 5. build each day with guaranteed continuous coverage
    const daysOut = [];
    for (const d of week.days) {
      const plan = dayPlan[d.date];
      const sunday = dateIsSunday(d.date);
      const events = {};
      if (d.weekday === config.order.weekday) {
        events.order = true;
        events.order_employee_id = plan.orderEmpId || null;
        events.order_deadline = config.order.deadline;
      }
      if (config.deliveries.weekdays.includes(d.weekday)) events.delivery = true;

      const dayMeta = {
        date: d.date, weekday: d.weekday, is_sunday: sunday,
        open_time: sunday ? config.store.sunday_open : config.store.weekday_open,
        close_time: sunday ? config.store.sunday_close : config.store.weekday_close,
      };

      let shifts = [];
      let coverageOk = true;
      if (!plan.closed) {
        const chosenIds = new Set(plan.present.map((e) => e.id));
        const workers = plan.present.map((e) => ({
          emp: e,
          windows: windowsPerDate[e.id][d.date],
          target: weekTargets[e.id][d.date] ?? config.shifts.min_day_minutes,
          isOrder: plan.orderEmpId === e.id,
          openScore: tracker.fairnessScore(e, 'openings', Math.max(1, e.contract_minutes / 300)) + rng() * 0.2,
          closeScore: tracker.fairnessScore(e, 'closings', Math.max(1, e.contract_minutes / 300)) + rng() * 0.2,
        }));
        const extra = ctx.employees
          .filter((e) => !chosenIds.has(e.id) && windowsPerDate[e.id][d.date].length > 0 && workSet[e.id].size < cap[e.id] && consecOk(e, d.date))
          .map((e) => ({ emp: e, windows: windowsPerDate[e.id][d.date] }));

        const res = buildDayShifts(config, dayMeta, workers, extra, rng);
        shifts = res.shifts;
        coverageOk = res.covered;
        for (const id of res.addedEmpIds || []) { if (workSet[id]) { workSet[id].add(d.date); assignedAll[id].add(d.date); } }
        if (!res.covered && res.gap) {
          const blockedByLimit = ctx.employees.some(
            (e) => !chosenIds.has(e.id) && windowsPerDate[e.id][d.date].length > 0 &&
              (workSet[e.id].size >= cap[e.id] || !consecOk(e, d.date))
          );
          hardIssues.push(blockedByLimit
            ? `Impossible de couvrir le ${d.date} de ${fromMinutes(res.gap[0])} à ${fromMinutes(res.gap[1])} sans dépasser les limites de repos / jours consécutifs.`
            : `Couverture non assurée le ${d.date} de ${fromMinutes(res.gap[0])} à ${fromMinutes(res.gap[1])}.`);
        }
        // rest entries for employees with no shift this day
        const working = new Set(shifts.map((s) => s.employee_id));
        for (const emp of ctx.employees) {
          if (!working.has(emp.id)) { const r = restShift(); r.employee_id = emp.id; shifts.push(r); }
        }
      } else {
        for (const emp of ctx.employees) { const r = restShift(); r.employee_id = emp.id; r.note = 'Magasin fermé'; shifts.push(r); }
      }

      daysOut.push({ ...dayMeta, events, shifts, coverage_ok: coverageOk });
    }

    // 6. per-week stats from actual output
    for (const emp of ctx.employees) {
      const pe = perEmployee[emp.id];
      let op = 0, cl = 0, ld = 0, worked = 0, days = 0, sat = 0, sun = 0;
      for (const d of daysOut) {
        const s = d.shifts.find((x) => x.employee_id === emp.id && !x.is_rest);
        if (!s) continue;
        worked += s.worked_minutes; days += 1;
        if (s.is_opening) op++;
        if (s.is_closing) cl++;
        if (s.worked_minutes >= config.shifts.long_day_minutes) ld++;
        if (d.weekday === 6) sat = 1;
        if (d.weekday === 7) sun = 1;
        pe.workDates.push(d.date);
        softViolations += softCostForWorking(emp, d.date, ctx);
      }
      const weekend = sat || sun ? 1 : 0;
      pe.plannedMinutesByWeek[wi] = worked;
      pe.contributions.worked_minutes += worked;
      pe.contributions.worked_days += days;
      pe.contributions.openings += op;
      pe.contributions.closings += cl;
      pe.contributions.long_days += ld;
      pe.contributions.saturdays += sat;
      pe.contributions.sundays += sun;
      pe.contributions.weekends += weekend;
      // feed the within-run equity tracker
      tracker.add(emp.id, 'openings', op);
      tracker.add(emp.id, 'closings', cl);
      tracker.add(emp.id, 'saturdays', sat);
      tracker.add(emp.id, 'sundays', sun);
      tracker.add(emp.id, 'long_days', ld);
      tracker.add(emp.id, 'weekends', weekend);
      tracker.add(emp.id, 'worked_minutes', worked);
      pe.weekStats.push({
        week_index: week.week_index, week_start: week.start_date,
        saturdays: sat, sundays: sun, weekends: weekend,
        openings: op, closings: cl, worked_minutes: worked, worked_days: days, long_days: ld,
      });
    }

    outWeeks.push({ week_index: week.week_index, start_date: week.start_date, end_date: week.end_date, days: daysOut });
  }

  for (const emp of ctx.employees) {
    perEmployee[emp.id].maxConsecutive = maxConsecutive(perEmployee[emp.id].workDates);
  }

  return { weeks: outWeeks, perEmployee, softViolations, hardIssues: [...new Set(hardIssues)] };
}

export function generate(ctx) {
  const feas = analyzeFeasibility(ctx);
  if (feas.hard.length > 0) {
    return { feasible: false, reasons: feas.hard, soft_reasons: feas.soft, best: null, candidatesTried: 0 };
  }

  const n = Math.max(4, ctx.config.generator.candidates || 40);
  let best = null;
  let bestEval = null;
  for (let i = 0; i < n; i++) {
    const candidate = buildCandidate(ctx, 1000 + i * 7919 + (ctx.seedOffset || 0));
    const evalResult = scoreCandidate(candidate, ctx);
    // prefer candidates with no hard issues, then higher score
    const better =
      !best ||
      (candidate.hardIssues.length === 0 && best.hardIssues.length > 0) ||
      (candidate.hardIssues.length === best.hardIssues.length && evalResult.score > bestEval.score);
    if (better) { best = candidate; bestEval = evalResult; }
  }

  const hardErrors = bestEval.alerts.filter((a) => a.level === 'error');
  return {
    feasible: hardErrors.length === 0 && best.hardIssues.length === 0,
    reasons: [...new Set(best.hardIssues)],
    soft_reasons: feas.soft,
    best: { ...bestEval, weeks: best.weeks, perEmployee: best.perEmployee },
    candidatesTried: n,
  };
}
