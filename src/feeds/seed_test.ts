import { db } from '../db/client.js';

async function seed() {
  try {
    // 1. Insert a user
    const { rows: users } = await db.query(
      `INSERT INTO feed_users (did, handle, display_name) 
       VALUES ('did:plc:testuser', 'testuser.bsky.social', 'Test User') 
       ON CONFLICT (did) DO UPDATE SET display_name = EXCLUDED.display_name 
       RETURNING *`
    );
    const user = users[0];
    console.log('Inserted user:', user);

    // 2. Insert custom feed
    const { rows: feeds } = await db.query(
      `INSERT INTO custom_feeds (owner_id, name, query, description, uuid, is_public) 
       VALUES ($1, 'Test Feed', 'ai regulation', 'Custom feed for AI regulation', '12345678-1234-1234-1234-123456789abc', true) 
       ON CONFLICT (uuid) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [user.id]
    );
    console.log('Inserted feed:', feeds[0]);

    // 4. Insert track if not exists
    const { rows: existingTracks } = await db.query(
      "SELECT id FROM tracks WHERE uuid = '12345678-1234-1234-1234-123456789abc'"
    );
    if (existingTracks.length === 0) {
      await db.query(
        `INSERT INTO tracks (user_id, name, query, threshold, uuid, feed_published) 
         VALUES (1, 'Test Feed', 'ai regulation', 0.70, '12345678-1234-1234-1234-123456789abc', true)`
      );
    }

    // 5. Insert track match
    await db.query(
      `INSERT INTO track_matches (track_id, post_uri, post_did, post_text, matched_at) 
       VALUES (
         (SELECT id FROM tracks WHERE uuid = '12345678-1234-1234-1234-123456789abc'), 
         'at://did:plc:testuser/app.bsky.feed.post/post123', 
         'did:plc:testuser', 
         'Here is a post about AI regulation! Very important.', 
         NOW()
       ) 
       ON CONFLICT (track_id, post_uri) DO NOTHING`
    );

    // 6. Insert standard.site article
    await db.query(
      `INSERT INTO site_standard_articles (uri, author_did, title, description, published_at, verified, site, path, raw_record) 
       VALUES (
         'at://did:plc:testuser/site.standard.document/doc123', 
         'did:plc:testuser', 
         'AI Safety Guidelines', 
         'Official guidelines for AI safety.', 
         NOW(), 
         true, 
         'https://testuser.standard.site', 
         '/ai-safety', 
         '{"title":"AI Safety Guidelines","content":"# AI Safety Guidelines\\n\\nSafety first!"}'::jsonb
       ) 
       ON CONFLICT (uri) DO NOTHING`
    );

    console.log('Seeding completed successfully.');
  } catch (err) {
    console.error('Seeding failed:', err);
  } finally {
    process.exit(0);
  }
}

seed();
