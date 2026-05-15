#!/usr/bin/env node
/**
 * One-shot script to enqueue a job by name.
 * Usage: DATABASE_URL=... npx tsx src/scripts/enqueue.ts <jobName> [jsonData]
 * 
 * Reads DATABASE_URL from env or .env file directly (no config validation).
 */
import { readFileSync } from 'fs';
import PgBoss from 'pg-boss';

const [jobName, jsonData] = process.argv.slice(2);

if (!jobName) {
  console.error('Usage: npx tsx src/scripts/enqueue.ts <jobName> [jsonData]');
  console.error('Example: npx tsx src/scripts/enqueue.ts backfillInteractions \'{"offset": 0}\'');
  process.exit(1);
}

// Try to load DATABASE_URL from env, falling back to .env file
let dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  try {
    const envFile = readFileSync('.env', 'utf-8');
    const match = envFile.match(/^DATABASE_URL=["']?(.+?)["']?\s*$/m);
    if (match) dbUrl = match[1];
  } catch {}
}
if (!dbUrl) {
  // Try ecosystem.config.cjs
  try {
    const eco = readFileSync('ecosystem.config.cjs', 'utf-8');
    const match = eco.match(/DATABASE_URL:\s*["'](.+?)["']/);
    if (match) dbUrl = match[1];
  } catch {}
}
if (!dbUrl) {
  console.error('❌ Could not find DATABASE_URL in env, .env, or ecosystem.config.cjs');
  process.exit(1);
}

const data = jsonData ? JSON.parse(jsonData) : {};

const boss = new PgBoss({ connectionString: dbUrl });
await boss.start();
await boss.createQueue(jobName);
const jobId = await boss.send(jobName, data);
console.log(`✓ Enqueued job: ${jobName} (id: ${jobId})`, data);
await boss.stop();
process.exit(0);
