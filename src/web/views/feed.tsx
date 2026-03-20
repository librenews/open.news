/** @jsxImportSource hono/jsx */
import { Layout } from './layout.js';
import { ArticleCard, type ArticleData } from './components/ArticleCard.js';

export const FeedPage = ({
  articles,
  user,
  nextCursor,
  notice,
}: {
  articles: ArticleData[];
  user: { handle: string };
  nextCursor: string | null;
  notice?: string | null;
}) => (
  <Layout title="Feed" user={user}>
    <h2>Your feed</h2>
    {notice === 'sync_queued' && (
      <p><mark>✓ Follow sync started — check back in a minute.</mark></p>
    )}
    {notice === 'sync_rate_limited' && (
      <p><mark>⏳ Already synced recently — try again in an hour.</mark></p>
    )}
    {articles.length === 0 && (
      <p>
        No articles yet — your followed accounts haven't shared any news links
        since you signed up. Check back soon, or{' '}
        <form action="/api/sources/sync" method="post" style="display:inline">
          <button type="submit" class="outline" style="display:inline;padding:0.1rem 0.5rem;font-size:inherit">
            sync your follows
          </button>
        </form>
        .
      </p>
    )}
    <div id="article-list">
      {articles.map((a) => (
        <ArticleCard article={a} />
      ))}
    </div>
    {nextCursor && (
      <p style="text-align:center; margin: 2rem 0;">
        <a href={`/feed?before=${nextCursor}`} role="button" class="outline">
          Load more
        </a>
      </p>
    )}
  </Layout>
);
