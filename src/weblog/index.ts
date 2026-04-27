import express from 'express';
import path from 'path';
import { renderHome } from './views.js';
import bodyParser from 'body-parser';
import * as xmlrpc from 'xmlrpc';
import { handleMetaWeblogCall } from './xmlrpc-handler.js';
import wpRouter from './wp-handler.js';
import archiver from 'archiver';

const app = express();
app.use(express.static(path.join(process.cwd(), 'public')));
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});
app.set('trust proxy', true);
app.use(bodyParser.text({ type: 'text/xml', limit: '100mb' }));
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.raw({ type: '*/*', limit: '100mb' }));
// Mount the WP REST API endpoint namespace targeting Gutenberg editor support
app.use('/wp-json', wpRouter);

app.get('/download/plugin.zip', (req, res) => {
  res.attachment('weblog-atproto-sync.zip');
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => res.status(500).send({ error: err.message }));
  archive.pipe(res);
  archive.directory(path.join(process.cwd(), 'src/weblog/plugin/weblog-atproto-sync'), 'weblog-atproto-sync');
  archive.finalize();
});

// Route legacy proxy endpoints dynamically mapped for desktop WYSIWYG editors specifically requiring static .jpg file extensions flawlessly
app.get('/m/:did/:cid/:filename', (req, res) => {
  const { did, cid } = req.params;
  // Physically map it specifically natively to the Bluesky blob sync explicitly flawlessly
  res.redirect(`https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${cid}`);
});

// Handle standard and legacy XML-RPC endpoints
const handleXmlRpcData = async (req: express.Request, res: express.Response) => {
  try {
    // Dynamic import of xmlrpc internal modules
    // @ts-ignore - xmlrpc internal modules don't have type declarations
    const { default: Deserializer } = await import('xmlrpc/lib/deserializer.js');
    // @ts-ignore - xmlrpc internal modules don't have type declarations
    const Serializer = await import('xmlrpc/lib/serializer.js');

    // Create deserializer instance
    const deserializer = new Deserializer();

    // Create a readable stream from the request body
    const { Readable } = await import('stream');
    const stream = new Readable();
    stream.push(req.body);
    stream.push(null); // End the stream

    // Parse the XML-RPC method call
    deserializer.deserializeMethodCall(stream, async (error: any, methodName: string, params: any[]) => {
      if (error) {
        console.error('XML-RPC parse error:', error);
        return res.status(500).send('Invalid XML-RPC request');
      }

      try {
        console.log(`Handling method: ${methodName}`);
        const serverUrl = `${req.protocol}://${req.get('host')}`;
        const response = await handleMetaWeblogCall(methodName, params, serverUrl);
        const xml = Serializer.serializeMethodResponse(response);
        res.set('Content-Type', 'text/xml');
        res.send(xml);
      } catch (err: unknown) {
        console.error('Method call error:', err);
        const fault = Serializer.serializeFault({
          faultCode: 1,
          faultString: (err as Error).message,
        });
        res.set('Content-Type', 'text/xml');
        res.send(fault);
      }
    });
  } catch (importError) {
    console.error('Failed to import xmlrpc modules:', importError);
    res.status(500).send('Server configuration error');
  }
};

app.post('/xmlrpc', handleXmlRpcData);
app.post('/xmlrpc.php', handleXmlRpcData);

// WordPress physically allows GET queries to hit the XML-RPC endpoints to confirm server presence locally,
// returning exactly this phrase natively mapping an identical HTTP 405 constraint array identically!
const handleXmlRpcGet = (req: express.Request, res: express.Response) => {
  res.status(405).send('XML-RPC server accepts POST requests only.');
};
app.get('/xmlrpc', handleXmlRpcGet);
app.get('/xmlrpc.php', handleXmlRpcGet);

// WordPress App Application Password Web Flow Mock
app.get('/wp-admin/authorize-application.php', (req, res) => {
  const { app_name, success_url } = req.query;
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Connect to AT Protocol</title>
      <style>
        body { font-family: -apple-system, sans-serif; padding: 20px; background: #f0f0f1; display:flex; align-items:center; justify-content:center; min-height:90vh; }
        .card { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); width: 100%; max-width: 400px; text-align: center; }
        h2 { color: #1e40af; margin-top: 0; }
        input { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ccd0d4; border-radius: 6px; box-sizing: border-box; font-size: 16px; }
        button { width: 100%; padding: 12px; margin-top: 15px; background: #2563eb; color: white; border: none; border-radius: 6px; font-weight: bold; font-size: 16px; cursor: pointer; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>🌉 Bluesky Authorization</h2>
        <p>Connect your Bluesky account to <strong>${app_name || 'WordPress Mobile'}</strong> seamlessly.</p>
        <form method="POST" action="/wp-admin/authorize-application.php">
          <input type="hidden" name="success_url" value="${success_url || ''}">
          <input type="text" name="handle" placeholder="yourname.bsky.social" required>
          <input type="password" name="appPassword" placeholder="App Password (e.g. xxxx-xxxx-xxxx-xxxx)" required>
          <button type="submit">Approve Connection</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post('/wp-admin/authorize-application.php', express.urlencoded({ extended: true }), (req, res) => {
  const { handle, appPassword, success_url } = req.body;
  if (!success_url) {
    return res.status(400).send("Missing success url from application");
  }
  const siteUrl = encodeURIComponent(`${req.protocol}://${req.get('host')}`);
  // Pass Bluesky credentials back to the mobile app exactly like WordPress Application Passwords
  const separator = success_url.includes('?') ? '&' : '?';
  const redirectUrl = `${success_url}${separator}site_url=${siteUrl}&user_login=${encodeURIComponent(handle)}&password=${encodeURIComponent(appPassword)}`;
  res.redirect(redirectUrl);
});

// Home page with documentation and marketing content
app.get('/', (req, res) => {
  const serverUrl = `${req.protocol}://${req.get('host')}`;
  res.send(renderHome(serverUrl));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'MetaWeblog-to-Bluesky Bridge' });
});

const PORT = process.env.WEBLOG_PORT || process.env.PORT || 4400;
app.listen(PORT, () => {
  console.log(`MetaWeblog -> Bluesky bridge running on http://localhost:${PORT}/xmlrpc`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
});
