import express from 'express';
import { requireAuth } from '../auth.js';
import { loadConfig, saveConfig, DEFAULT_CONFIG } from '../config.js';
import { normalizeTime } from '../time.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const config = await loadConfig();
  res.json({ config, defaults: DEFAULT_CONFIG });
});

// Normalize any time-like fields before saving.
function normalizeConfigTimes(cfg) {
  if (!cfg) return cfg;
  if (cfg.store) {
    for (const k of ['weekday_open', 'weekday_close', 'sunday_open', 'sunday_close']) {
      if (cfg.store[k]) cfg.store[k] = normalizeTime(cfg.store[k]) || cfg.store[k];
    }
  }
  if (cfg.shifts) {
    for (const k of ['break_start', 'break_end']) {
      if (cfg.shifts[k]) cfg.shifts[k] = normalizeTime(cfg.shifts[k]) || cfg.shifts[k];
    }
  }
  if (cfg.order?.deadline) cfg.order.deadline = normalizeTime(cfg.order.deadline) || cfg.order.deadline;
  return cfg;
}

router.put('/', async (req, res) => {
  const partial = normalizeConfigTimes(req.body || {});
  const merged = await saveConfig(partial);
  res.json({ config: merged });
});

router.post('/reset', async (req, res) => {
  const merged = await saveConfig(DEFAULT_CONFIG);
  res.json({ config: merged });
});

export default router;
