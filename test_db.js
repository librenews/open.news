import { db } from './src/db/client.js';
async function main() {
  const { rows } = await db.query("SELECT uri, site, path FROM site_standard_articles WHERE raw_record->>'site' LIKE '%srdudtvbpm5ck3i4mjdoasdy%' LIMIT 1");
  console.log(rows);
  process.exit(0);
}
main();
