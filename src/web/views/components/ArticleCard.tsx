/** @jsxImportSource hono/jsx */

export interface ArticleData {
  id: number;
  url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  author: string | null;
  published_at: string | null;
  site_name: string | null;
  sources: { handle: string | null; display_name: string | null }[];
  seen_at: string | null;
}

export const ArticleCard = ({ article }: { article: ArticleData }) => {
  const domain = (() => {
    try {
      return new URL(article.url).hostname.replace('www.', '');
    } catch {
      return '';
    }
  })();

  const sharedBy = article.sources
    .slice(0, 2)
    .map((s) => s.display_name || `@${s.handle}`)
    .join(', ');
  const overflow =
    article.sources.length > 2 ? ` +${article.sources.length - 2} more` : '';

  const metaParts = [
    domain,
    article.author,
    article.published_at
      ? new Date(article.published_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : null,
    `shared by ${sharedBy}${overflow}`,
  ].filter(Boolean);

  return (
    <div class={`article-card clearfix${article.seen_at ? ' seen' : ''}`}>
      {article.image_url && (
        <img
          class="article-image"
          src={article.image_url}
          alt=""
          loading="lazy"
          width="100"
          height="70"
        />
      )}
      <a href={article.url} target="_blank" rel="noopener noreferrer">
        <strong>{article.title || article.url}</strong>
      </a>
      {article.description && (
        <p style="margin: 0.25rem 0; font-size: 0.9rem;">{article.description}</p>
      )}
      <p class="article-meta">{metaParts.join(' · ')}</p>
    </div>
  );
};
