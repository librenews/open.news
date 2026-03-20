/** @jsxImportSource hono/jsx */
import { Layout } from './layout.js';

export interface AdminData {
  users: { id: string; handle: string; created_at: string }[];
  articles: { id: string; title: string | null; url: string; is_news: boolean; fetch_status: string; created_at: string }[];
  sources: { id: string; handle: string | null; display_name: string | null; type: string; created_at: string }[];
  counts: { users: number; articles: number; sources: number; news: number };
}

const ago = (iso: string) => {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
};

export const AdminPage = ({ data, user }: { data: AdminData; user: { handle: string } }) => (
  <Layout title="Admin" user={user}>
    <hgroup>
      <h2>Admin</h2>
      <p>Live activity overview</p>
    </hgroup>

    {/* Counts */}
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:2rem">
      {[
        { label: 'Users', value: data.counts.users },
        { label: 'Sources', value: data.counts.sources },
        { label: 'Articles', value: data.counts.articles },
        { label: 'News', value: data.counts.news },
      ].map(({ label, value }) => (
        <article style="text-align:center;padding:1rem;margin:0">
          <strong style="font-size:2rem">{value}</strong>
          <br />
          <small>{label}</small>
        </article>
      ))}
    </div>

    {/* Recent Users */}
    <details open>
      <summary><strong>Recent Users</strong></summary>
      <table role="grid" style="margin-top:0.5rem">
        <thead><tr><th>Handle</th><th>Joined</th></tr></thead>
        <tbody>
          {data.users.map((u) => (
            <tr>
              <td>
                <a href={`https://bsky.app/profile/${u.handle}`} target="_blank" rel="noopener noreferrer">
                  @{u.handle}
                </a>
              </td>
              <td>{ago(u.created_at)}</td>
            </tr>
          ))}
          {data.users.length === 0 && <tr><td colSpan={2}>No users yet</td></tr>}
        </tbody>
      </table>
    </details>

    {/* Recent Articles */}
    <details open>
      <summary><strong>Recent Articles</strong></summary>
      <table role="grid" style="margin-top:0.5rem">
        <thead><tr><th>Title</th><th>Status</th><th>News</th><th>Added</th></tr></thead>
        <tbody>
          {data.articles.map((a) => (
            <tr>
              <td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                <a href={a.url} target="_blank" rel="noopener noreferrer" title={a.url}>
                  {a.title || a.url}
                </a>
              </td>
              <td>{a.fetch_status}</td>
              <td>{a.is_news ? '✓' : '—'}</td>
              <td>{ago(a.created_at)}</td>
            </tr>
          ))}
          {data.articles.length === 0 && <tr><td colSpan={4}>No articles yet</td></tr>}
        </tbody>
      </table>
    </details>

    {/* Recent Sources */}
    <details open>
      <summary><strong>Recent Sources</strong></summary>
      <table role="grid" style="margin-top:0.5rem">
        <thead><tr><th>Handle</th><th>Name</th><th>Added</th></tr></thead>
        <tbody>
          {data.sources.map((s) => (
            <tr>
              <td>@{s.handle ?? '—'}</td>
              <td>{s.display_name ?? '—'}</td>
              <td>{ago(s.created_at)}</td>
            </tr>
          ))}
          {data.sources.length === 0 && <tr><td colSpan={3}>No sources yet</td></tr>}
        </tbody>
      </table>
    </details>
  </Layout>
);
