import pg from 'pg';
import { config } from '../lib/config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error', err);
});

export const db = pool;
