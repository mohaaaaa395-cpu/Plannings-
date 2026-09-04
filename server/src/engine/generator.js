import { isoWeekday, isSunday as dateIsSunday, isSaturday, withinRange } from '../dates.js';
import { buildShift, restShift, fullDayMinutes, maxDayMinutes, dayBounds } from './shifts.js';
import { EquityTracker, capacityFor } from './equity.js';
import { scoreCandidate } from './scorer.js';

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

// Is an employee allowed to work on a given date (hard constraints only)?
export function availableOnDate(emp, date, ctx) {
  const wd = isoWeekday(date);
  if (!ctx.config.store.open_days.includes(wd)) return false;
  if (emp.weekend_only && wd < 6) return false;
  const abs = ctx.absencesByEmp[emp.id] || [];
  for (const a of abs) {
    if (withinRange(date, a.start_date, a.end_date)) return false;
  }
  for (const av of emp.availability || []) {
    if (!av.is_hard) continue;
    if (av.kind === 'unavailable' && (av.weekday == null || av.weekday === wd)) return false;
  }
  return true;
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
      const avail = ctx.employees.filter((e) => availableOnDate(e, d.date, ctx));
      if (avail.length === 0) {
        hard.push(`Aucun salarié disponible le ${d.date} alors que le magasin est ouvert.`);
      }
      if (wd === order.weekday && order.require_manager) {
        const mgr = avail.filter((e) => e.is_order_manager);
        if (mgr.length === 0) {
          hard.push(
            `Aucun responsable (Yassine ou Rose) disponible le mardi ${d.date} pour la commande avant ${order.deadline}.`
          );
        }
      }
    }
  }

  for (const emp of ctx.employees) {
    for (const week of ctx.weeks.weeks) {
      const availDates = week.days
        .map((d) => d.date)
        .filter((date) => availableOnDate(emp, date, ctx));
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
    if (s < bestScore) {
      bestScore = s;
      best = item;
    }
  }
  return best;
}

function chooseWorkingDayCount(emp, dates, config) {
  if (dates.length === 0) return 0;
  const maxNonFull = 480; // 8h preferred cap for a normal day
  const minDay = config.shifts.min_day_minutes;
  const kMin = Math.max(1, Math.ceil(emp.contract_minutes / maxNonFull));
  return Math.min(dates.length, kMin);
}

function pickWorkingDays(emp, dates, k, tracker, rng, ctx) {
  if (k >= dates.length) return [...dates];
  const scored = dates.map((date) => {
    const wd = isoWeekday(date);
    let s = rng();
    if (wd === 6 && !emp.weekend_only) s += tracker.fairnessScore(emp, 'saturdays', 1) * 0.4;
    if (wd === 7 && !emp.weekend_only) s += tracker.fairnessScore(emp, 'sundays', 1) * 0.4;
    s += softCostForWorking(emp, date, ctx) * 0.5;
    return { date, s };
  });
  scored.sort((a, b) => a.s - b.s);
  return scored.slice(0, k).map((x) => x.date);
}

function assignAnchors(plan, day, config, tracker, rng) {
  const present = plan.present;
  if (present.length === 1) {
    plan.anchors[present[0].id] = 'full';
    return;
  }
  const needOpen = Math.max(1, config.coverage.min_opening);
  const needClose = Math.max(1, config.coverage.min_closing);
  const used = new Set();
  const openers = [];

  if (plan.orderEmpId) {
    plan.anchors[plan.orderEmpId] = 'open';
    openers.push(plan.orderEmpId);
    used.add(plan.orderEmpId);
  }
  while (openers.length < needOpen) {
    const pool = present.filter((e) => !used.has(e.id));
    if (pool.length === 0) break;
    const pick = pickLowest(
      pool,
      (e) => tracker.fairnessScore(e, 'openings', Math.max(1, e.contract_minutes / 300)) + rng() * 0.3
    );
    plan.anchors[pick.id] = 'open';
    openers.push(pick.id);
    used.add(pick.id);
  }

  const closers = [];
  while (closers.length < needClose) {
    const pool = present.filter((e) => !used.has(e.id));
    if (pool.length === 0) {
      const anyOpener = openers[0];
      if (anyOpener != null) plan.anchors[anyOpener] = 'full';
      break;
    }
    const pick = pickLowest(
      pool,
      (e) => tracker.fairnessScore(e, 'closings', Math.max(1, e.contract_minutes / 300)) + rng() * 0.3
    );
    plan.anchors[pick.id] = 'close';
    closers.push(pick.id);
    used.add(pick.id);
  }

  for (const e of present) {
    if (!plan.anchors[e.id]) plan.anchors[e.id] = 'free';
  }
}

