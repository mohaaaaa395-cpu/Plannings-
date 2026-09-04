import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

import { pool } from './db.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';

import authRoutes from './routes/auth.js';
import employeeRoutes from './routes/employees.js';
import absenceRoutes from './routes/absences.js';
import scheduleRoutes from './routes/schedules.js';
import settingsRoutes from './routes/settings.js';
import statsRoutes from './routes/stats.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/absences', absenceRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/stats', statsRoutes);

// Serve the built client (single-page app).
const clientDist = path.join(__dirname, '..', 'public');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: err.message || 'Erreur serveur' });
});

const PORT = process.env.PORT || 8080;

async function start() {
  try {
    await migrate();
    await seed();
  } catch (e) {
    console.error('[startup] migration/seed failed:', e);
    // Keep serving so the health endpoint can report the DB error,
    // but log clearly.
  }
  app.listen(PORT, () => {
    console.log(`[server] CEDIF planning API listening on :${PORT}`);
  });
}

start();
