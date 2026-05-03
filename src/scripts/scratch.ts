import fs from 'fs';

const p = 'src/feeds/web.ts';
let code = fs.readFileSync(p, 'utf8');

const newCode = `// ─── Articles Search Endpoints ──────────────────────────────────────────────

function renderArticleHits(hits: any, q: string): string {
  if (!hits || hits.length === 0) {
    return \`<div id="article-results" class="p-4 space-y-4"><div class="text-center text-sm text-slate-500 py-12">No articles found matching "\${escapeHtml(q)}".</div></div>\`;
  }

  const resultsHtml = hits.map((hit: any) => {
    const source = hit._source;
    const highlight = hit.highlight;
    
    let snippetHtml = '';
    if (highlight) {
      const textHighlights = Object.keys(highlight)
        .filter(k => k.startsWith('text_content'))
        .flatMap(k => highlight[k]);
      
      if (textHighlights.length > 0) {
        snippetHtml = \`<div class="mt-3 text-sm text-slate-600 leading-relaxed border-l-2 border-indigo-200 pl-3 italic">"\${textHighlights[0]}"</div>\`;
      }
    }

    const publishedDate = source.published_at ? new Date(source.published_at).toLocaleDateString() : 'Unknown Date';
    const langBadge = source.language ? \`<span class="bg-slate-100 text-slate-500 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded">\${escapeHtml(source.language)}</span>\` : '';
    
    const words = source.word_count || 0;
    const minRead = Math.max(1, Math.ceil(words / 200));
    const lengthBadge = \`<span class="bg-indigo-50 text-indigo-600 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border border-indigo-100" title="\${words} words">\${minRead} min read</span>\`;
    
    let destUrl = \`https://bsky.app/profile/\${source.did}\`;
    if (source.site && source.path && source.site.startsWith('http')) {
      destUrl = \`\${source.site}\${source.path}\`;
    }

    let bskyLinkHtml = '';
    if (source.bsky_post_uri) {
      const parts = source.bsky_post_uri.replace('at://', '').split('/');
      if (parts.length >= 3) {
        const bskyUrl = \`https://bsky.app/profile/\${parts[0]}/post/\${parts[2]}\`;
        bskyLinkHtml = \`
          <a href="\${bskyUrl}" target="_blank" class="text-xs font-semibold text-blue-500 hover:text-blue-700 bg-blue-50 px-2 py-1 rounded-md transition-colors inline-flex items-center gap-1 mt-3">
            <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.415.656-.658 1.487-.658 2.443 0 3.997 3.394 6 5.236 6 1.842 0 5.236-2.003 5.236-6 0-.956-.243-1.787-.658-2.443.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.789.624-6.479 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z"/></svg>
            View Conversation
          </a>
        \`;
      }
    }

    const elementId = 'raw-' + Math.random().toString(36).substring(7);

    return \`
      <div class="block bg-white border border-slate-200 hover:border-indigo-300 rounded-xl p-5 transition-all hover:shadow-md group relative">
        <a href="\${destUrl}" target="_blank" rel="noopener noreferrer" class="no-underline block">
          <div class="flex justify-between items-start gap-4">
            <div class="min-w-0 flex-1">
              <h3 class="text-lg font-bold text-slate-900 group-hover:text-indigo-600 transition-colors break-words">\${escapeHtml(source.title || 'Untitled Article')}</h3>
              <div class="flex items-center gap-2 mt-1.5 flex-wrap">
                <span class="text-xs font-medium text-slate-500">\${publishedDate}</span>
                <span class="text-slate-300">•</span>
                <span class="text-xs text-slate-500 truncate font-mono bg-slate-50 px-1 rounded">\${escapeHtml(source.did)}</span>
                \${langBadge}
                \${lengthBadge}
              </div>
              \${snippetHtml}
            </div>
            <div class="shrink-0 text-slate-400 group-hover:text-indigo-500 transition-colors">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
            </div>
          </div>
        </a>
        
        \${bskyLinkHtml}
        
        <div class="mt-4 pt-4 border-t border-slate-100 flex justify-end">
          <button class="text-xs font-mono text-slate-500 hover:text-indigo-600 transition-colors flex items-center gap-1.5"
                  hx-get="/api/articles/raw?uri=\${encodeURIComponent(source.uri)}"
                  hx-target="#\${elementId}"
                  hx-swap="innerHTML">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>
            View Source JSON
          </button>
        </div>
        <div id="\${elementId}" class="mt-2 empty:hidden"></div>
      </div>
    \`;
  }).join('');

  return \`<div id="article-results" class="p-4 space-y-4">\${resultsHtml}</div>\`;
}

app.get('/articles', async (c) => {
  const userId = c.get('userId');
  const user = await getFeedUserById(userId);
  if (!user) return c.redirect('/login');

  const q = c.req.query('q') || '';
  const len = c.req.query('len') || 'all';

  let resultsHtml = \`<div id="article-results" class="p-4 space-y-4"><div class="text-center text-sm text-slate-400 py-12">Enter a search query to explore the ecosystem.</div></div>\`;
  
  if (q) {
    try {
      const hits = await searchSiteStandardArticles(q, len as 'all' | 'long');
      resultsHtml = renderArticleHits(hits.hits, q);
    } catch (err) {
      logger.error({ err, q }, 'Failed to search articles');
      resultsHtml = \`<div id="article-results" class="p-4 space-y-4"><div class="text-center text-sm text-red-500 py-12">An error occurred while searching.</div></div>\`;
    }
  }

  if (c.req.header('HX-Request') === 'true' && c.req.header('HX-Target') === 'article-results') {
    return c.html(resultsHtml);
  }

  const content = \`
    <div class="max-w-4xl mx-auto w-full p-6 pt-10 overflow-y-auto">
      <div class="mb-4">
        <a href="/" class="text-sm text-indigo-500 hover:text-indigo-700 transition-colors no-underline font-semibold">&larr; Back to Dashboard</a>
      </div>
      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col pb-6">
        <div class="px-6 py-6 border-b border-slate-100 bg-slate-50 flex flex-col items-center justify-center text-center">
          <h2 class="text-2xl font-bold text-slate-800">Global Article Search</h2>
          <p class="text-sm text-slate-500 mt-2 max-w-lg">Search the entire AT Protocol ecosystem for long-form content. Indexed securely via site.standard.document.</p>
        </div>
        <form hx-get="/articles" hx-target="#article-results" hx-swap="outerHTML" hx-push-url="true" class="p-6 border-b border-slate-100 bg-white sticky top-0 z-10 m-0">
          <div class="relative">
            <svg class="absolute left-4 top-3.5 h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" name="q" value="\${escapeHtml(q)}" placeholder="Search across millions of words... (e.g., 'artificial intelligence')" 
                   class="w-full bg-slate-50 border border-slate-200 text-slate-900 text-base rounded-xl focus:ring-indigo-500 focus:border-indigo-500 block py-3 pl-12 pr-4 outline-none transition-shadow hover:shadow-sm"
                   hx-trigger="input changed delay:500ms, search" 
                   hx-indicator="#search-indicator"
                   autofocus>
          </div>
          <div class="mt-4 flex items-center gap-6 justify-center text-sm font-semibold text-slate-600">
            <label class="flex items-center gap-2 cursor-pointer hover:text-indigo-600 transition-colors">
              <input type="radio" name="len" value="all" \${len !== 'long' ? 'checked' : ''} class="w-4 h-4 text-indigo-600 focus:ring-indigo-500" hx-get="/articles" hx-target="#article-results" hx-swap="outerHTML" hx-push-url="true" hx-indicator="#search-indicator">
              Everything
            </label>
            <label class="flex items-center gap-2 cursor-pointer hover:text-indigo-600 transition-colors">
              <input type="radio" name="len" value="long" \${len === 'long' ? 'checked' : ''} class="w-4 h-4 text-indigo-600 focus:ring-indigo-500" hx-get="/articles" hx-target="#article-results" hx-swap="outerHTML" hx-push-url="true" hx-indicator="#search-indicator">
              Longform Only (>100 words)
            </label>
          </div>
        </form>
        <div id="search-indicator" class="htmx-indicator flex justify-center py-4">
          <svg class="animate-spin h-6 w-6 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        </div>
        \${resultsHtml}
      </div>
    </div>
    <style>
      .htmx-indicator { display: none; }
      .htmx-request .htmx-indicator { display: flex; }
      .htmx-request.htmx-indicator { display: flex; }
    </style>
  \`;

  return c.html(renderLayout(user, content, 'Search Articles - feeds.social'));
});
`

const lines = code.split('\n');
const startIdx = lines.findIndex(l => l.includes('// ─── Articles Search Endpoints'));
const endIdx = lines.findIndex((l, i) => i > startIdx && l.startsWith("app.get('/api/articles/raw',"));

lines.splice(startIdx, endIdx - startIdx, newCode);
fs.writeFileSync(p, lines.join('\n'));
