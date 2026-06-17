/** @jsxImportSource hono/jsx */

const OPEN_NEWS_DID = 'did:plc:beyhbfl42eoum6pd7ojnzih6';
// With slug-based rkeys, this will match the slug used when publishing via the editor.
const DOCUMENT_RKEY = 'standard.site-hello-world';
const DOCUMENT_URI = `at://${OPEN_NEWS_DID}/site.standard.document/${DOCUMENT_RKEY}`;
const PUBLICATION_URI = `at://${OPEN_NEWS_DID}/site.standard.publication/self`;

export function StandardSitePage() {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Standard.site: Hello World — open.news</title>
        <meta name="description" content="The simplest compliant standard.site article. Learn how to publish your first publication and document to the AT Protocol using the standard.site lexicons." />

        <meta property="og:title" content="Standard.site: Hello World" />
        <meta property="og:description" content="The simplest compliant standard.site article. Learn how to publish your first publication and document to the AT Protocol." />
        <meta property="og:type" content="article" />
        <meta property="og:url" content="https://open.news/standard-site" />

        {/* standard.site document verification */}
        <link rel="site.standard.document" href={DOCUMENT_URI} />

        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@0,300;0,400;0,700;1,300;1,400&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

        <style dangerouslySetInnerHTML={{__html: `
          :root {
            --bg: #ffffff;
            --bg-surface: #f9f9f9;
            --bg-card: rgba(0,0,0,0.02);
            --bg-code: #f6f8fa;
            --border: rgba(0,0,0,0.08);
            --border-hover: rgba(0,0,0,0.15);
            --text: #242424;
            --text-muted: rgba(117, 117, 117, 1);
            --text-dim: #757575;
            --accent: #118156;
            --green: #1a7f37;
            --amber: #9a6700;
            --font-body: 'Merriweather', Georgia, serif;
            --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
          }

          @media (prefers-color-scheme: dark) {
            :root {
              --bg: #121212;
              --bg-surface: #1e1e1e;
              --bg-card: rgba(255,255,255,0.03);
              --bg-code: #161b22;
              --border: rgba(255,255,255,0.08);
              --border-hover: rgba(255,255,255,0.16);
              --text: rgba(255, 255, 255, 0.9);
              --text-muted: rgba(255, 255, 255, 0.6);
              --text-dim: rgba(255, 255, 255, 0.45);
              --green: #2ea043;
              --amber: #d29922;
            }
          }

          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: var(--font-body);
            background: var(--bg);
            color: var(--text);
            -webkit-font-smoothing: antialiased;
            min-height: 100vh;
            line-height: 1.8;
            font-size: 18px;
            font-weight: 300;
          }

          /* ── Layout ─────────────────────────────────────── */
          .page-header {
            border-bottom: 1px solid var(--border);
            padding: 0.75rem 2rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .page-header a {
            font-family: var(--font-sans);
            font-size: 1.35rem;
            font-weight: 700;
            color: var(--text);
            text-decoration: none;
            letter-spacing: -0.03em;
          }
          .page-header .dot {
            color: var(--accent);
          }

          article {
            max-width: 680px;
            margin: 0 auto;
            padding: 3rem 20px 6rem 20px;
          }

          /* ── Typography ─────────────────────────────────── */
          h1 {
            font-family: var(--font-sans);
            font-size: 2.5rem;
            font-weight: 700;
            letter-spacing: -0.02em;
            line-height: 1.25;
            margin-bottom: 1.5rem;
          }
          h1 .highlight {
            color: var(--accent);
          }

          .subtitle {
            font-size: 1.15rem;
            color: var(--text-muted);
            margin-bottom: 2rem;
            line-height: 1.6;
          }

          .meta {
            display: flex;
            gap: 1.5rem;
            align-items: center;
            font-size: 0.85rem;
            color: var(--text-dim);
            padding-bottom: 2rem;
            border-bottom: 1px solid var(--border);
            margin-bottom: 2.5rem;
            flex-wrap: wrap;
            font-family: var(--font-sans);
          }
          .meta-tag {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            background: rgba(17, 129, 86, 0.08);
            color: var(--accent);
            padding: 0.25rem 0.65rem;
            border-radius: 6px;
            font-size: 0.8rem;
            font-weight: 500;
          }

          h2 {
            font-family: var(--font-sans);
            font-size: 1.75rem;
            font-weight: 700;
            letter-spacing: -0.02em;
            margin-top: 3.5rem;
            margin-bottom: 1.25rem;
            color: var(--text);
            border-bottom: 1px solid var(--border);
            padding-bottom: 0.5rem;
          }

          h3 {
            font-family: var(--font-sans);
            font-size: 1.25rem;
            font-weight: 700;
            margin-top: 2rem;
            margin-bottom: 0.75rem;
            color: var(--text);
          }

          p {
            margin-bottom: 1.5rem;
            color: var(--text);
          }

          a { color: var(--accent); text-decoration: none; }
          a:hover { text-decoration: underline; }

          strong { color: var(--text); font-weight: 600; }

          /* ── Code blocks ────────────────────────────────── */
          pre {
            background: var(--bg-code);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 1.25rem 1.5rem;
            overflow-x: auto;
            margin: 1.5rem 0 2rem;
            position: relative;
          }
          pre code {
            font-family: var(--font-mono);
            font-size: 0.85rem;
            line-height: 1.6;
            color: var(--text);
          }
          .code-label {
            position: absolute;
            top: 0;
            right: 0;
            background: rgba(17, 129, 86, 0.1);
            color: var(--accent);
            font-family: var(--font-mono);
            font-size: 0.7rem;
            font-weight: 500;
            padding: 0.3rem 0.75rem;
            border-radius: 0 8px 0 8px;
            letter-spacing: 0.02em;
          }

          code {
            font-family: var(--font-mono);
            font-size: 0.88em;
            background: var(--bg-card);
            border: 1px solid var(--border);
            padding: 0.15rem 0.4rem;
            border-radius: 4px;
            color: var(--text);
          }

          /* ── Callout boxes ──────────────────────────────── */
          .callout {
            border-radius: 8px;
            padding: 1.25rem 1.5rem;
            margin: 1.5rem 0;
            border-left: 3px solid;
          }
          .callout-info {
            background: rgba(17, 129, 86, 0.05);
            border-color: var(--accent);
          }
          .callout-success {
            background: rgba(26, 127, 55, 0.05);
            border-color: var(--green);
          }
          .callout-warn {
            background: rgba(154, 103, 0, 0.05);
            border-color: var(--amber);
          }
          .callout-title {
            font-family: var(--font-sans);
            font-weight: 600;
            font-size: 0.9rem;
            margin-bottom: 0.5rem;
            display: flex;
            align-items: center;
            gap: 0.4rem;
          }
          .callout p { margin-bottom: 0.5rem; font-size: 0.92rem; }
          .callout p:last-child { margin-bottom: 0; }

          /* ── Step indicators ────────────────────────────── */
          .step {
            display: flex;
            align-items: baseline;
            gap: 1rem;
            margin-top: 2.5rem;
            margin-bottom: 1rem;
          }
          .step-num {
            flex-shrink: 0;
            width: 2rem;
            height: 2rem;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 8px;
            background: rgba(17, 129, 86, 0.1);
            color: var(--accent);
            font-family: var(--font-mono);
            font-size: 0.85rem;
            font-weight: 600;
          }
          .step h3 {
            margin-top: 0;
            margin-bottom: 0;
          }

          /* ── Table ──────────────────────────────────────── */
          .field-table {
            width: 100%;
            border-collapse: collapse;
            margin: 1.5rem 0 2rem;
            font-size: 0.88rem;
            font-family: var(--font-sans);
          }
          .field-table th {
            text-align: left;
            padding: 0.6rem 0.75rem;
            border-bottom: 1px solid var(--border-hover);
            color: var(--text-muted);
            font-weight: 500;
            font-size: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          .field-table td {
            padding: 0.55rem 0.75rem;
            border-bottom: 1px solid var(--border);
            vertical-align: top;
          }
          .field-table td:first-child {
            font-family: var(--font-mono);
            font-size: 0.82rem;
            color: var(--text);
            white-space: nowrap;
          }
          .req {
            display: inline-block;
            font-size: 0.7rem;
            font-weight: 600;
            padding: 0.1rem 0.4rem;
            border-radius: 4px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }
          .req-yes { background: rgba(26, 127, 55, 0.12); color: var(--green); }
          .req-no { background: var(--bg-surface); color: var(--text-muted); }

          /* ── Lists ──────────────────────────────────────── */
          ul, ol {
            padding-left: 1.5rem;
            margin-bottom: 1.5rem;
          }
          li {
            margin-bottom: 0.5rem;
            color: var(--text);
          }

          hr {
            border: none;
            border-top: 1px solid var(--border);
            margin: 3rem 0;
          }

          /* ── Footer ─────────────────────────────────────── */
          .article-footer {
            text-align: center;
            padding: 2rem 1.5rem;
            font-size: 0.8rem;
            color: var(--text-muted);
            border-top: 1px solid var(--border);
            font-family: var(--font-sans);
          }
          .article-footer a { color: var(--text-muted); }
          .article-footer a:hover { color: var(--text); }

          /* ── JSON syntax colors ─────────────────────────── */
          .json-key { color: #0550ae; }
          .json-str { color: #1a7f37; }
          .json-bool, .json-null { color: #cf222e; }
          .json-comment { color: #6e7781; font-style: italic; }
          .json-url { color: #0969da; text-decoration: underline; }

          @media (prefers-color-scheme: dark) {
            .json-key { color: #79c0ff; }
            .json-str { color: #7ee787; }
            .json-bool, .json-null { color: #ff7b72; }
            .json-comment { color: #8b949e; }
            .json-url { color: #58a6ff; }
          }

          /* ── Animations ─────────────────────────────────── */
          @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(16px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .fade { animation: fadeInUp 0.5s cubic-bezier(0.16,1,0.3,1) both; }
          .fade-d1 { animation-delay: 0.1s; }
          .fade-d2 { animation-delay: 0.2s; }
          .fade-d3 { animation-delay: 0.3s; }

          @media (max-width: 640px) {
            h1 { font-size: 2rem; }
            h2 { font-size: 1.4rem; }
            pre { padding: 1rem; }
            article { padding: 2rem 1rem 4rem; }
            .meta { gap: 0.75rem; }
          }
        `}} />
      </head>
      <body>
        <header class="page-header fade">
          <a href="/">open<span class="dot">.</span>news</a>
        </header>

        <article>
          <h1 class="fade fade-d1">
            Standard<span class="highlight">.site</span>: Hello World
          </h1>
          <p class="subtitle fade fade-d2">
            This page is the simplest possible compliant <a href="https://standard.site">standard.site</a> article.
            It explains how the standard works—and it <em>is</em> its own example. View source to see the{' '}
            <code>&lt;link&gt;</code> tag in the <code>&lt;head&gt;</code>.
          </p>

          <div class="meta fade fade-d3">
            <span>open.news</span>
            <span>June 2026</span>
            <span class="meta-tag">🔗 AT Protocol</span>
            <span class="meta-tag">📝 standard.site</span>
          </div>

          {/* ── What is standard.site? ────────────────────── */}
          <h2>What is standard.site?</h2>
          <p>
            <strong>Standard.site</strong> is a set of shared <a href="https://atproto.com/guides/lexicon">lexicons</a> (schemas)
            for long-form publishing on the <a href="https://atproto.com">AT Protocol</a>. It solves a simple problem: if every
            blogging platform on ATmosphere invents its own schema, indexers have to support all of them, and your content is locked
            to whichever platform you chose.
          </p>
          <p>
            With standard.site, there are just two record types that matter:
          </p>
          <ul>
            <li><code>site.standard.publication</code> — your blog/website (one per identity)</li>
            <li><code>site.standard.document</code> — an individual article or post</li>
          </ul>
          <p>
            Any platform that reads and writes these lexicons can discover, index, and display your content.
            Move to a different host and your articles follow you—because they live in <em>your</em> AT Protocol repository.
          </p>

          {/* ── Step 1: Publication ───────────────────────── */}
          <hr />
          <div class="step">
            <span class="step-num">1</span>
            <h3>Create a Publication</h3>
          </div>
          <p>
            A <strong>publication</strong> is the top-level record that represents your blog. It always uses
            the rkey <code>"self"</code>, making it a singleton—one publication per AT Protocol identity.
          </p>

          <table class="field-table">
            <thead>
              <tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>name</td>
                <td>string</td>
                <td><span class="req req-yes">yes</span></td>
                <td>Publication name</td>
              </tr>
              <tr>
                <td>url</td>
                <td>string</td>
                <td><span class="req req-yes">yes</span></td>
                <td>HTTP URL of your website</td>
              </tr>
              <tr>
                <td>description</td>
                <td>string</td>
                <td><span class="req req-no">no</span></td>
                <td>Short description</td>
              </tr>
              <tr>
                <td>createdAt</td>
                <td>datetime</td>
                <td><span class="req req-no">no</span></td>
                <td>ISO 8601 timestamp</td>
              </tr>
            </tbody>
          </table>

          <p>Store it in your PDS via <code>com.atproto.repo.putRecord</code>:</p>

          <pre>
            <span class="code-label">putRecord</span>
            <code dangerouslySetInnerHTML={{__html: `{
  <span class="json-key">"repo"</span>: <span class="json-str">"did:plc:your-did-here"</span>,
  <span class="json-key">"collection"</span>: <span class="json-str">"site.standard.publication"</span>,
  <span class="json-key">"rkey"</span>: <span class="json-str">"self"</span>,
  <span class="json-key">"record"</span>: {
    <span class="json-key">"$type"</span>: <span class="json-str">"site.standard.publication"</span>,
    <span class="json-key">"name"</span>: <span class="json-str">"My Blog"</span>,
    <span class="json-key">"url"</span>: <span class="json-str">"https://example.com"</span>,
    <span class="json-key">"createdAt"</span>: <span class="json-str">"2026-06-17T00:00:00.000Z"</span>
  }
}`}} />
          </pre>

          <div class="callout callout-info">
            <div class="callout-title">💡 This is an actual API call</div>
            <p>
              POST this JSON to <code>https://bsky.social/xrpc/com.atproto.repo.putRecord</code> with
              an <code>Authorization: Bearer</code> header from <code>com.atproto.server.createSession</code>.
            </p>
          </div>

          {/* ── Step 2: Document ──────────────────────────── */}
          <div class="step">
            <span class="step-num">2</span>
            <h3>Create a Document</h3>
          </div>
          <p>
            A <strong>document</strong> is an individual article. The <code>content</code> field is an open union—it
            can be a simple Markdown string or a rich <a href="https://leaflet.pub">Leaflet</a> block structure.
            For a hello-world, plain Markdown is simplest:
          </p>

          <table class="field-table">
            <thead>
              <tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>title</td>
                <td>string</td>
                <td><span class="req req-no">no</span></td>
                <td>Article title</td>
              </tr>
              <tr>
                <td>content</td>
                <td>string | object</td>
                <td><span class="req req-yes">yes</span></td>
                <td>Markdown string or Leaflet block structure</td>
              </tr>
              <tr>
                <td>publishedAt</td>
                <td>datetime</td>
                <td><span class="req req-yes">yes</span></td>
                <td>ISO 8601 publication timestamp</td>
              </tr>
              <tr>
                <td>site</td>
                <td>string</td>
                <td><span class="req req-no">no</span></td>
                <td>HTTP URL or AT-URI of the publication</td>
              </tr>
              <tr>
                <td>path</td>
                <td>string</td>
                <td><span class="req req-no">no</span></td>
                <td>URL path for the document</td>
              </tr>
              <tr>
                <td>tags</td>
                <td>string[]</td>
                <td><span class="req req-no">no</span></td>
                <td>Tags for discovery</td>
              </tr>
              <tr>
                <td>langs</td>
                <td>string[]</td>
                <td><span class="req req-no">no</span></td>
                <td>Language codes</td>
              </tr>
            </tbody>
          </table>

          <pre>
            <span class="code-label">putRecord</span>
            <code dangerouslySetInnerHTML={{__html: `{
  <span class="json-key">"repo"</span>: <span class="json-str">"did:plc:your-did-here"</span>,
  <span class="json-key">"collection"</span>: <span class="json-str">"site.standard.document"</span>,
  <span class="json-key">"rkey"</span>: <span class="json-str">"hello-world"</span>,
  <span class="json-key">"record"</span>: {
    <span class="json-key">"$type"</span>: <span class="json-str">"site.standard.document"</span>,
    <span class="json-key">"title"</span>: <span class="json-str">"Hello World"</span>,
    <span class="json-key">"content"</span>: <span class="json-str">"# Hello World\\n\\nThis is my first standard.site article."</span>,
    <span class="json-key">"publishedAt"</span>: <span class="json-str">"2026-06-17T12:00:00.000Z"</span>,
    <span class="json-key">"site"</span>: <span class="json-str">"https://example.com"</span>,
    <span class="json-key">"path"</span>: <span class="json-str">"/hello-world"</span>,
    <span class="json-key">"tags"</span>: [<span class="json-str">"hello-world"</span>, <span class="json-str">"standard-site"</span>],
    <span class="json-key">"langs"</span>: [<span class="json-str">"en"</span>]
  }
}`}} />
          </pre>

          <div class="callout callout-success">
            <div class="callout-title">✅ That's it for storage</div>
            <p>
              Two records in your PDS. Any standard.site-compatible indexer (like <a href="https://blogs.social">blogs.social</a>)
              will now discover your content via the AT Protocol firehose.
            </p>
          </div>

          {/* ── Step 3: Verification ─────────────────────── */}
          <hr />
          <h2>Verification</h2>
          <p>
            Anyone can create a record claiming to be from <code>example.com</code>. Verification proves that
            the domain owner actually controls the AT Protocol identity. There are two mechanisms:
          </p>

          <div class="step">
            <span class="step-num">A</span>
            <h3>Publication: <code>.well-known</code></h3>
          </div>
          <p>
            Serve a plain-text file at <code>/.well-known/site.standard.publication</code> containing
            the exact AT-URI of your publication record:
          </p>

          <pre>
            <span class="code-label">GET /.well-known/site.standard.publication</span>
            <code dangerouslySetInnerHTML={{__html: `at://did:plc:your-did-here/site.standard.publication/self`}} />
          </pre>

          <p>That's the entire response body—just the URI as plain text. Indexers fetch this endpoint, compare
          it to the publication record's AT-URI, and if they match, the publication is verified.</p>

          <div class="step">
            <span class="step-num">B</span>
            <h3>Document: <code>&lt;link&gt;</code> tag</h3>
          </div>
          <p>
            For each article, add a <code>&lt;link&gt;</code> tag in the page's <code>&lt;head&gt;</code>:
          </p>

          <pre>
            <span class="code-label">HTML</span>
            <code dangerouslySetInnerHTML={{__html: `<span class="json-key">&lt;link</span>
  <span class="json-str">rel</span>=<span class="json-str">"site.standard.document"</span>
  <span class="json-str">href</span>=<span class="json-str">"at://did:plc:your-did/site.standard.document/hello-world"</span>
<span class="json-key">/&gt;</span>`}} />
          </pre>

          <div class="callout callout-info">
            <div class="callout-title">🔗 Cascading verification</div>
            <p>
              If a document's <code>site</code> field is an AT-URI pointing to a verified publication,
              the document inherits that verification automatically—no <code>&lt;link&gt;</code> tag needed.
            </p>
          </div>

          {/* ── This page ────────────────────────────────── */}
          <hr />
          <h2>This Very Page</h2>
          <p>
            This article practices what it preaches. Here's exactly what makes it compliant:
          </p>

          <h3>1. The publication record</h3>
          <pre>
            <span class="code-label">open.news publication</span>
            <code dangerouslySetInnerHTML={{__html: `{
  <span class="json-key">"$type"</span>: <span class="json-str">"site.standard.publication"</span>,
  <span class="json-key">"name"</span>: <span class="json-str">"open.news"</span>,
  <span class="json-key">"url"</span>: <span class="json-str">"https://open.news"</span>,
  <span class="json-key">"createdAt"</span>: <span class="json-str">"2025-01-01T00:00:00.000Z"</span>
}

<span class="json-comment">// Stored at: at://${OPEN_NEWS_DID}/site.standard.publication/self</span>`}} />
          </pre>

          <h3>2. The document record for this article</h3>
          <pre>
            <span class="code-label">this article's document</span>
            <code dangerouslySetInnerHTML={{__html: `{
  <span class="json-key">"$type"</span>: <span class="json-str">"site.standard.document"</span>,
  <span class="json-key">"title"</span>: <span class="json-str">"Standard.site: Hello World"</span>,
  <span class="json-key">"content"</span>: <span class="json-str">"# Standard.site: Hello World\\n\\nThe simplest compliant..."</span>,
  <span class="json-key">"publishedAt"</span>: <span class="json-str">"2026-06-17T12:00:00.000Z"</span>,
  <span class="json-key">"site"</span>: <span class="json-str">"at://${OPEN_NEWS_DID}/site.standard.publication/self"</span>,
  <span class="json-key">"path"</span>: <span class="json-str">"/standard-site"</span>,
  <span class="json-key">"tags"</span>: [<span class="json-str">"standard-site"</span>, <span class="json-str">"at-protocol"</span>, <span class="json-str">"tutorial"</span>],
  <span class="json-key">"langs"</span>: [<span class="json-str">"en"</span>]
}

<span class="json-comment">// Stored at: ${DOCUMENT_URI}</span>`}} />
          </pre>

          <h3>3. The well-known endpoint</h3>
          <pre>
            <span class="code-label">GET https://open.news/.well-known/site.standard.publication</span>
            <code dangerouslySetInnerHTML={{__html: `${PUBLICATION_URI}`}} />
          </pre>

          <h3>4. The link tag (view source!)</h3>
          <pre>
            <span class="code-label">in &lt;head&gt;</span>
            <code dangerouslySetInnerHTML={{__html: `<span class="json-key">&lt;link</span>
  <span class="json-str">rel</span>=<span class="json-str">"site.standard.document"</span>
  <span class="json-str">href</span>=<span class="json-str">"${DOCUMENT_URI}"</span>
<span class="json-key">/&gt;</span>`}} />
          </pre>

          <div class="callout callout-success">
            <div class="callout-title">✅ Fully compliant</div>
            <p>
              Publication record ✓ Document record ✓ Well-known endpoint ✓ Link tag ✓
            </p>
          </div>

          {/* ── Graph records ────────────────────────────── */}
          <hr />
          <h2>Bonus: Social Graph</h2>
          <p>
            Standard.site also defines two graph records for social interactions:
          </p>

          <h3>Subscribe to a publication</h3>
          <pre>
            <span class="code-label">subscription</span>
            <code dangerouslySetInnerHTML={{__html: `{
  <span class="json-key">"$type"</span>: <span class="json-str">"site.standard.graph.subscription"</span>,
  <span class="json-key">"subject"</span>: <span class="json-str">"did:plc:author-did"</span>,
  <span class="json-key">"createdAt"</span>: <span class="json-str">"2026-06-17T12:00:00.000Z"</span>
}`}} />
          </pre>

          <h3>Recommend a document</h3>
          <pre>
            <span class="code-label">recommend</span>
            <code dangerouslySetInnerHTML={{__html: `{
  <span class="json-key">"$type"</span>: <span class="json-str">"site.standard.graph.recommend"</span>,
  <span class="json-key">"document"</span>: <span class="json-str">"at://did:plc:author/site.standard.document/rkey"</span>,
  <span class="json-key">"createdAt"</span>: <span class="json-str">"2026-06-17T12:00:00.000Z"</span>
}`}} />
          </pre>

          {/* ── Links ────────────────────────────────────── */}
          <hr />
          <h2>Learn More</h2>
          <ul>
            <li><a href="https://standard.site">standard.site</a> — official documentation</li>
            <li><a href="https://standard.site/docs/introduction/">Introduction</a> — design principles</li>
            <li><a href="https://standard.site/docs/lexicons/">Lexicon definitions</a> — full schema reference</li>
            <li><a href="https://standard.site/docs/verification/">Verification</a> — verification flow details</li>
            <li><a href="https://blogs.social">blogs.social</a> — a standard.site indexer and reader</li>
            <li><a href="https://leaflet.pub">leaflet.pub</a> — a standard.site writing platform</li>
            <li><a href="https://pdsls.dev/at://did:plc:re3ebnp5v7ffagz6rb6xfei4/com.atproto.lexicon.schema">pdsls.dev</a> — browse the lexicons on-chain</li>
          </ul>

          <div class="callout callout-warn">
            <div class="callout-title">⚠️ Standard.site is evolving</div>
            <p>
              The lexicons are maintained by the community of developers building on them.
              Check the <a href="https://standard.site">official docs</a> for the latest schema definitions.
            </p>
          </div>
        </article>

        <footer class="article-footer">
          <p>
            Published by <a href="https://open.news">open.news</a> ·{' '}
            <a href={`https://pdsls.dev/${DOCUMENT_URI}`}>View on PDS</a> ·{' '}
            <a href="https://standard.site">standard.site</a>
          </p>
        </footer>
      </body>
    </html>
  );
}
