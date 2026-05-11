import { getCentipediaBot } from '../bot.js';
import { config } from '../../lib/config.js';

async function main() {
  const bot = await getCentipediaBot();
  if (!bot || !bot.session) {
    console.error('Bot not available');
    process.exit(1);
  }
  const rkey = 'decentralization'; // article rkey from junction table
  try {
    const res = await bot.com.atproto.repo.getRecord({
      repo: bot.session.did,
      collection: 'site.standard.document',
      rkey,
    });
    console.log(JSON.stringify(res.data, null, 2));
  } catch (e: any) {
    console.error('Failed to fetch record:', e);
  }
}

main();
