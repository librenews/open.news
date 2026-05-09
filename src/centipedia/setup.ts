/**
 * One-time setup script for Centipedia:
 * 1. Logs in the bot
 * 2. Creates the site.standard.publication record if it doesn't exist
 * 
 * Run: node --env-file=.env --import tsx/esm src/centipedia/setup.ts
 */
import { getCentipediaBot, ensurePublication } from './bot.js';
import { logger } from '../lib/logger.js';

async function main() {
  console.log('🐛 Setting up Centipedia...\n');

  const agent = await getCentipediaBot();
  if (!agent || !agent.session) {
    console.error('❌ Failed to login bot. Check CENTIPEDIA_BSKY_HANDLE and CENTIPEDIA_BSKY_PASSWORD in .env');
    process.exit(1);
  }

  console.log(`✅ Bot logged in as: ${agent.session.handle} (${agent.session.did})\n`);

  const pubUri = await ensurePublication();
  if (!pubUri) {
    console.error('❌ Failed to create publication record');
    process.exit(1);
  }

  console.log(`✅ Publication record: ${pubUri}\n`);
  console.log('📋 Add this to your .env:');
  console.log(`   CENTIPEDIA_PUBLICATION_URI=${pubUri}\n`);
  console.log(`   CENTIPEDIA_BOT_DID=${agent.session.did}\n`);
  console.log('🐛 Centipedia setup complete!');

  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, 'Setup failed');
  process.exit(1);
});
