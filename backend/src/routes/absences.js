import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, e.name AS employee_name, e.color AS employee_color
       FROM absences a JOIN employees e ON e.id = a.employee_id
      ORDER BY a.start_date DESC`
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.employee_id || !b.start_date || !b.end_date) {
    return res.status(400).json({ error: 'Salarié et dates requis' });
  }
  const { rows } = await query(
    `INSERT INTO absences (employee_id, type, start_date, end_date, note)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [b.employee_id, b.type || 'conges', b.start_date, b.end_date, b.note || null]
  );
  res.json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const b = req.body || {};
  const { rows } = await query(
    `UPDATE absences SET
       type=COALESCE($2,type), start_date=COALESCE($3,start_date),
       end_date=COALESCE($4,end_date), note=COALESCE($5,note)
     WHERE id=$1 RETURNING *`,
    [Number(req.params.id), b.type, b.start_date, b.end_date, b.note]
  );
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  await query(`DELETE FROM absences WHERE id=$1`, [Number(req.params.id)]);
  res.json({ ok: true });
});

export default router;
