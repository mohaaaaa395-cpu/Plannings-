import { query, withTransaction } from '../db.js';
import { loadConfig } from '../config.js';
import { buildThreeWeeks, parseDate } from '../dates.js';
import { loadHistory } from '../engine/equity.js';
import { generate } from '../engine/generator.js';
import { shiftMinutes, toMinutes } from '../time.js';
import { analyzeSchedule } from './analysis.js';

// ---- Load active employees with contract + availability ----
export async function loadEmployees(atDate) {
  const { rows: emps } = await query(
    `SELECT * FROM employees WHERE active = true ORDER BY sort_order, id`
  );
  const ids = emps.map((e) => e.id);
  if (ids.length === 0) return [];

  const { rows: contracts } = await query(
    `SELECT * FROM contracts WHERE employee_id = ANY($1)
     ORDER BY employee_id, effective_from DESC`,
    [ids]
  );
  const { rows: avail } = await query(
    `SELECT * FROM availability WHERE employee_id = ANY($1)`,
    [ids]
  );

  const ref = atDate || new Date().toISOString().slice(0, 10);
  return emps.map((e) => {
    const empContracts = contracts.filter((c) => c.employee_id === e.id);
    // pick contract effective at ref date, else latest
    let contract = empContracts.find(
      (c) =>
        parseDate(c.effective_from).getTime() <= parseDate(ref).getTime() &&
        (!c.effective_to || parseDate(c.effective_to).getTime() >= parseDate(ref).getTime())
    );
    if (!contract) contract = empContracts[0];
    return {
      ...e,
      contract_minutes: contract ? contract.weekly_minutes : 0,
      availability: avail.filter((a) => a.employee_id === e.id),
    };
  });
}

export async function loadAbsences() {
  const { rows } = await query(`SELECT * FROM absences`);
  const byEmp = {};
  for (const a of rows) {
    if (!byEmp[a.employee_id]) byEmp[a.employee_id] = [];
    byEmp[a.employee_id].push(a);
  }
  return byEmp;
}

export async function loadUnavailabilities() {
  const { rows } = await query(`SELECT * FROM unavailabilities`);
  const byEmp = {};
  for (const u of rows) {
    if (!byEmp[u.employee_id]) byEmp[u.employee_id] = [];
    byEmp[u.employee_id].push(u);
  }
  return byEmp;
}

export async function buildContext(startDate) {
  const config = await loadConfig();
  const employees = await loadEmployees(startDate);
  const absencesByEmp = await loadAbsences();
  const unavailabilitiesByEmp = await loadUnavailabilities();
  const weeks = buildThreeWeeks(startDate);
  const { weighted } = await loadHistory(config, startDate);
  return { config, employees, absencesByEmp, unavailabilitiesByEmp, weeks, weightedHistory: weighted };
}

// Generate and (if feasible) persist a draft schedule.
export async function generateDraft(startDate, label, createdBy) {
  const ctx = await buildContext(startDate);
  const result = generate(ctx);
  if (!result.feasible) {
    return {
      feasible: false,
      reasons: result.reasons,
      soft_reasons: result.soft_reasons,
    };
  }

  const scheduleId = await persistCandidate({
    startDate,
    endDate: ctx.weeks.end_date,
    label: label || `Planning ${startDate}`,
    status: 'draft',
    version: 1,
    parentId: null,
    score: result.best.score,
    meta: {
      breakdown: result.best.breakdown,
      penalty: result.best.penalty,
      candidatesTried: result.candidatesTried,
      soft_reasons: result.soft_reasons,
    },
    createdBy,
    weeks: result.best.weeks,
  });

  const full = await getScheduleFull(scheduleId);
  return {
    feasible: true,
    schedule: full,
    score: result.best.score,
    breakdown: result.best.breakdown,
    soft_reasons: result.soft_reasons,
    candidatesTried: result.candidatesTried,
  };
}

