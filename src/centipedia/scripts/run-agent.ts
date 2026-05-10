/**
 * Manually trigger the research agent for testing.
 * Usage: node --env-file=.env --import tsx/esm src/centipedia/scripts/run-agent.ts
 */
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

// Import agent internals — we'll call the exported start function
// but for a one-shot run, we replicate the tick logic
import { startResearchAgent } from '../agents/research.js';

async function main() {
  console.log('🔬 Running Centipedia research agent (one-shot)...\n');

  // Check pending count
  const { rows: [{ count: pendingCount }] } = await db.query(
    "SELECT count(*) FROM centipedia_citations WHERE status = 'pending'"
  );
  console.log(`📋 Pending citations: ${pendingCount}`);

  const { rows: [{ count: acceptedCount }] } = await db.query(
    "SELECT count(*) FROM centipedia_citations WHERE status = 'accepted' AND article_rkey IS NULL"
  );
  console.log(`✅ Accepted (unlinked): ${acceptedCount}`);

  // Start agent — it will run immediately
  const stop = startResearchAgent();

  // Wait for one tick to complete
  await new Promise(resolve => setTimeout(resolve, 15000));
  stop();

  // Show results
  const { rows: citations } = await db.query(
    `SELECT id, url, title, topic, status, article_rkey FROM centipedia_citations ORDER BY created_at DESC LIMIT 20`
  );
  console.log('\n📊 Citation status:');
  for (const c of citations) {
    const emoji = c.status === 'accepted' ? '✅' : c.status === 'rejected' ? '❌' : '⏳';
    const linked = c.article_rkey ? ` → ${c.article_rkey}` : '';
    console.log(`  ${emoji} [${c.status}] ${c.title || c.url} (${c.topic || 'no topic'})${linked}`);
  }

  await db.end();
  process.exit(0);
}

main().catch(err => {
  console.error('Agent run failed:', err);
  process.exit(1);
});
