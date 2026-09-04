import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { pool, query } from './db.js';
import { DEFAULT_CONFIG } from './config.js';

dotenv.config();

// Default team as specified for CEDIF Saint-Antoine.
const EMPLOYEES = [
  {
    name: 'Yassine',
    position: 'Directeur',
    has_keys: true,
    is_order_manager: true,
    weekend_only: false,
    weekly_hours: 35,
    color: '#2563eb',
    sort_order: 1,
    preferences: {},
  },
  {
    name: 'Rose',
    position: 'Responsable',
    has_keys: true,
    is_order_manager: true,
    weekend_only: false,
    weekly_hours: 35,
    color: '#db2777',
    sort_order: 2,
    preferences: {},
  },
  {
    name: 'Jennyfer',
    position: 'Employée',
    has_keys: true,
    is_order_manager: false,
    weekend_only: false,
    weekly_hours: 25,
    color: '#16a34a',
    sort_order: 3,
    preferences: {},
  },
  {
    name: 'Noussia',
    position: 'Employée',
    has_keys: true,
    is_order_manager: false,
    weekend_only: true, // ONLY Saturday & Sunday — hard constraint
    weekly_hours: 15,
    color: '#ea580c',
    sort_order: 4,
    preferences: { prefWeekend: true },
  },
];

export async function seed() {
  // --- admin user ---
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'cedif2026';
  const { rows: userRows } = await query('SELECT COUNT(*)::int AS n FROM users');
  if (userRows[0].n === 0) {
    const hash = await bcrypt.hash(password, 10);
    await query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
      [username, hash, 'admin']
    );
    console.log(`[seed] created admin user "${username}"`);
  }

  // --- config ---
  const { rows: cfgRows } = await query(`SELECT 1 FROM settings WHERE key='config'`);
  if (cfgRows.length === 0) {
    await query(
      `INSERT INTO settings (key, value) VALUES ('config', $1)`,
      [JSON.stringify(DEFAULT_CONFIG)]
    );
    console.log('[seed] inserted default config');
  }

  // --- employees + contracts ---
  const { rows: empRows } = await query('SELECT COUNT(*)::int AS n FROM employees');
  if (empRows[0].n === 0) {
    for (const e of EMPLOYEES) {
      const { rows } = await query(
        `INSERT INTO employees
          (name, position, has_keys, is_order_manager, weekend_only, color, preferences, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          e.name,
          e.position,
          e.has_keys,
          e.is_order_manager,
          e.weekend_only,
          e.color,
          JSON.stringify(e.preferences || {}),
          e.sort_order,
        ]
      );
      const empId = rows[0].id;
      await query(
        `INSERT INTO contracts (employee_id, weekly_minutes, note)
         VALUES ($1, $2, $3)`,
        [empId, e.weekly_hours * 60, 'Contrat initial']
      );
      console.log(`[seed] created employee ${e.name} (${e.weekly_hours}h)`);
    }
  }

  console.log('[seed] done');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed] failed', err);
      process.exit(1);
    });
}
