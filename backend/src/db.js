import { Pool } from 'pg';

let pool;
let ensured = false;

function getConnectionOptions() {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) return null;
  const options = { connectionString };
  if (process.env.NODE_ENV === 'production') {
    options.ssl = { rejectUnauthorized: true };
  }
  return options;
}

export function getPool() {
  const options = getConnectionOptions();
  if (!options) return null;
  if (!pool) {
    pool = new Pool(options);
  }
  return pool;
}

export function isDatabaseEnabled() {
  return Boolean(getConnectionOptions());
}

export async function withDb(callback) {
  const activePool = getPool();
  if (!activePool) {
    throw new Error('POSTGRES_URL not configured');
  }
  const client = await activePool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function ensureSchema() {
  if (!isDatabaseEnabled() || ensured) return;
  try {
    await withDb(async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS vm_metrics (
          id SERIAL PRIMARY KEY,
          ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          node TEXT NOT NULL,
          vmid INT NOT NULL,
          cpu_pct REAL,
          mem_pct REAL,
          disk_pct REAL
        );
      `);
    });
    ensured = true;
  } catch (error) {
    console.error('Failed to ensure vm_metrics table:', error.message);
  }
}
