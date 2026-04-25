import express from 'express';
import basicAuth from 'basic-auth';
import { authenticateUser, uploadMediaToBluesky } from './bluesky-client.js';
import { parseGutenbergToLeaflet } from './wp-parser.js';
import { BskyAgent } from '@atproto/api';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const discoveryJson = fs.readFileSync(path.join(__dirname, 'wp-discovery.json'), 'utf8');
const router = express.Router();

// Middleware for Basic Auth imitating WP auth protocol mapping to AT credentials
const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const credentials = basicAuth(req);

  if (!credentials) {
    res.set('WWW-Authenticate', 'Basic realm="Bluesky Handle"');
    res.status(401).json({ code: 'rest_forbidden', message: 'Authentication required' });
    return;
  }

  let { name: handle, pass: appPassword } = credentials;
  
  // WP App often saves app passwords with spaces instead of hyphens, clean it up for AT Protocol
  appPassword = appPassword.replace(/\s+/g, '-');
  console.log(`[AUTH] Checking Handle: "${handle}"`);
  
  if (await authenticateUser(handle, appPassword)) {
    // Save creds to request context for downstream actions
    (req as any).user = { handle, appPassword };
    next();
  } else {
    res.status(403).json({ code: 'rest_forbidden', message: 'Invalid Bluesky credentials' });
    return;
  }
};

// WP REST API Discovery - Faking a complete native WordPress installation
router.get('/', (req, res) => {
  const url = `${req.protocol}://${req.get('host')}`;
  const payload = discoveryJson.replace(/https:\/\/wordpress\.org\/news/g, url);
  const json = JSON.parse(payload);
  
  json.name = 'AT Protocol Bridge';
  json.description = 'Weblog.social node map';
  json.home = url;
  json.url = url;
  json.gmt_offset = "0";
  json.timezone_string = 'UTC';
  
  // Bridge injection
  json.authentication = {
    "application-passwords": {
      "endpoints": {
        "authorization": `${url}/wp-admin/authorize-application.php`
      }
    }
  };
  
  // Sanitize out plugins/extensions (Jetpack, Akismet, WPCom) present in the wordpress.org literal dump
  // If the app sees Jetpack in the namespaces, it strictly requires the Jetpack endpoints to work!
  json.namespaces = json.namespaces.filter((ns: string) => ns === 'wp/v2' || ns === 'oembed/1.0');
  for (const route of Object.keys(json.routes)) {
    if (route !== '/' && !route.startsWith('/wp/v2') && !route.startsWith('/oembed/1.0')) {
      delete json.routes[route];
    }
  }
  
  res.json(json);
});

// Authenticated User Identity Handler
router.all('/wp/v2/users/me', requireAuth, (req, res) => {
  const user = (req as any).user;
  res.json({
    id: 1,
    username: user.handle,
    name: user.handle,
    first_name: '',
    last_name: '',
    email: 'hello@weblog.social',
    url: `https://bsky.social/profile/${user.handle}`,
    description: 'Bluesky mapped user on Weblog.social bridge',
    link: `https://bsky.social/profile/${user.handle}`,
    locale: 'en_US',
    nickname: user.handle,
    slug: user.handle,
    registered_date: "2024-01-01T00:00:00Z",
    roles: ['administrator'],
    capabilities: { 
      administrator: true,
      edit_posts: true, 
      publish_posts: true,
      upload_files: true,
      read: true
    },
    extra_capabilities: {
      administrator: true
    },
    avatar_urls: { "24": "https://s.gravatar.com/avatar/?d=identicon", "48": "https://s.gravatar.com/avatar/?d=identicon", "96": "https://s.gravatar.com/avatar/?d=identicon" },
    meta: [],
    _links: {
      self: [{ href: `${req.protocol}://${req.get('host')}/wp-json/wp/v2/users/1` }],
      collection: [{ href: `${req.protocol}://${req.get('host')}/wp-json/wp/v2/users` }]
    }
  });
});

// Mock WP Settings required by the mobile app bootstrap
router.all('/wp/v2/settings', requireAuth, (req, res) => {
  res.json({
    title: 'AT Protocol Bridge',
    description: 'Weblog.social',
    url: `${req.protocol}://${req.get('host')}`,
    email: 'admin@weblog.social',
    timezone: 'UTC',
    date_format: 'F j, Y',
    time_format: 'g:i a',
    start_of_week: 1,
    language: 'en_US',
    use_smilies: false,
    default_category: 1,
    default_post_format: 'standard',
    posts_per_page: 10
  });
});

