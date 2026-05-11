/** @jsxImportSource hono/jsx */
import { BASE_STYLES, HEADER_STYLES, NAV_STYLES, FontLinks, TopHeader, LeftNav } from './partials.js';
import type { UserProfile } from './partials.js';

const SOURCE_STYLES = `
/* Source page */
.source-container {
  max-width: 900px;
  margin: 2rem auto;
  padding: 0 1.5rem;
  font-family: var(--font-sans);
}
.source-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  gap: 1rem;
}
.source-header h1 {
  font-family: var(--font-body);
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-main);
  margin: 0;
}
.source-header h1 code {
  background: rgba(99,102,241,0.1);
  color: #6366f1;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  font-size: 0.9em;
}
.source-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.source-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.85rem;
  font-size: 0.8rem;
  font-weight: 600;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-main);
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: var(--font-sans);
  text-decoration: none;
}
.source-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.source-btn.copied {
  border-color: #10b981;
  color: #10b981;
}
.source-meta {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}
.source-meta-item {
  font-size: 0.72rem;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.source-meta-item strong {
  color: var(--text-secondary);
  font-weight: 600;
}
.source-block {
  position: relative;
  background: #1e1e2e;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.06);
  overflow: hidden;
}
.source-block pre {
  margin: 0;
  padding: 1.25rem;
  overflow-x: auto;
  font-size: 0.78rem;
  line-height: 1.6;
  font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
  color: #cdd6f4;
  -webkit-overflow-scrolling: touch;
}
.source-block .line-numbers {
  position: absolute;
  top: 1.25rem;
  left: 0;
  width: 3rem;
  text-align: right;
  padding-right: 0.75rem;
  font-size: 0.78rem;
  line-height: 1.6;
  font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
  color: #585b70;
  user-select: none;
  pointer-events: none;
}
.source-block pre code {
  padding-left: 3.25rem;
  display: block;
}

/* JSON syntax highlighting */
.json-key { color: #89b4fa; }
.json-string { color: #a6e3a1; }
.json-number { color: #fab387; }
.json-bool { color: #cba6f7; }
.json-null { color: #6c7086; font-style: italic; }
.json-bracket { color: #f5c2e7; }
.json-colon { color: #9399b2; }

.source-footer {
  margin-top: 1.25rem;
  padding: 0.75rem 0;
  font-size: 0.7rem;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.source-footer a {
  color: var(--accent);
  text-decoration: none;
}
.source-footer a:hover { text-decoration: underline; }
`;

interface SourcePageProps {
  rkey: string;
  did: string;
  recordJson: string;
  collection: string;
  title: string;
  domain: string;
  sessionProfile?: UserProfile;
}

export function ArticleSourcePage({
  rkey,
  did,
  recordJson,
  collection,
  title,
  domain,
  sessionProfile,
}: SourcePageProps) {
  const atUri = `at://${did}/${collection}/${rkey}`;
  const byteSize = new TextEncoder().encode(recordJson).length;
  const sizeLabel = byteSize > 1024 ? `${(byteSize / 1024).toFixed(1)} KB` : `${byteSize} B`;

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`Source: ${title} — ${domain}`}</title>
        <meta name="robots" content="noindex" />
        <FontLinks />
        <style dangerouslySetInnerHTML={{ __html: BASE_STYLES + HEADER_STYLES + NAV_STYLES + SOURCE_STYLES }} />
      </head>
      <body>
        <TopHeader domain={domain} sessionProfile={sessionProfile} />
        <LeftNav activePath="/article" sessionProfile={sessionProfile} />

        <main class="main-content">
          <div class="source-container">
            <div class="source-header">
              <h1>
                Source: <code>{rkey}</code>
              </h1>
              <div class="source-actions">
                <a href={`/article/${rkey}`} class="source-btn">← Back to Article</a>
                <button id="copy-btn" class="source-btn" onclick="copySource()">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                  Copy JSON
                </button>
              </div>
            </div>

            <div class="source-meta">
              <div class="source-meta-item"><strong>Collection:</strong> {collection}</div>
              <div class="source-meta-item"><strong>AT-URI:</strong> {atUri}</div>
              <div class="source-meta-item"><strong>Size:</strong> {sizeLabel}</div>
            </div>

            <div class="source-block">
              <pre><code id="source-code" dangerouslySetInnerHTML={{ __html: syntaxHighlight(recordJson) }} /></pre>
            </div>

            <div class="source-footer">
              <span>AT Protocol record from</span>
              <a href={`https://pds.${domain}`} target="_blank" rel="noopener">{did}</a>
            </div>
          </div>
        </main>

        <script dangerouslySetInnerHTML={{ __html: `
          var rawJson = ${JSON.stringify(recordJson)};
          function copySource() {
            navigator.clipboard.writeText(rawJson).then(function() {
              var btn = document.getElementById('copy-btn');
              btn.classList.add('copied');
              btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
              setTimeout(function() {
                btn.classList.remove('copied');
                btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy JSON';
              }, 2000);
            });
          }
        `}} />
      </body>
    </html>
  );
}

/**
 * Basic JSON syntax highlighter that wraps tokens in <span> elements with class names.
 */
function syntaxHighlight(json: string): string {
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = 'json-number';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'json-key';
            // Remove the trailing colon, wrap the key, then re-add colon with its own class
            const key = match.slice(0, -1);
            return `<span class="${cls}">${key}</span><span class="json-colon">:</span>`;
          } else {
            cls = 'json-string';
          }
        } else if (/true|false/.test(match)) {
          cls = 'json-bool';
        } else if (/null/.test(match)) {
          cls = 'json-null';
        }
        return `<span class="${cls}">${match}</span>`;
      }
    )
    // Highlight brackets
    .replace(/([{}\[\]])/g, '<span class="json-bracket">$1</span>');
}
