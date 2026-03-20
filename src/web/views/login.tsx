/** @jsxImportSource hono/jsx */
import { Layout } from './layout.js';

export const LoginPage = () => (
  <Layout title="Sign in">
    <article style="max-width: 420px; margin: 4rem auto; text-align: center;">
      <hgroup>
        <h1>open.news</h1>
        <p>News from the people you follow on Bluesky.</p>
      </hgroup>
      <form action="/oauth/login" method="get">
        <input
          type="text"
          name="handle"
          placeholder="your.bsky.social"
          required
          autocomplete="username"
          autocapitalize="none"
          autocorrect="off"
          spellcheck={false}
        />
        <button type="submit">Sign in with Bluesky</button>
      </form>
      <small>
        No account? <a href="https://bsky.app" target="_blank" rel="noopener noreferrer">Join Bluesky</a> first.
      </small>
    </article>
  </Layout>
);
