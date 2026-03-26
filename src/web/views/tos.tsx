/** @jsxImportSource hono/jsx */

import { Layout } from './layout.js';

export const TosPage = ({ user }: { user?: { handle: string } | null }) => (
  <Layout title="Terms of Service" user={user}>
    <article>
      <h2>Terms of Service</h2>
      <p><strong>Last updated:</strong> March 2026</p>

      <h3>1. Use of Service</h3>
      <p>
        This service provides content discovery based on user-defined queries and publicly available data.
      </p>
      <p>You agree to use the service only for lawful purposes.</p>

      <hr />

      <h3>2. Content Disclaimer</h3>
      <p>Content surfaced by the service:</p>
      <ul>
        <li>Is sourced from third parties (e.g., Bluesky)</li>
        <li>We index and process publicly available content but do not own it</li>
        <li>May be incomplete, inaccurate, or outdated</li>
      </ul>
      <p>We do not guarantee the accuracy or reliability of any content.</p>

      <hr />

      <h3>3. No Warranty</h3>
      <p>
        The service is provided <strong>"as is"</strong> and <strong>"as available"</strong> without warranties of any kind.
      </p>

      <hr />

      <h3>4. Limitation of Liability</h3>
      <p>To the fullest extent permitted by law, we are not liable for:</p>
      <ul>
        <li>Any damages resulting from use of the service</li>
        <li>Loss of data, profits, or business opportunities</li>
      </ul>

      <hr />

      <h3>5. Accounts (if applicable)</h3>
      <p>You are responsible for maintaining the security of your account.</p>
      <p>We reserve the right to suspend or terminate accounts for abuse.</p>

      <hr />

      <h3>6. Acceptable Use</h3>
      <p>You agree not to:</p>
      <ul>
        <li>Abuse, scrape, or overload the service</li>
        <li>Attempt to reverse engineer or disrupt the system</li>
        <li>Use the service for illegal activities</li>
      </ul>

      <hr />

      <h3>7. Termination</h3>
      <p>We may suspend or terminate access at any time.</p>

      <hr />

      <h3>8. Changes</h3>
      <p>We may update these terms at any time. Continued use constitutes acceptance.</p>
    </article>
  </Layout>
);
