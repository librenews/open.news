import { db } from './db/client.js';

async function run() {
  const { rows } = await db.query(
    `SELECT post_text, facets FROM track_matches WHERE post_uri LIKE '%3mhxwvbaj7p22'`
  );
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
run();
