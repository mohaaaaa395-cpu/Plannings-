import express from 'express';
import { requireAuth } from '../auth.js';
import { employeeStats, availablePeriods } from '../services/stats.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const period = req.query.period || '12w';
  const rows = await employeeStats(period);
  res.json({ period, periods: await availablePeriods(), employees: rows });
});

export default router;
