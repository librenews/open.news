/** @jsxImportSource hono/jsx */

export interface ArticleSource {
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  post_uri: string | null;
}

export interface ArticleData {
  id: number;
  url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  author: string | null;
  published_at: string | null;
  site_name: string | null;
  fetch_status: string;
  sources: ArticleSource[];
  seen_at: string | null;
}

/** Convert an AT Protocol post URI to a bsky.app permalink. */
function postUrl(handle: string | null, postUri: string | null): string | null {
  if (!handle || !postUri) return null;
  const rkey = postUri.split('/').pop();
  if (!rkey) return null;
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

/** Proxy an image through weserv.nl — handles missing avatars gracefully. */
function proxyImg(url: string | null, w: number, circle = false): string | null {
  if (!url) return null;
  const params = `w=${w}&h=${w}&fit=cover&output=webp${circle ? '&mask=circle' : ''}`;
  return `https://images.weserv.nl/?url=${encodeURIComponent(url)}&${params}`;
}

const MAX_SHOWN_AVATARS = 5;

export const ArticleCard = ({ article }: { article: ArticleData }) => {
  const domain = (() => {
    try { return new URL(article.url).hostname.replace('www.', ''); }
    catch { return ''; }
  })();

  const published = article.published_at
    ? new Date(article.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  const metaParts = [
    domain,
    article.author,
    published,
  ].filter(Boolean);

  const sources = article.sources ?? [];
  const first = sources[0] ?? null;
  const rest = sources.slice(1, MAX_SHOWN_AVATARS);
  const overflow = sources.length > MAX_SHOWN_AVATARS ? sources.length - MAX_SHOWN_AVATARS : 0;

  const proxiedImage = article.image_url
    ? `https://images.weserv.nl/?url=${encodeURIComponent(article.image_url)}&w=200&h=140&fit=cover&output=webp`
    : null;

  return (
    <div class={`article-card clearfix${article.seen_at ? ' seen' : ''}`}>
      {proxiedImage && (
        <img
          class="article-image"
          src={proxiedImage}
          alt=""
          loading="lazy"
          width="100"
          height="70"
          onerror="this.style.display='none'"
        />
      )}

      <a href={article.url} target="_blank" rel="noopener noreferrer">
        <strong>{article.title || article.url}</strong>
      </a>

      {article.description && (
        <p style="margin: 0.25rem 0; font-size: 0.9rem;">{article.description}</p>
      )}

      <p class="article-meta">
        {article.fetch_status === 'paywalled' && (
          <span title="Paywall — article may require a subscription" style="margin-right:0.3rem">🔒</span>
        )}
        {metaParts.join(' · ')}
      </p>

      {/* Shared-by section */}
      {sources.length > 0 && (
        <div class="shared-by">
          {first && (() => {
            const url = postUrl(first.handle, first.post_uri);
            const avatar = proxyImg(first.avatar_url, 20, true);
            const name = first.display_name || (first.handle ? `@${first.handle}` : null);
            return (
              <span class="shared-first">
                {avatar && <img src={avatar} width="20" height="20" alt="" onerror="this.style.display='none'" />}
                {url ? <a href={url} target="_blank" rel="noopener noreferrer">{name}</a> : <span>{name}</span>}
              </span>
            );
          })()}

          {rest.length > 0 && (
            <span class="shared-rest">
              {rest.map((s) => {
                const url = postUrl(s.handle, s.post_uri);
                const avatar = proxyImg(s.avatar_url, 18, true);
                const label = s.display_name || (s.handle ? `@${s.handle}` : '');
                return avatar && (
                  <span class="shared-avatar" key={s.handle}>
                    {url
                      ? <a href={url} target="_blank" rel="noopener noreferrer" title={label}>
                          <img src={avatar} width="18" height="18" alt={label} onerror="this.style.display='none'" />
                        </a>
                      : <img src={avatar} width="18" height="18" alt={label} onerror="this.style.display='none'" />
                    }
                  </span>
                );
              })}
            </span>
          )}

          {overflow > 0 && <span class="shared-overflow">+{overflow}</span>}
        </div>
      )}
    </div>
  );
};
