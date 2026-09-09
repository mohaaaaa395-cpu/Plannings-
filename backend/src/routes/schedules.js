import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { loadConfig } from '../config.js';
import { normalizeTime, formatDuration } from '../time.js';
import { buildScheduleWorkbook } from '../services/exportExcel.js';
import {
  generateDraft,
  getScheduleFull,
  analyzeScheduleId,
  updateShift,
  validateSchedule,
  duplicateSchedule,
  setStatus,
  deleteSchedule,
  listSchedules,
  loadEmployees,
} from '../services/schedules.js';
import { analyzeSchedule } from '../services/analysis.js';
import { buildWeeks } from '../dates.js';

const router = express.Router();
router.use(requireAuth);

// Preview the date structure for a start date and week count (no generation).
router.get('/preview-dates', async (req, res) => {
  const start = req.query.start_date;
  if (!start) return res.status(400).json({ error: 'start_date requis' });
  const weeks = Math.max(1, Math.min(3, Number(req.query.weeks) || 3));
  res.json(buildWeeks(start, weeks));
});

// Generate a new draft planning (persisted only if feasible).
router.post('/generate', async (req, res) => {
  const b = req.body || {};
  if (!b.start_date) return res.status(400).json({ error: 'Date de début requise' });

  // Warn about existing schedules with manual changes for the same window.
  const { rows: existing } = await query(
    `SELECT s.id, s.label,
        (SELECT count(*) FROM manual_changes mc WHERE mc.schedule_id = s.id)::int AS mc
     FROM schedules s WHERE s.start_date = $1`,
    [b.start_date]
  );
  const manualWarnings = existing
    .filter((e) => e.mc > 0)
    .map((e) => `Le planning #${e.id} (${e.label}) contient ${e.mc} modification(s) manuelle(s) qui ne seront pas reprises dans cette nouvelle génération.`);

  const overtimeMinutes = Math.max(0, Math.round((Number(b.overtime_hours) || 0) * 60));
  const weeksCount = Math.max(1, Math.min(3, Number(b.weeks) || 3));
  const result = await generateDraft(b.start_date, b.label, req.user?.username, overtimeMinutes, weeksCount);
  if (!result.feasible) {
    return res.status(200).json({ feasible: false, ...result, manual_warnings: manualWarnings });
  }
  const { analysis } = await analyzeScheduleId(result.schedule.id);
  res.json({ feasible: true, ...result, analysis, manual_warnings: manualWarnings });
});

// History list.
router.get('/', async (req, res) => {
  res.json(await listSchedules());
});

// Dashboard: current planning + global stats.
router.get('/dashboard', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  let { rows } = await query(
    `SELECT id FROM schedules
      WHERE status IN ('validated','draft') AND start_date <= $1 AND end_date >= $1
      ORDER BY status='validated' DESC, id DESC LIMIT 1`,
    [today]
  );
  if (rows.length === 0) {
    ({ rows } = await query(
      `SELECT id FROM schedules ORDER BY status='validated' DESC, start_date DESC, id DESC LIMIT 1`
    ));
  }
  if (rows.length === 0) return res.json({ schedule: null });
  const data = await analyzeScheduleId(rows[0].id);
  res.json({ schedule: data.schedule, analysis: data.analysis });
});

// Full schedule + analysis.
router.get('/:id', async (req, res) => {
  const data = await analyzeScheduleId(Number(req.params.id));
  if (!data) return res.status(404).json({ error: 'Planning introuvable' });
  const { rows: manual } = await query(
    `SELECT * FROM manual_changes WHERE schedule_id=$1 ORDER BY created_at DESC`,
    [Number(req.params.id)]
  );
  res.json({ ...data, manual_changes: manual });
});

// Edit a shift (manual change).
router.put('/shifts/:shiftId', async (req, res) => {
  const b = req.body || {};
  const patch = {
    is_rest: b.is_rest,
    morning_start: b.morning_start === undefined ? undefined : normalizeTime(b.morning_start),
    morning_end: b.morning_end === undefined ? undefined : normalizeTime(b.morning_end),
    afternoon_start: b.afternoon_start === undefined ? undefined : normalizeTime(b.afternoon_start),
    afternoon_end: b.afternoon_end === undefined ? undefined : normalizeTime(b.afternoon_end),
    is_order: b.is_order,
    note: b.note,
    employee_id: b.employee_id,
  };
  try {
    const { scheduleId } = await updateShift(Number(req.params.shiftId), patch, req.user?.username);
    const data = await analyzeScheduleId(scheduleId);
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:id/validate', async (req, res) => {
  try {
    const full = await validateSchedule(Number(req.params.id));
    const data = await analyzeScheduleId(full.id);
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:id/duplicate', async (req, res) => {
  const full = await duplicateSchedule(Number(req.params.id), req.user?.username);
  res.json(full);
});

router.post('/:id/archive', async (req, res) => {
  res.json(await setStatus(Number(req.params.id), 'archived'));
});

router.post('/:id/status', async (req, res) => {
  const status = (req.body || {}).status;
  if (!['draft', 'validated', 'archived'].includes(status)) {
    return res.status(400).json({ error: 'Statut invalide' });
  }
  res.json(await setStatus(Number(req.params.id), status));
});

router.delete('/:id', async (req, res) => {
  await deleteSchedule(Number(req.params.id));
  res.json({ ok: true });
});

// ---- Excel export ----
router.get('/:id/export.xlsx', async (req, res) => {
  const schedule = await getScheduleFull(Number(req.params.id));
  if (!schedule) return res.status(404).json({ error: 'Planning introuvable' });
  const config = await loadConfig();
  const employees = await loadEmployees(schedule.start_date);
  const analysis = analyzeSchedule(schedule, employees, config);

  // Main sheet in the store's own template layout.
  const wb = buildScheduleWorkbook(schedule, employees, config);

  // Bonus recap sheet (stats per employee).
  const sum = wb.addWorksheet('Récapitulatif');
  sum.columns = [
    { header: 'Salarié', width: 16 },
    { header: 'Heures prévues (moy./sem.)', width: 24 },
    { header: 'Contrat', width: 12 },
    { header: 'Écart', width: 12 },
    { header: 'Samedis', width: 10 },
    { header: 'Dimanches', width: 10 },
    { header: 'Ouvertures', width: 12 },
    { header: 'Fermetures', width: 12 },
  ];
  sum.getRow(1).font = { bold: true };
  for (const pe of analysis.perEmployee) {
    sum.addRow([
      pe.name,
      formatDuration(pe.weekly_avg),
      formatDuration(pe.contract_minutes),
      formatDuration(pe.contract_diff),
      pe.saturdays,
      pe.sundays,
      pe.openings,
      pe.closings,
    ]);
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="planning-${schedule.start_date}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

export default router;
