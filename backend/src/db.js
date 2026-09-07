import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool, types } = pg;

// Return PostgreSQL DATE (oid 1082) as plain "YYYY-MM-DD" strings instead of
// JS Date objects, so date handling stays timezone-safe and consistent
// across the API and the client.
types.setTypeParser(1082, (val) => val);

if (!process.env.DATABASE_URL) {
  console.warn(
    '[db] DATABASE_URL is not set. Set it in your environment (Railway provides it automatically).'
  );
}

// Railway/managed Postgres often requires SSL. We enable it when the URL is
// remote, but allow disabling with PGSSL=disable for local development.
function sslConfig() {
  const url = process.env.DATABASE_URL || '';
  const disable =
    process.env.PGSSL === 'disable' ||
    url.includes('localhost') ||
    url.includes('127.0.0.1');
  if (disable) return false;
  return { rejectUnauthorized: false };
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig(),
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client', err);
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
