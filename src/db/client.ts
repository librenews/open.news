import pg from 'pg';
import { config } from '../lib/config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '4', 10),
  idleTimeoutMillis: 30_000,       // release idle connections after 30s
  connectionTimeoutMillis: 15_000, // enough headroom for all-process startup
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error', err);
});

export const db = pool;