// Handle REST Media Uploads
router.post('/wp/v2/media', requireAuth, async (req, res) => {
  const user = (req as any).user;
  try {
    let mimeType = req.get('Content-Type') || 'application/octet-stream';
    let fileName = req.get('Content-Disposition')?.match(/filename="([^"]+)"/i)?.[1] || `upload_${Date.now()}.bin`;
    
    // Express raw body-parser ensures req.body is securely mapped exactly as a Buffer dynamically when octet-streams push
    let buffer: Buffer;
    if (Buffer.isBuffer(req.body)) {
      buffer = req.body;
    } else if (typeof req.body === 'string') {
      buffer = Buffer.from(req.body);
    } else {
       // if parsed organically as empty JSON object bypass edgecase
       buffer = Buffer.from(JSON.stringify(req.body));
    }

    // iOS and WordPress mobile apps use physical multipart/form-data, pushing literal HTTP boundary strings straight into our buffers! 
    if (mimeType.includes('multipart/form-data')) {
      const boundaryMatch = mimeType.match(/boundary=([^;]+)/i);
      if (boundaryMatch) {
        // Strip out enclosing double quotes if client sends e.g. boundary="----webkit..."
        let rawBoundary = boundaryMatch[1];
        if (rawBoundary.startsWith('"') && rawBoundary.endsWith('"')) {
            rawBoundary = rawBoundary.slice(1, -1);
        }
        const doubleDashBoundary = Buffer.from(`--${rawBoundary}`);
        let idx = buffer.indexOf(doubleDashBoundary);
        
        while (idx !== -1) {
          const nextIdx = buffer.indexOf(doubleDashBoundary, idx + doubleDashBoundary.length);
          if (nextIdx === -1) break;
          
          const partBuffer = buffer.slice(idx + doubleDashBoundary.length, nextIdx);
          const headerEnd = partBuffer.indexOf(Buffer.from('\r\n\r\n'));
          
          if (headerEnd !== -1) {
            const headerSegment = partBuffer.slice(0, headerEnd).toString('utf-8');
            if (headerSegment.includes('filename="')) {
              const fileMatch = headerSegment.match(/filename="([^"]+)"/i);
              if (fileMatch) fileName = fileMatch[1];
              
              const typeMatch = headerSegment.match(/Content-Type:\s*([^\s\r\n]+)/i);
              if (typeMatch) mimeType = typeMatch[1];
              
              let payloadEnd = partBuffer.length;
              if (payloadEnd >= 2 && partBuffer[payloadEnd - 2] === 0x0D && partBuffer[payloadEnd - 1] === 0x0A) {
                payloadEnd -= 2; // Drop trailing \r\n before the next boundary
              }
              
              buffer = partBuffer.slice(headerEnd + 4, payloadEnd);
              break;
            }
          }
          idx = nextIdx;
        }
      }
    }

    // Force strictly valid web Mime Types preventing browser CORB layout rejections entirely safely!
    if (fileName && (fileName.toLowerCase().endsWith('.jpg') || fileName.toLowerCase().endsWith('.jpeg'))) mimeType = 'image/jpeg';
    else if (fileName && fileName.toLowerCase().endsWith('.png')) mimeType = 'image/png';
    else if (buffer.length > 2 && buffer[0] === 0xFF && buffer[1] === 0xD8) mimeType = 'image/jpeg';
    else if (buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) mimeType = 'image/png';
    else if (mimeType.includes('multipart/form-data') || mimeType === 'application/octet-stream') mimeType = 'image/jpeg'; // Absolute baseline natively

    // Dispatch to pipeline natively extending the identical AT Protocol execution route cleanly mapped inside xmlrpc
    const serverUrl = `${req.protocol}://${req.get('host')}`;
    const { url, mime, cid } = await uploadMediaToBluesky(user.handle, user.appPassword, fileName, mimeType, new Uint8Array(buffer), serverUrl);

    // Respond utilizing WP standardized payload dict structures uniquely targeting REST environments 
    res.status(201).json({
      id: Math.floor(Math.random() * 9999999), // Mock ID
      date: new Date().toISOString(),
      date_gmt: new Date().toISOString(),
      guid: { rendered: url },
      modified: new Date().toISOString(),
      modified_gmt: new Date().toISOString(),
      slug: cid,
      status: 'inherit',
      type: 'attachment',
      link: url,
      title: { raw: fileName, rendered: fileName },
      author: 1,
      comment_status: 'closed',
      ping_status: 'closed',
      meta: [],
      template: '',
      alt_text: '',
      caption: { raw: '', rendered: '' },
      description: { raw: '', rendered: '' },
      media_type: mimeType.startsWith('image/') ? 'image' : 'file',
      mime_type: mime,
      media_details: {},
      post: null,
      source_url: url,
      permalink_template: url,
      generated_slug: cid,
      missing_image_sizes: []
    });
  } catch (error) {
    console.error('REST Upload API Failure:', error);
    res.status(500).json({ code: 'rest_upload_error', message: 'Failed directly connecting bridge to PDS', data: { status: 500 } });
  }
});

// Create Post Endpoint Handler Mapping WP block tree to AT Protocol
router.post('/wp/v2/posts', requireAuth, express.json(), async (req, res) => {
  try {
    const user = (req as any).user;
    const body = req.body;
    
    const title = typeof body.title === 'object' ? body.title.raw || body.title.rendered : body.title || 'Untitled';
    const content = typeof body.content === 'object' ? body.content.raw || body.content.rendered : body.content || '';
    
    const agent = new BskyAgent({ service: 'https://bsky.social' });
    await agent.login({ identifier: user.handle, password: user.appPassword });
    const did = agent.session!.did;

    // Use WP Block to Leaflet AT Parser 
    const leafletDoc = await parseGutenbergToLeaflet(content, title, did);

    // Save Leaflet Protocol record natively
    const result = await agent.com.atproto.repo.createRecord({
      repo: did,
      collection: 'pub.leaflet.document',
      record: leafletDoc as any,
    });

    res.status(201).json({
      id: 1, // Static placeholder
      date: new Date().toISOString(),
      status: 'publish',
      title: { raw: title, rendered: title },
      content: { raw: content, rendered: content },
      link: result.data.uri 
    });

  } catch (err: any) {
    console.error('WP Post error:', err);
    res.status(500).json({ code: 'internal_error', message: err.message });
  }
});

// Fetch Posts Endpoint
router.get('/wp/v2/posts', requireAuth, (req, res) => {
  // Return empty array for now since we are ignoring reverse-translation for the one-way publishing MVP
  res.json([]); 
});

// WordPress expects standard JSON 404s for any non-existent route inside /wp-json
// Express naturally returns an HTML page for 404s, which violently crashes the iOS App JSON Decoder
router.use((req, res) => {
  res.status(404).json({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
    data: { status: 404 }
  });
});

export default router;
