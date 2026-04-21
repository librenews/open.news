import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import bodyParser from 'body-parser';
import wpRouter from './wp-handler.js';
import * as blueskyClient from './bluesky-client.js';

// Fully mock Bluesky network execution offline safely bypassing network loops cleanly!
vi.mock('./bluesky-client.js', async () => ({
  authenticateUser: vi.fn(),
  uploadMediaToBluesky: vi.fn(),
  publishToBluesky: vi.fn(),
}));

describe('WordPress REST Express Handler', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.resetAllMocks();
    app = express();
    app.use(bodyParser.json());
    app.use(bodyParser.raw({ type: '*/*' }));
    app.use('/wp-json', wpRouter);
  });

  describe('GET /wp-json', () => {
    it('returns dynamically structured native Discovery validation schemas effectively', async () => {
      const response = await request(app).get('/wp-json');
      expect(response.status).toBe(200);
      expect(response.body.name).toBe('AT Protocol Bridge');
      expect(response.body.namespaces).toContain('wp/v2');
    });
  });

  describe('POST /wp/v2/media', () => {
    it('authenticates implicitly intercepting basic headers gracefully offline mapping Bluesky upload pipelines natively', async () => {
      // Mock successful AT pass inside memory
      vi.mocked(blueskyClient.authenticateUser).mockResolvedValue(true);
      vi.mocked(blueskyClient.uploadMediaToBluesky).mockResolvedValue({
        url: 'https://bsky.network/fake?cid=fakecid123',
        mime: 'image/jpeg',
        cid: 'fakecid123'
      });

      const response = await request(app)
        .post('/wp-json/wp/v2/media')
        .auth('testuser', 'app-pass-123')
        .set('Content-Type', 'image/jpeg')
        .set('Content-Disposition', 'attachment; filename="test.jpg"')
        .send(Buffer.from('fake_image_bytes'));

      expect(response.status).toBe(201);
      
      // Verify standardized WP payload mapping structures execute beautifully
      expect(response.body.source_url).toContain('fakecid123');
      expect(response.body.media_type).toBe('image');
      expect(blueskyClient.uploadMediaToBluesky).toHaveBeenCalledTimes(1);
    });

    it('defends strictly safely blocking completely anonymous external attacks instantly', async () => {
      const response = await request(app)
        .post('/wp-json/wp/v2/media')
        .send(Buffer.from('bytes'));
        
      expect(response.status).toBe(401);
    });
  });
});