// Distribute one employee's weekly contract across their chosen days,
// accounting for anchor='full' days that are fixed length. Returns a map
// date -> target worked minutes (for non-full days).
function distributeWeekTargets(emp, chosenDates, dayPlan, config) {
  const targets = {};
  const fullDates = chosenDates.filter((d) => dayPlan[d].anchors[emp.id] === 'full');
  const otherDates = chosenDates.filter((d) => dayPlan[d].anchors[emp.id] !== 'full');
  const fixedMin = fullDates.reduce(
    (s, d) => s + fullDayMinutes(config, dateIsSunday(d)),
    0
  );
  let remaining = emp.contract_minutes - fixedMin;
  if (otherDates.length === 0) return targets;
  if (remaining < 0) remaining = otherDates.length * config.shifts.min_day_minutes;

  if (emp.weekend_only) {
    const satR = config.noussia.saturday_ratio;
    const sunR = config.noussia.sunday_ratio;
    const weights = otherDates.map((d) => (isSaturday(d) ? satR : isDateSunday(d) ? sunR : 0.5));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    otherDates.forEach((d, i) => {
      targets[d] = Math.round((remaining * weights[i]) / sum);
    });
  } else {
    const per = Math.round(remaining / otherDates.length);
    otherDates.forEach((d) => {
      targets[d] = per;
    });
  }
  return targets;
}

function isDateSunday(d) {
  return dateIsSunday(d);
}

function maxConsecutive(dates) {
  if (!dates.length) return 0;
  const sorted = [...new Set(dates)].sort();
  let max = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + 'T00:00:00Z').getTime();
    const cur = new Date(sorted[i] + 'T00:00:00Z').getTime();
    if (cur - prev === 86400000) {
      run++;
      max = Math.max(max, run);
    } else {
      run = 1;
    }
  }
  return max;
}

