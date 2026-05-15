#!/usr/bin/env node
/**
 * One-shot script to enqueue a job by name.
 * Usage: npx tsx src/scripts/enqueue.ts <jobName> [jsonData]
 * Example: npx tsx src/scripts/enqueue.ts backfillInteractions '{"offset": 0}'
 */
import { enqueueJob } from '../web/jobEnqueue.js';

const [jobName, jsonData] = process.argv.slice(2);

if (!jobName) {
  console.error('Usage: npx tsx src/scripts/enqueue.ts <jobName> [jsonData]');
  process.exit(1);
}

const data = jsonData ? JSON.parse(jsonData) : {};

try {
  await enqueueJob(jobName, data);
  console.log(`✓ Enqueued job: ${jobName}`, data);
  process.exit(0);
} catch (err) {
  console.error('Failed to enqueue:', err);
  process.exit(1);
}
