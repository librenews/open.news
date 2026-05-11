import { html, raw } from 'hono/html';
import { LeafletDocument, LeafletBlock } from '../../weblog/lexicons.js';

function renderFacets(plaintext: string, facets: any[]) {
  if (!facets || !Array.isArray(facets) || facets.length === 0) return plaintext;
  
  let result = plaintext;
  const isBold = facets.some(f => f?.features?.some?.((feat: any) => feat?.$type === 'pub.leaflet.richtext.facet#bold'));
  const isItalic = facets.some(f => f?.features?.some?.((feat: any) => feat?.$type === 'pub.leaflet.richtext.facet#italic'));
  const linkFacet = facets.find(f => f?.features?.some?.((feat: any) => feat?.$type === 'app.bsky.richtext.facet#link'));
  
  if (isBold) result = `<b>${result}</b>`;
  if (isItalic) result = `<i>${result}</i>`;
  
  if (linkFacet) {
    const linkObj = linkFacet.features.find((feat: any) => feat?.$type === 'app.bsky.richtext.facet#link');
    if (linkObj && linkObj.uri) {
       result = `<a href="${linkObj.uri}" style="color: inherit;">${result}</a>`;
    }
  }
  
  return result;
}

function renderLeafletBlocks(blocks: LeafletBlock[], did: string) {
  if (!Array.isArray(blocks)) return '';
  return blocks.map(b => {
    const block = b.block;
    if (!block) return '';
    
    switch (block.$type) {
      case 'pub.leaflet.blocks.header':
        const level = (block as any).level || 2;
        const text = renderFacets((block as any).plaintext || '', (block as any).facets || []);
        return html`<h${level} style="font-family: var(--font-sans); margin-top: 3rem; margin-bottom: 1.5rem; font-weight: 700; letter-spacing: -0.02em;">${raw(text)}</h${level}>`;
        
      case 'pub.leaflet.blocks.blockquote':
        const quoteText = renderFacets((block as any).plaintext || '', (block as any).facets || []);
        return html`<blockquote style="border-left: 3px solid rgba(0,0,0,0.8); padding-left: 1rem; font-style: italic; margin-left: 0;">${raw(quoteText)}</blockquote>`;
        
      case 'pub.leaflet.blocks.code':
        return html`<pre style="background: #1a1a1a; color: #fff; padding: 1rem; border-radius: 8px; overflow-x: auto; font-family: monospace;"><code>${(block as any).plaintext}</code></pre>`;
        
      case 'pub.leaflet.blocks.image':
        const imageRef = (block as any).image;
        if (!imageRef) return '';
        
        let cid = '';
        if (typeof imageRef === 'string') {
          cid = imageRef;
        } else if (imageRef.ref) {
          if (typeof imageRef.ref === 'string') {
            cid = imageRef.ref;
          } else if (imageRef.ref.$link) {
            cid = imageRef.ref.$link;
          } else if (typeof imageRef.ref.toString === 'function' && imageRef.ref.toString() !== '[object Object]') {
            cid = imageRef.ref.toString();
          }
        }
        
        if (!cid) return '';
        const src = `/blob/${did}/${cid}`;
        return html`<img src="${src}" alt="${(block as any).alt || ''}" style="max-width: 100%; border-radius: 8px; margin: 1.5rem 0; box-shadow: 0 4px 12px rgba(0,0,0,0.1);" />`;
        
      case 'pub.leaflet.blocks.iframe':
        const iframeUrl = (block as any).url;
        if (!iframeUrl) return '';
        return html`
          <div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; border-radius: 8px; margin: 1.5rem 0; background: #1a1a1a;">
            <iframe 
              src="${iframeUrl}" 
              style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;"
              allowfullscreen 
              sandbox="allow-scripts allow-same-origin allow-popups"
            ></iframe>
          </div>
        `;

      case 'pub.leaflet.blocks.website':
        const webUrl = (block as any).src || (block as any).url;
        if (!webUrl) return '';
        try {
           const parsedUrl = new URL(webUrl);
           const domain = parsedUrl.hostname.replace(/^www\./, '');
           return html`
             <a href="${webUrl}" target="_blank" rel="noopener noreferrer" style="display: flex; flex-direction: column; padding: 1.5rem; border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; text-decoration: none; color: inherit; margin: 1.5rem 0; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='rgba(0,0,0,0.02)'" onmouseout="this.style.backgroundColor='transparent'">
               <span style="font-weight: 600; font-family: var(--font-sans); margin-bottom: 0.25rem;">${webUrl}</span>
               <span style="font-size: 14px; color: var(--text-muted); font-family: var(--font-sans);">External Link • ${domain}</span>
             </a>
           `;
        } catch(e) {
           return html`<a href="${webUrl}" style="color: #118156; word-break: break-all;">${webUrl}</a>`;
        }
        
      case 'pub.leaflet.blocks.text':
      default:
        const pText = renderFacets((block as any).plaintext || '', (block as any).facets || []);
        // Handle newlines
        const lines = pText.split('\n').join('<br />');
        return html`<p style="margin-top: 1.25rem; margin-bottom: 1.25rem; min-height: 1.5rem;">${raw(lines)}</p>`;
    }
  });
}

