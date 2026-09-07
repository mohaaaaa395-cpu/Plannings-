import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { normalizeTime } from '../time.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT u.*, e.name AS employee_name, e.color AS employee_color
       FROM unavailabilities u JOIN employees e ON e.id = u.employee_id
      ORDER BY u.date DESC NULLS LAST, u.weekday NULLS LAST, u.id DESC`
  );
  res.json(rows);
});

function parseBody(b) {
  const all_day = b.all_day ?? true;
  const start = all_day ? null : normalizeTime(b.start_time);
  const end = all_day ? null : normalizeTime(b.end_time);
  return {
    employee_id: b.employee_id ? Number(b.employee_id) : null,
    date: b.date || null,
    weekday: b.weekday != null && b.weekday !== '' ? Number(b.weekday) : null,
    all_day,
    start_time: start,
    end_time: end,
    reason: b.reason || null,
  };
}

router.post('/', async (req, res) => {
  const b = parseBody(req.body || {});
  if (!b.employee_id) return res.status(400).json({ error: 'Salarié requis' });
  if (!b.date && b.weekday == null) return res.status(400).json({ error: 'Une date ou un jour de la semaine est requis' });
  if (!b.all_day && (!b.start_time || !b.end_time)) {
    return res.status(400).json({ error: 'Plage horaire invalide (début et fin requis)' });
  }
  if (!b.all_day && b.start_time >= b.end_time) {
    return res.status(400).json({ error: "L'heure de fin doit être après l'heure de début" });
  }
  const { rows } = await query(
    `INSERT INTO unavailabilities (employee_id, date, weekday, all_day, start_time, end_time, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [b.employee_id, b.date, b.weekday, b.all_day, b.start_time, b.end_time, b.reason]
  );
  res.json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const b = parseBody(req.body || {});
  if (!b.all_day && (!b.start_time || !b.end_time)) {
    return res.status(400).json({ error: 'Plage horaire invalide' });
  }
  const { rows } = await query(
    `UPDATE unavailabilities SET
       employee_id=COALESCE($2,employee_id), date=$3, weekday=$4,
       all_day=$5, start_time=$6, end_time=$7, reason=$8
     WHERE id=$1 RETURNING *`,
    [Number(req.params.id), b.employee_id, b.date, b.weekday, b.all_day, b.start_time, b.end_time, b.reason]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Introuvable' });
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  await query(`DELETE FROM unavailabilities WHERE id=$1`, [Number(req.params.id)]);
  res.json({ ok: true });
});

export default router;
