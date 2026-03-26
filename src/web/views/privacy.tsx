/** @jsxImportSource hono/jsx */

import { Layout } from './layout.js';

export const PrivacyPage = ({ user }: { user?: { handle: string } | null }) => (
  <Layout title="Privacy Policy" user={user}>
    <article>
      <h2>Privacy Policy</h2>
      <p><strong>Last updated:</strong> March 2026</p>

      <h3>1. Overview</h3>
      <p>
        This service provides a feed of relevant content by processing publicly available data from the Bluesky network and matching it against user-defined queries.
      </p>
      <p>We are committed to collecting as little personal data as possible.</p>

      <hr />

      <h3>2. Information We Collect</h3>
      <p>We may collect:</p>
      <ul>
        <li><strong>Account information</strong> (if applicable): email, username</li>
        <li><strong>User queries and preferences</strong> used to generate feeds</li>
        <li><strong>Basic technical data</strong> such as IP address, browser type, and request logs</li>
      </ul>
      <p>User queries may be stored to improve relevance and system performance.</p>

      <hr />

      <h3>3. How We Use Information</h3>
      <p>We use collected information to:</p>
      <ul>
        <li>Provide and improve the service</li>
        <li>Match user queries against incoming content</li>
        <li>Maintain system performance and prevent abuse</li>
      </ul>

      <hr />

      <h3>4. Data Sources</h3>
      <p>
        We index and process <strong>publicly available content</strong> from the Bluesky network, but we do not own it. This content may be removed or changed at the source.
      </p>

      <hr />

      <h3>5. AI and Data Processing</h3>
      <p>We use <strong>locally hosted machine learning models</strong> to generate embeddings and perform semantic search.</p>
      <ul>
        <li>We do <strong>not send user data to third-party AI services</strong></li>
        <li>All processing is performed on our own infrastructure</li>
      </ul>

      <hr />

      <h3>6. Data Sharing</h3>
      <p>We do <strong>not sell or share personal data</strong> with third parties.</p>
      <p>We only collect basic app performance analytics. We do <strong>not use third-party marketing or tracking analytics</strong> (like Google Analytics).</p>
      <p>
        We may use infrastructure providers (e.g., hosting) that process data on our behalf, but they do not have independent rights to use your data.
      </p>

      <hr />

      <h3>7. Data Retention</h3>
      <p>We retain data only as long as necessary to operate the service.</p>
      <p>Users may request deletion of their data where applicable.</p>

      <hr />

      <h3>8. Security</h3>
      <p>We take reasonable measures to protect data, but no system is completely secure.</p>

      <hr />

      <h3>9. Your Rights</h3>
      <p>Depending on your location, you may have rights to:</p>
      <ul>
        <li>Access your data</li>
        <li>Request deletion</li>
        <li>Object to certain processing</li>
      </ul>
      <p>To make a request, contact us at: <a href="mailto:app@track.social">app@track.social</a></p>

      <hr />

      <h3>10. Changes</h3>
      <p>We may update this policy. Continued use of the service constitutes acceptance of the updated policy.</p>
    </article>
  </Layout>
);
