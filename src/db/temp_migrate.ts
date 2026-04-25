import { pool } from './client.js';
import fs from 'fs';

async function run() {
  try {
    const sql = fs.readFileSync('src/db/migrations/010_longform_oauth.sql', 'utf8');
    await pool.query(sql);
    console.log("Longform OAuth tables created successfully!");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