export function ReaderPage(doc: LeafletDocument, authorDid: string, profile: any) {
  const date = new Date(doc.publishedAt || Date.now());
  const formattedDate = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const displayName = profile?.displayName || profile?.handle || authorDid;
  const avatar = profile?.avatar || '';

  let blocks: LeafletBlock[] = [];
  let isMarkdownString = false;
  let rawMarkdown = '';
  
  if ((doc as any).content?.pages && (doc as any).content.pages.length > 0) {
    blocks = ((doc as any).content.pages[0] as any).blocks || [];
  } else if (doc.pages && doc.pages.length > 0) {
    blocks = (doc.pages[0] as any).blocks || [];
  } else if (typeof (doc as any).content === 'string') {
    isMarkdownString = true;
    rawMarkdown = (doc as any).content;
  }

  // Calculate external read URL if available
  const rkey = (doc as any).rkey || 'self';
  
  const originalUrl = (doc as any).publicationUrl 
      ? (doc as any).publicationUrl + ((doc as any).path || '')
      : (doc as any).site && !(doc as any).site.startsWith('at://') && (doc as any).path 
        ? `${(doc as any).site}${(doc as any).path}`
        : isMarkdownString 
          ? `https://whtwnd.com/${profile?.handle || authorDid}/${rkey}`
          : null;

  const pubTitle = (doc as any).publicationTitle || null;

  return html`
    <article class="prose" style="margin-top: 2rem;">
      <header style="margin-bottom: 3rem;">
        ${originalUrl ? html`
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; padding: 0.75rem 1.25rem; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px; font-family: var(--font-sans);">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <div style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: var(--bg); border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
              </div>
              <span style="font-weight: 700; font-size: 21px;">${pubTitle || 'External Publication'}</span>
            </div>
            <a href="${originalUrl}" target="_blank" rel="noopener noreferrer" style="color: var(--text-main); font-weight: 600; font-size: 14px; text-decoration: none; display: flex; align-items: center; gap: 0.35rem; padding: 0.4rem 0.8rem; border: 1px solid var(--border); border-radius: 99px; transition: background 0.15s;" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background='transparent'">
              Visit Post
              <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </a>
          </div>
        ` : ''}
        <h1 style="font-family: var(--font-sans); font-size: 42px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 1.5rem; line-height: 1.2;">
          ${doc.title}
        </h1>
        
        <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid rgba(0,0,0,0.1); border-bottom: 1px solid rgba(0,0,0,0.1); padding: 1rem 0;">
          <div style="display: flex; align-items: center; gap: 1rem;">
            ${avatar ? html`<img src="${avatar}" style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover;" />` : ''}
            <div style="display: flex; flex-direction: column;">
              <span style="font-family: var(--font-sans); font-weight: 600; font-size: 15px;">${displayName}</span>
              <span style="color: var(--text-muted); font-size: 14px; font-family: var(--font-sans);">${formattedDate}</span>
            </div>
          </div>
          
          <div style="display: flex; align-items: center; gap: 1rem; color: var(--text-muted);">
            <button id="btn-like" onclick="handleArticleAction('like', '${authorDid}', '${doc.title}')" style="background: none; border: none; cursor: pointer; color: inherit; display: flex; align-items: center; gap: 0.4rem; font-family: var(--font-sans); font-size: 14px; transition: color 0.2s;" onmouseover="if(!this.dataset.active) this.style.color='#f02050'" onmouseout="if(!this.dataset.active) this.style.color='inherit'">
              <svg id="icon-like" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
              <span id="count-like">Like</span>
            </button>
            <button id="btn-repost" onclick="handleArticleAction('repost', '${authorDid}', '${doc.title}')" style="background: none; border: none; cursor: pointer; color: inherit; display: flex; align-items: center; gap: 0.4rem; font-family: var(--font-sans); font-size: 14px; transition: color 0.2s;" onmouseover="if(!this.dataset.active) this.style.color='#20d070'" onmouseout="if(!this.dataset.active) this.style.color='inherit'">
              <svg id="icon-repost" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M17 1l4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><path d="M7 23l-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
              <span id="count-repost">Repost</span>
            </button>
            <a href="/post/${authorDid}/${rkey}/source" target="_blank" rel="noopener noreferrer" style="background: none; border: none; cursor: pointer; color: inherit; text-decoration: none; display: flex; align-items: center; gap: 0.4rem; font-family: var(--font-sans); font-size: 14px; transition: color 0.2s;" onmouseover="this.style.color='var(--text-main)'" onmouseout="this.style.color='inherit'" title="View raw AT Protocol record">
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
              <span>Source</span>
            </a>
          </div>
        </div>
      </header>
      
      <div class="content">
        ${isMarkdownString 
          ? rawMarkdown.split('\\n\\n').map(p => html`<p style="margin-top: 1.25rem; margin-bottom: 1.25rem; min-height: 1.5rem; word-break: break-word;">${raw(p.replace(/\\n/g, '<br />'))}</p>`)
          : blocks.length > 0 
            ? renderLeafletBlocks(blocks, authorDid)
            : (doc as any).textContent
              ? (doc as any).textContent.split('\\n\\n').map((p: string) => html`<p style="margin-top: 1.25rem; margin-bottom: 1.25rem; min-height: 1.5rem; word-break: break-word;">${raw(p.replace(/\\n/g, '<br />'))}</p>`)
              : html`
                  <div style="text-align: center; padding: 4rem 2rem; background: var(--bg-secondary); border-radius: 12px; margin-top: 2rem;">
                    <svg viewBox="0 0 24 24" width="48" height="48" stroke="var(--text-muted)" stroke-width="1.5" fill="none" style="margin-bottom: 1rem;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="9" y1="15" x2="15" y2="15"></line></svg>
                    <h3 style="font-family: var(--font-sans); font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-main);">Unsupported Format</h3>
                    <p style="color: var(--text-secondary); margin-bottom: 1.5rem; max-width: 400px; margin-left: auto; margin-right: auto; line-height: 1.5;">This article uses a formatting structure that our native reader doesn't support yet. We've logged this format so we can add support for it soon!</p>
                    ${originalUrl ? html`
                      <a href="${originalUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1.5rem; background: var(--accent); color: var(--bg); font-weight: 600; font-family: var(--font-sans); text-decoration: none; border-radius: 99px; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
                        Read on Original Site
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                      </a>
                    ` : ''}
                  </div>
                `
        }
      </div>
    </article>
    
    <div id="comments-container" style="margin-top: 4rem; padding-top: 2rem; border-top: 1px solid rgba(0,0,0,0.1); max-width: var(--container-width);">
      <h3 style="font-family: var(--font-sans); font-size: 20px; font-weight: 600; margin-bottom: 1.5rem; letter-spacing: -0.01em;">Discussion in the ATmosphere</h3>
      <div id="comments-list">
        <div style="color: var(--text-muted); font-size: 14px; font-family: var(--font-sans);">Loading comments...</div>
      </div>
    </div>
    
    <script>
      (async function() {
        try {
          const url = encodeURIComponent(window.location.href);
          const res = await fetch('/api/comments?url=' + url);
          const data = await res.json();
          
          const container = document.getElementById('comments-list');
          if (!data.posts || data.posts.length === 0) {
            container.innerHTML = '<div style="color: var(--text-muted); font-size: 14px; font-family: var(--font-sans);">Be the first to discuss this article in the ATmosphere!</div>';
            return;
          }
          
          let html = '';
          for (const post of data.posts) {
            const author = post.author;
            const text = post.record.text || '';
            const avatar = author.avatar ? \`<img src="\${author.avatar}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover;" />\` : \`<div style="width: 36px; height: 36px; border-radius: 50%; background: rgba(0,0,0,0.1);"></div>\`;
            
            const postDate = new Date(post.indexedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const postUri = post.uri.replace('at://', '').split('/');
            const bskyUrl = \`https://bsky.app/profile/\${author.handle}/post/\${postUri[2]}\`;
            
            html += \`
              <div style="display: flex; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid rgba(0,0,0,0.05);">
                <a href="https://bsky.app/profile/\${author.handle}" target="_blank" style="flex-shrink: 0;">\${avatar}</a>
                <div style="flex-grow: 1;">
                  <div style="display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.25rem;">
                    <a href="https://bsky.app/profile/\${author.handle}" target="_blank" style="font-family: var(--font-sans); font-weight: 600; color: var(--text-main); text-decoration: none; font-size: 14px;">\${author.displayName || author.handle}</a>
                    <span style="color: var(--text-muted); font-size: 13px; font-family: var(--font-sans);">@\${author.handle} · \${postDate}</span>
                  </div>
                  <div style="font-family: var(--font-sans); font-size: 15px; line-height: 1.5; color: var(--text-main); margin-bottom: 0.5rem; word-break: break-word;">
                    \${text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\n/g, '<br/>')}
                  </div>
                  <div style="display: flex; gap: 1.5rem; color: var(--text-muted); font-size: 13px; font-family: var(--font-sans);">
                    <a href="\${bskyUrl}" target="_blank" style="color: inherit; text-decoration: none; display: flex; align-items: center; gap: 0.25rem; transition: color 0.2s;" onmouseover="this.style.color='#1185fe'" onmouseout="this.style.color='inherit'">
                      <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                      Reply
                    </a>
                    <button onclick="handleCommentAction(this, 'repost', '\${post.uri}', '\${post.cid}')" style="background: none; border: none; cursor: pointer; color: inherit; display: flex; align-items: center; gap: 0.25rem; font-family: inherit; font-size: inherit; padding: 0; transition: color 0.2s;" onmouseover="if(!this.dataset.active) this.style.color='#20d070'" onmouseout="if(!this.dataset.active) this.style.color='inherit'">
                      <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M17 1l4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><path d="M7 23l-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
                      <span class="count">\${post.repostCount || 0}</span>
                    </button>
                    <button onclick="handleCommentAction(this, 'like', '\${post.uri}', '\${post.cid}')" style="background: none; border: none; cursor: pointer; color: inherit; display: flex; align-items: center; gap: 0.25rem; font-family: inherit; font-size: inherit; padding: 0; transition: color 0.2s;" onmouseover="if(!this.dataset.active) this.style.color='#f02050'" onmouseout="if(!this.dataset.active) this.style.color='inherit'">
                      <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" class="icon"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                      <span class="count">\${post.likeCount || 0}</span>
                    </button>
                  </div>
                </div>
              </div>
            \`;
          }
          container.innerHTML = html;
        } catch (err) {
          document.getElementById('comments-list').innerHTML = '<div style="color: red; font-size: 14px; font-family: var(--font-sans);">Failed to load comments from Bluesky</div>';
        }
      })();

      async function handleArticleAction(action, authorDid, title) {
        const parts = window.location.pathname.split('/');
        const rkey = parts[parts.length - 1];
        
        try {
          const res = await fetch(\`/api/\${action}\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rkey, authorDid, title })
          });
          const data = await res.json();
          if (res.status === 401) {
            alert('Please sign in to interact with articles.');
          } else if (data.success) {
            // Optimistic update
            const btn = document.getElementById(\`btn-\${action}\`);
            const icon = document.getElementById(\`icon-\${action}\`);
            const count = document.getElementById(\`count-\${action}\`);
            btn.dataset.active = "true";
            btn.style.color = action === 'like' ? '#f02050' : '#20d070';
            if (action === 'like') icon.setAttribute('fill', 'currentColor');
            let currentCount = parseInt(count.innerText) || 0;
            count.innerText = (currentCount + 1).toString();
          } else {
            alert(\`Failed to \${action}: \${data.error}\`);
          }
        } catch (err) {
          alert('Network error occurred.');
        }
      }

      async function handleCommentAction(btn, action, uri, cid) {
        try {
          const res = await fetch(\`/api/\${action}\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uri, cid })
          });
          const data = await res.json();
          if (res.status === 401) {
            alert('Please sign in to interact with comments.');
          } else if (data.success) {
            // Optimistic update
            btn.dataset.active = "true";
            btn.style.color = action === 'like' ? '#f02050' : '#20d070';
            const icon = btn.querySelector('.icon');
            if (icon && action === 'like') icon.setAttribute('fill', 'currentColor');
            const countSpan = btn.querySelector('.count');
            let currentCount = parseInt(countSpan.innerText) || 0;
            countSpan.innerText = (currentCount + 1).toString();
          } else {
            alert(\`Failed to \${action}: \${data.error}\`);
          }
        } catch (err) {
          alert('Network error occurred.');
        }
      }

      // Fetch stats on load
      (async function() {
        try {
          const parts = window.location.pathname.split('/');
          const rkey = parts[parts.length - 1];
          const authorDid = '${authorDid}';
          
          const res = await fetch(\`/api/stats?authorDid=\${authorDid}&rkey=\${rkey}\`);
          const data = await res.json();
          
          if (data.likes > 0 || data.liked) {
            document.getElementById('count-like').innerText = data.likes.toString();
          }
          if (data.liked) {
            const btn = document.getElementById('btn-like');
            btn.dataset.active = "true";
            btn.style.color = '#f02050';
            document.getElementById('icon-like').setAttribute('fill', 'currentColor');
          }
          
          if (data.reposts > 0 || data.reposted) {
            document.getElementById('count-repost').innerText = data.reposts.toString();
          }
          if (data.reposted) {
            const btn = document.getElementById('btn-repost');
            btn.dataset.active = "true";
            btn.style.color = '#20d070';
          }
        } catch (err) {
          console.error('Failed to fetch article stats');
        }
      })();
    </script>
  `;
}
