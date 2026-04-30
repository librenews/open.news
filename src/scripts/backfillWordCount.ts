import { db } from '../db/client.js';
import { getOsClient, SITE_STANDARD_INDEX } from '../track/opensearch.js';
import { extractTextFromSiteStandard } from '../jobs/indexSiteStandard.js';

async function main() {
  console.log('Fetching articles to backfill word count...');
  
  const { rows } = await db.query(`SELECT uri, raw_record FROM site_standard_articles WHERE word_count = 0 OR word_count IS NULL`);
  
  console.log(`Found ${rows.length} articles to update.`);
  
  const os = getOsClient();
  let updatedCount = 0;
  
  for (const row of rows) {
    if (!row.raw_record) continue;
    
    const textContent = extractTextFromSiteStandard(row.raw_record);
    const wordCount = textContent ? textContent.trim().split(/\s+/).length : 0;
    
    if (wordCount > 0) {
      await db.query(`UPDATE site_standard_articles SET word_count = $1 WHERE uri = $2`, [wordCount, row.uri]);
      
      try {
        await os.update({
          index: SITE_STANDARD_INDEX,
          id: row.uri,
          body: {
            doc: {
              word_count: wordCount
            }
          }
        });
      } catch (err: any) {
        if (err.meta?.statusCode === 404) {
          // Document might not be in OpenSearch yet, ignore
        } else {
          console.error(`Failed to update OpenSearch for ${row.uri}:`, err.message);
        }
      }
      updatedCount++;
    }
  }
  
  console.log(`Successfully backfilled word counts for ${updatedCount} articles.`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
