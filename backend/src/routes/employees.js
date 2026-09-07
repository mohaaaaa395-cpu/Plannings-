import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { normalizeTime } from '../time.js';
import { loadEmployees } from '../services/schedules.js';

const router = express.Router();
router.use(requireAuth);

// List employees with active contract + availability.
router.get('/', async (req, res) => {
  const employees = await loadEmployees(req.query.date);
  res.json(employees);
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const { rows } = await query(
    `INSERT INTO employees (name, position, has_keys, is_order_manager, weekend_only, color, preferences, sort_order, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING *`,
    [
      b.name,
      b.position || 'Employé(e)',
      b.has_keys ?? true,
      b.is_order_manager ?? false,
      b.weekend_only ?? false,
      b.color || '#2563eb',
      JSON.stringify(b.preferences || {}),
      b.sort_order || 99,
    ]
  );
  const emp = rows[0];
  const minutes = Math.round((b.weekly_hours ?? 35) * 60);
  await query(
    `INSERT INTO contracts (employee_id, weekly_minutes, note) VALUES ($1,$2,$3)`,
    [emp.id, minutes, 'Contrat initial']
  );
  res.json(emp);
});

router.put('/:id', async (req, res) => {
  const b = req.body || {};
  const id = Number(req.params.id);
  const { rows } = await query(
    `UPDATE employees SET
       name=COALESCE($2,name), position=COALESCE($3,position),
       has_keys=COALESCE($4,has_keys), is_order_manager=COALESCE($5,is_order_manager),
       weekend_only=COALESCE($6,weekend_only), color=COALESCE($7,color),
       preferences=COALESCE($8,preferences), sort_order=COALESCE($9,sort_order),
       active=COALESCE($10,active)
     WHERE id=$1 RETURNING *`,
    [
      id, b.name, b.position, b.has_keys, b.is_order_manager, b.weekend_only,
      b.color, b.preferences ? JSON.stringify(b.preferences) : null, b.sort_order, b.active,
    ]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Introuvable' });

  // Optional: update contract if weekly_hours changed
  if (b.weekly_hours != null) {
    const minutes = Math.round(b.weekly_hours * 60);
    const { rows: cur } = await query(
      `SELECT * FROM contracts WHERE employee_id=$1 ORDER BY effective_from DESC LIMIT 1`,
      [id]
    );
    if (!cur[0] || cur[0].weekly_minutes !== minutes) {
      await query(
        `INSERT INTO contracts (employee_id, weekly_minutes, note) VALUES ($1,$2,$3)`,
        [id, minutes, 'Mise à jour du contrat']
      );
    }
  }
  res.json(rows[0]);
});

// Soft delete (preserve history).
router.delete('/:id', async (req, res) => {
  await query(`UPDATE employees SET active=false WHERE id=$1`, [Number(req.params.id)]);
  res.json({ ok: true });
});

// ---- Contract history ----
router.get('/:id/contracts', async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM contracts WHERE employee_id=$1 ORDER BY effective_from DESC`,
    [Number(req.params.id)]
  );
  res.json(rows);
});

router.post('/:id/contracts', async (req, res) => {
  const b = req.body || {};
  const minutes = Math.round((b.weekly_hours ?? 35) * 60);
  const { rows } = await query(
    `INSERT INTO contracts (employee_id, weekly_minutes, effective_from, note)
     VALUES ($1,$2,COALESCE($3,CURRENT_DATE),$4) RETURNING *`,
    [Number(req.params.id), minutes, b.effective_from || null, b.note || null]
  );
  res.json(rows[0]);
});

// ---- Availability ----
router.get('/:id/availability', async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM availability WHERE employee_id=$1 ORDER BY weekday NULLS FIRST, id`,
    [Number(req.params.id)]
  );
  res.json(rows);
});

router.post('/:id/availability', async (req, res) => {
  const b = req.body || {};
  const { rows } = await query(
    `INSERT INTO availability (employee_id, weekday, kind, is_hard, start_time, end_time, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      Number(req.params.id),
      b.weekday ?? null,
      b.kind || 'unavailable',
      b.is_hard ?? true,
      normalizeTime(b.start_time),
      normalizeTime(b.end_time),
      b.note || null,
    ]
  );
  res.json(rows[0]);
});

router.delete('/:id/availability/:availId', async (req, res) => {
  await query(`DELETE FROM availability WHERE id=$1 AND employee_id=$2`, [
    Number(req.params.availId),
    Number(req.params.id),
  ]);
  res.json({ ok: true });
});

export default router;
