/** @jsxImportSource hono/jsx */
import { Layout } from './layout.js';

interface FeedbackItem {
  id: string;
  user_handle: string;
  user_display_name: string | null;
  category: string;
  summary: string;
  raw_text: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
}

interface FeedbackCounts {
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  total: number;
}

const ago = (iso: string) => {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
};

const categoryEmoji: Record<string, string> = {
  suggestion: '💡',
  bug: '🐛',
  question: '❓',
  praise: '🌟',
};

const statusBadge: Record<string, string> = {
  new: 'background:#4a90d9;color:#fff',
  reviewed: 'background:#f5a623;color:#fff',
  planned: 'background:#7ed321;color:#fff',
  declined: 'background:#9b9b9b;color:#fff',
};

export const AdminProductPage = ({
  feedback,
  counts,
  user,
  filter,
}: {
  feedback: FeedbackItem[];
  counts: FeedbackCounts;
  user: { handle: string };
  filter: { status?: string; category?: string };
}) => (
  <Layout title="Product Feedback" user={user}>
    <hgroup>
      <h2>Product Feedback</h2>
      <p>User feedback collected from chat interactions</p>
    </hgroup>

    {/* Summary cards */}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:0.75rem;margin-bottom:1.5rem">
      <article style="text-align:center;padding:0.75rem;margin:0">
        <strong style="font-size:1.8rem">{counts.total}</strong><br />
        <small>Total</small>
      </article>
      {['new', 'reviewed', 'planned', 'declined'].map((s) => (
        <article style="text-align:center;padding:0.75rem;margin:0">
          <strong style="font-size:1.8rem">{counts.byStatus[s] ?? 0}</strong><br />
          <small style={statusBadge[s] + ';padding:2px 6px;border-radius:4px;font-size:0.75rem'}>{s}</small>
        </article>
      ))}
    </div>

    {/* Category counts */}
    <div style="display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap">
      {['suggestion', 'bug', 'question', 'praise'].map((cat) => (
        <a href={filter.category === cat ? '/admin/product' : `/admin/product?category=${cat}`}
           style={`text-decoration:none;padding:0.4rem 0.8rem;border-radius:8px;border:1px solid var(--pico-muted-border-color);${filter.category === cat ? 'background:var(--pico-primary-background);color:var(--pico-primary-inverse)' : ''}`}>
          {categoryEmoji[cat] ?? ''} {cat} ({counts.byCategory[cat] ?? 0})
        </a>
      ))}
      {filter.category && (
        <a href="/admin/product" style="padding:0.4rem 0.8rem">Clear filter</a>
      )}
    </div>

    {/* Feedback list */}
    {feedback.length === 0 ? (
      <article style="text-align:center;padding:2rem">
        <p>No feedback yet. Users will see this collected as they chat.</p>
      </article>
    ) : (
      <div>
        {feedback.map((f) => (
          <article id={`feedback-${f.id}`} style="margin-bottom:1rem;padding:1rem">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
              <div>
                <span style="font-size:1.2rem">{categoryEmoji[f.category] ?? '📝'}</span>{' '}
                <strong>{f.summary}</strong>
              </div>
              <span style={`${statusBadge[f.status] ?? ''};padding:2px 8px;border-radius:4px;font-size:0.8rem`}>
                {f.status}
              </span>
            </div>

            <p style="color:var(--pico-muted-color);margin-bottom:0.5rem;font-size:0.9rem">
              <a href={`https://bsky.app/profile/${f.user_handle}`} target="_blank" rel="noopener noreferrer">
                @{f.user_handle}
              </a>
              {' · '}{ago(f.created_at)}
            </p>

            <details>
              <summary>Full message & admin tools</summary>
              <blockquote style="margin:0.5rem 0;font-style:italic">{f.raw_text}</blockquote>

              <form method="post" action={`/admin/product/${f.id}`} style="display:flex;gap:0.5rem;align-items:end;flex-wrap:wrap;margin-top:0.5rem">
                <label style="flex:0 0 auto;margin-bottom:0">
                  <small>Status</small>
                  <select name="status" style="margin-bottom:0;padding:0.3rem 0.5rem">
                    {['new', 'reviewed', 'planned', 'declined'].map((s) => (
                      <option value={s} selected={f.status === s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label style="flex:1;margin-bottom:0">
                  <small>Notes</small>
                  <input type="text" name="admin_notes" value={f.admin_notes ?? ''}
                         placeholder="Internal notes…"
                         style="margin-bottom:0;padding:0.3rem 0.5rem" />
                </label>
                <button type="submit" style="margin-bottom:0;padding:0.3rem 0.8rem">Save</button>
              </form>
            </details>
          </article>
        ))}
      </div>
    )}

    <p style="text-align:center;margin-top:1rem">
      <a href="/admin">← Back to Admin</a>
    </p>
  </Layout>
);