export async function persistCandidate(data) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO schedules (label, start_date, end_date, status, version, parent_id, score, meta, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        data.label,
        data.startDate,
        data.endDate,
        data.status,
        data.version,
        data.parentId,
        data.score,
        JSON.stringify(data.meta || {}),
        data.createdBy || null,
      ]
    );
    const scheduleId = rows[0].id;

    for (const week of data.weeks) {
      const { rows: wr } = await client.query(
        `INSERT INTO schedule_weeks (schedule_id, week_index, start_date, end_date)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [scheduleId, week.week_index, week.start_date, week.end_date]
      );
      const weekId = wr[0].id;

      for (const day of week.days) {
        const { rows: dr } = await client.query(
          `INSERT INTO schedule_days (schedule_week_id, date, weekday, is_sunday, open_time, close_time, events)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            weekId,
            day.date,
            day.weekday,
            day.is_sunday,
            day.open_time,
            day.close_time,
            JSON.stringify(day.events || {}),
          ]
        );
        const dayId = dr[0].id;

        for (const s of day.shifts) {
          if (s.is_rest) {
            await client.query(
              `INSERT INTO schedule_shifts (schedule_day_id, employee_id, is_rest, worked_minutes, note)
               VALUES ($1,$2,true,0,$3)`,
              [dayId, s.employee_id, s.note || null]
            );
          } else {
            await client.query(
              `INSERT INTO schedule_shifts
                (schedule_day_id, employee_id, is_rest, morning_start, morning_end,
                 afternoon_start, afternoon_end, worked_minutes, is_opening, is_closing, is_order, role)
               VALUES ($1,$2,false,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
              [
                dayId,
                s.employee_id,
                s.morning_start,
                s.morning_end,
                s.afternoon_start,
                s.afternoon_end,
                s.worked_minutes,
                s.is_opening,
                s.is_closing,
                s.is_order || false,
                s.role || null,
              ]
            );
          }
        }

        if (day.events?.order) {
          await client.query(
            `INSERT INTO orders (schedule_id, date, employee_id, deadline)
             VALUES ($1,$2,$3,$4)`,
            [scheduleId, day.date, day.events.order_employee_id || null, day.events.order_deadline || '12:00']
          );
        }
        if (day.events?.delivery) {
          await client.query(
            `INSERT INTO deliveries (schedule_id, date) VALUES ($1,$2)`,
            [scheduleId, day.date]
          );
        }
      }
    }
    return scheduleId;
  });
}

export async function getScheduleFull(id) {
  const { rows: sched } = await query(`SELECT * FROM schedules WHERE id = $1`, [id]);
  if (sched.length === 0) return null;
  const schedule = sched[0];

  const { rows: weeks } = await query(
    `SELECT * FROM schedule_weeks WHERE schedule_id = $1 ORDER BY week_index`,
    [id]
  );
  const weekIds = weeks.map((w) => w.id);
  const { rows: days } = weekIds.length
    ? await query(
        `SELECT * FROM schedule_days WHERE schedule_week_id = ANY($1) ORDER BY date`,
        [weekIds]
      )
    : { rows: [] };
  const dayIds = days.map((d) => d.id);
  const { rows: shifts } = dayIds.length
    ? await query(
        `SELECT * FROM schedule_shifts WHERE schedule_day_id = ANY($1) ORDER BY id`,
        [dayIds]
      )
    : { rows: [] };
  const { rows: orders } = await query(`SELECT * FROM orders WHERE schedule_id = $1`, [id]);
  const { rows: deliveries } = await query(`SELECT * FROM deliveries WHERE schedule_id = $1`, [id]);

  schedule.weeks = weeks.map((w) => ({
    ...w,
    days: days
      .filter((d) => d.schedule_week_id === w.id)
      .map((d) => ({
        ...d,
        shifts: shifts.filter((s) => s.schedule_day_id === d.id),
      })),
  }));
  schedule.orders = orders;
  schedule.deliveries = deliveries;
  return schedule;
}

// Analyse a stored schedule (stats + alerts) using employees active at its start.
export async function analyzeScheduleId(id) {
  const schedule = await getScheduleFull(id);
  if (!schedule) return null;
  const config = await loadConfig();
  const employees = await loadEmployees(schedule.start_date);
  const analysis = analyzeSchedule(schedule, employees, config);
  return { schedule, analysis, config, employees };
}

// Update a single shift (manual edit). Records an audit entry, never overwrites silently.
export async function updateShift(shiftId, patch, createdBy) {
  const { rows } = await query(`SELECT * FROM schedule_shifts WHERE id = $1`, [shiftId]);
  if (rows.length === 0) throw new Error('Shift introuvable');
  const before = rows[0];

  const { rows: dayRows } = await query(`SELECT * FROM schedule_days WHERE id = $1`, [
    before.schedule_day_id,
  ]);
  const day = dayRows[0];
  const { rows: weekRows } = await query(`SELECT * FROM schedule_weeks WHERE id = $1`, [
    day.schedule_week_id,
  ]);
  const scheduleId = weekRows[0].schedule_id;

  const next = {
    is_rest: patch.is_rest ?? before.is_rest,
    morning_start: patch.morning_start ?? before.morning_start,
    morning_end: patch.morning_end ?? before.morning_end,
    afternoon_start: patch.afternoon_start ?? before.afternoon_start,
    afternoon_end: patch.afternoon_end ?? before.afternoon_end,
    is_order: patch.is_order ?? before.is_order,
    note: patch.note ?? before.note,
    employee_id: patch.employee_id ?? before.employee_id,
  };
  if (next.is_rest) {
    next.morning_start = next.morning_end = next.afternoon_start = next.afternoon_end = null;
    next.is_order = false;
  }
  const worked = next.is_rest ? 0 : shiftMinutes(next);
  const openMin = toMinutes(day.open_time);
  const closeMin = toMinutes(day.close_time);
  const starts = [next.morning_start, next.afternoon_start].filter(Boolean).map(toMinutes);
  const ends = [next.morning_end, next.afternoon_end].filter(Boolean).map(toMinutes);
  const isOpening = !next.is_rest && starts.length > 0 && Math.min(...starts) <= openMin;
  const isClosing = !next.is_rest && ends.length > 0 && Math.max(...ends) >= closeMin;

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE schedule_shifts SET
         is_rest=$1, morning_start=$2, morning_end=$3, afternoon_start=$4, afternoon_end=$5,
         worked_minutes=$6, is_opening=$7, is_closing=$8, is_order=$9, note=$10,
         employee_id=$11, is_manual=true
       WHERE id=$12`,
      [
        next.is_rest, next.morning_start, next.morning_end, next.afternoon_start, next.afternoon_end,
        worked, isOpening, isClosing, next.is_order, next.note, next.employee_id, shiftId,
      ]
    );
    await client.query(
      `INSERT INTO manual_changes (schedule_id, employee_id, date, change_type, before_state, after_state, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        scheduleId,
        next.employee_id,
        day.date,
        'shift_edit',
        JSON.stringify(before),
        JSON.stringify(next),
        createdBy || null,
      ]
    );
    // bump version metadata
    await client.query(
      `UPDATE schedules SET meta = jsonb_set(coalesce(meta,'{}'::jsonb), '{has_manual_changes}', 'true') WHERE id=$1`,
      [scheduleId]
    );
  });

  return { scheduleId };
}

// Validate: mark validated and (re)build equity_statistics from stored shifts.
export async function validateSchedule(id) {
  const schedule = await getScheduleFull(id);
  if (!schedule) throw new Error('Planning introuvable');
  const config = await loadConfig();

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE schedules SET status='validated', validated_at=now() WHERE id=$1`,
      [id]
    );
    await client.query(`DELETE FROM equity_statistics WHERE schedule_id=$1`, [id]);

    for (const week of schedule.weeks) {
      const perEmp = {};
      for (const day of week.days) {
        for (const s of day.shifts) {
          if (s.is_rest) continue;
          if (!perEmp[s.employee_id]) {
            perEmp[s.employee_id] = {
              saturdays: 0, sundays: 0, weekends: 0, openings: 0, closings: 0,
              worked_minutes: 0, worked_days: 0, long_days: 0, weekendFlag: false,
            };
          }
          const acc = perEmp[s.employee_id];
          const mins = shiftMinutes(s);
          acc.worked_minutes += mins;
          acc.worked_days += 1;
          if (s.is_opening) acc.openings += 1;
          if (s.is_closing) acc.closings += 1;
          if (day.weekday === 6) { acc.saturdays += 1; acc.weekendFlag = true; }
          if (day.weekday === 7) { acc.sundays += 1; acc.weekendFlag = true; }
          if (mins >= config.shifts.long_day_minutes) acc.long_days += 1;
        }
      }
      for (const [empId, acc] of Object.entries(perEmp)) {
        await client.query(
          `INSERT INTO equity_statistics
            (schedule_id, employee_id, week_index, week_start, saturdays, sundays, weekends,
             openings, closings, worked_minutes, worked_days, long_days)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            id, Number(empId), week.week_index, week.start_date,
            acc.saturdays, acc.sundays, acc.weekendFlag ? 1 : 0,
            acc.openings, acc.closings, acc.worked_minutes, acc.worked_days, acc.long_days,
          ]
        );
      }
    }
  });

  return getScheduleFull(id);
}

export async function duplicateSchedule(id, createdBy) {
  const schedule = await getScheduleFull(id);
  if (!schedule) throw new Error('Planning introuvable');
  const weeks = schedule.weeks.map((w) => ({
    week_index: w.week_index,
    start_date: w.start_date,
    end_date: w.end_date,
    days: w.days.map((d) => ({
      date: d.date,
      weekday: d.weekday,
      is_sunday: d.is_sunday,
      open_time: d.open_time,
      close_time: d.close_time,
      events: d.events,
      shifts: d.shifts.map((s) => ({ ...s })),
    })),
  }));
  const newId = await persistCandidate({
    startDate: schedule.start_date,
    endDate: schedule.end_date,
    label: `${schedule.label} (copie)`,
    status: 'draft',
    version: (schedule.version || 1) + 1,
    parentId: schedule.id,
    score: schedule.score,
    meta: { ...(schedule.meta || {}), duplicated_from: schedule.id },
    createdBy,
    weeks,
  });
  return getScheduleFull(newId);
}

export async function setStatus(id, status) {
  await query(`UPDATE schedules SET status=$1 WHERE id=$2`, [status, id]);
  return getScheduleFull(id);
}

export async function deleteSchedule(id) {
  await query(`DELETE FROM schedules WHERE id=$1`, [id]);
}

export async function listSchedules() {
  const { rows } = await query(
    `SELECT s.*,
       (SELECT count(*) FROM manual_changes mc WHERE mc.schedule_id = s.id)::int AS manual_changes_count
     FROM schedules s ORDER BY s.start_date DESC, s.id DESC`
  );
  return rows;
}