// Build one full 3-week candidate.
function buildCandidate(ctx, seed) {
  const rng = mulberry32(seed);
  const { config } = ctx;
  const tracker = new EquityTracker(ctx.employees, ctx.weightedHistory);

  const availPerWeek = {};
  for (const emp of ctx.employees) {
    availPerWeek[emp.id] = ctx.weeks.weeks.map((week) =>
      week.days.map((d) => d.date).filter((date) => availableOnDate(emp, date, ctx))
    );
  }
  const avgAvailDays = {};
  for (const emp of ctx.employees) {
    const total = availPerWeek[emp.id].reduce((a, w) => a + w.length, 0);
    avgAvailDays[emp.id] = total / 3 || 1;
  }

  const perEmployee = {};
  for (const emp of ctx.employees) {
    perEmployee[emp.id] = {
      plannedMinutesByWeek: [0, 0, 0],
      contributions: {
        saturdays: 0, sundays: 0, weekends: 0, openings: 0, closings: 0,
        worked_minutes: 0, worked_days: 0, long_days: 0,
      },
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

    // 1. choose working days per employee
    const empChosen = {};
    for (const emp of ctx.employees) {
      const dates = availPerWeek[emp.id][wi];
      const k = chooseWorkingDayCount(emp, dates, config);
      empChosen[emp.id] = new Set(pickWorkingDays(emp, dates, k, tracker, rng, ctx));
    }

    // 2. presence per date
    const dayPlan = {};
    for (const d of week.days) {
      if (!config.store.open_days.includes(d.weekday)) {
        dayPlan[d.date] = { present: [], anchors: {}, closed: true };
        continue;
      }
      const present = ctx.employees.filter((e) => empChosen[e.id].has(d.date));
      dayPlan[d.date] = { present, anchors: {}, orderEmpId: null };
    }

    // 3. repair coverage: ensure each open day has >=1 worker
    for (const d of week.days) {
      const plan = dayPlan[d.date];
      if (plan.closed) continue;
      if (plan.present.length === 0) {
        const avail = ctx.employees.filter((e) => availableOnDate(e, d.date, ctx));
        if (avail.length === 0) {
          hardIssues.push(`Aucun salarié disponible le ${d.date}.`);
          continue;
        }
        const chosen = pickLowest(
          avail,
          (e) => perEmployee[e.id].plannedMinutesByWeek[wi] + rng() * 30
        );
        empChosen[chosen.id].add(d.date);
        plan.present.push(chosen);
      }
    }

    // 4. Tuesday order manager present in the morning
    for (const d of week.days) {
      const plan = dayPlan[d.date];
      if (plan.closed) continue;
      if (d.weekday !== config.order.weekday) continue;
      let mgr = plan.present.find((e) => e.is_order_manager);
      if (!mgr && config.order.require_manager) {
        const mgrAvail = ctx.employees.filter(
          (e) => e.is_order_manager && availableOnDate(e, d.date, ctx)
        );
        if (mgrAvail.length === 0) {
          hardIssues.push(`Aucun responsable disponible le mardi ${d.date} pour la commande.`);
          continue;
        }
        mgr = pickLowest(mgrAvail, (e) => tracker.get(e.id, 'worked_minutes') / 1000 + rng());
        empChosen[mgr.id].add(d.date);
        plan.present.push(mgr);
      }
      if (mgr) plan.orderEmpId = mgr.id;
    }

    // 5. anchors
    for (const d of week.days) {
      const plan = dayPlan[d.date];
      if (plan.closed || plan.present.length === 0) continue;
      assignAnchors(plan, d, config, tracker, rng);
    }

    // 5.5 weekly hour distribution per employee
    const weekTargets = {};
    for (const emp of ctx.employees) {
      const chosen = [...empChosen[emp.id]];
      weekTargets[emp.id] = distributeWeekTargets(emp, chosen, dayPlan, config);
    }

    // 6. build shifts
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

      const shifts = [];
      if (!plan.closed) {
        for (const emp of plan.present) {
          const anchor = plan.anchors[emp.id] || 'free';
          let shift;
          if (anchor === 'full') {
            shift = buildShift(config, sunday, 'full', 0);
          } else {
            const target = weekTargets[emp.id][d.date] ?? config.shifts.min_day_minutes;
            shift = buildShift(config, sunday, anchor, target);
          }
          shift.employee_id = emp.id;
          shift.is_order = plan.orderEmpId === emp.id;
          shifts.push(shift);

          const pe = perEmployee[emp.id];
          pe.plannedMinutesByWeek[wi] += shift.worked_minutes;
          pe.contributions.worked_minutes += shift.worked_minutes;
          pe.contributions.worked_days += 1;
          pe.workDates.push(d.date);
          if (shift.is_opening) { pe.contributions.openings += 1; tracker.add(emp.id, 'openings'); }
          if (shift.is_closing) { pe.contributions.closings += 1; tracker.add(emp.id, 'closings'); }
          if (d.weekday === 6) { pe.contributions.saturdays += 1; tracker.add(emp.id, 'saturdays'); }
          if (d.weekday === 7) { pe.contributions.sundays += 1; tracker.add(emp.id, 'sundays'); }
          if (shift.worked_minutes >= config.shifts.long_day_minutes) {
            pe.contributions.long_days += 1; tracker.add(emp.id, 'long_days');
          }
          tracker.add(emp.id, 'worked_minutes', shift.worked_minutes);
          softViolations += softCostForWorking(emp, d.date, ctx);
        }
        for (const emp of ctx.employees) {
          if (!plan.present.find((e) => e.id === emp.id)) {
            const rest = restShift();
            rest.employee_id = emp.id;
            shifts.push(rest);
          }
        }
      } else {
        for (const emp of ctx.employees) {
          const rest = restShift();
          rest.employee_id = emp.id;
          rest.note = 'Magasin fermé';
          shifts.push(rest);
        }
      }

      daysOut.push({
        date: d.date,
        weekday: d.weekday,
        is_sunday: sunday,
        open_time: sunday ? config.store.sunday_open : config.store.weekday_open,
        close_time: sunday ? config.store.sunday_close : config.store.weekday_close,
        events,
        shifts,
      });
    }

    // per-week stats
    for (const emp of ctx.employees) {
      const pe = perEmployee[emp.id];
      const workedThisWeek = week.days.filter((d) => empChosen[emp.id].has(d.date));
      const sat = workedThisWeek.some((d) => d.weekday === 6) ? 1 : 0;
      const sun = workedThisWeek.some((d) => d.weekday === 7) ? 1 : 0;
      const weekend = sat || sun ? 1 : 0;
      pe.contributions.weekends += weekend;
      if (weekend) tracker.add(emp.id, 'weekends');
      let op = 0, cl = 0, ld = 0;
      for (const d of daysOut) {
        const s = d.shifts.find((x) => x.employee_id === emp.id && !x.is_rest);
        if (!s) continue;
        if (s.is_opening) op++;
        if (s.is_closing) cl++;
        if (s.worked_minutes >= config.shifts.long_day_minutes) ld++;
      }
      pe.weekStats.push({
        week_index: week.week_index,
        week_start: week.start_date,
        saturdays: sat,
        sundays: sun,
        weekends: weekend,
        openings: op,
        closings: cl,
        worked_minutes: pe.plannedMinutesByWeek[wi],
        worked_days: workedThisWeek.length,
        long_days: ld,
      });
    }

    outWeeks.push({
      week_index: week.week_index,
      start_date: week.start_date,
      end_date: week.end_date,
      days: daysOut,
    });
  }

  for (const emp of ctx.employees) {
    perEmployee[emp.id].maxConsecutive = maxConsecutive(perEmployee[emp.id].workDates);
  }

  return {
    weeks: outWeeks,
    perEmployee,
    softViolations,
    hardIssues: [...new Set(hardIssues)],
  };
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
    if (!best || evalResult.score > bestEval.score) {
      best = candidate;
      bestEval = evalResult;
    }
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
