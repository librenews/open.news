export function renderHome(serverUrl: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Weblog.social | AT Protocol Bridge</title>
    <!-- Dynamic RSD Endpoint Mappings -->
    <link rel="https://api.w.org/" href="${serverUrl}/wp-json/" />
    <link rel="EditURI" type="application/rsd+xml" title="RSD" href="${serverUrl}/xmlrpc" />
    
    <!-- Static Typography & Styles -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/weblog.css">
</head>
<body>
    <div class="glass-container">
        
        <header class="hero">
            <div class="hero-badge">Bridge Online</div>
            <h1>Weblog.social</h1>
            <p class="subtitle">Publish seamlessly from any WordPress-compatible editor straight onto Bluesky’s decentralized AT Protocol.</p>
        </header>

        <div class="grid-layout">
            <!-- Setup Block -->
            <section class="card instruction-card">
                <div class="card-header">
                    <span class="icon">🦋</span>
                    <h2>1. Generate App Password</h2>
                </div>
                <div class="card-body">
                    <p>To connect securely, you must generate a dedicated Application Password via Bluesky.</p>
                    <ol>
                        <li>Open <a href="https://bsky.app/settings/app-passwords" target="_blank">Bluesky Settings &rarr; App Passwords</a>.</li>
                        <li>Click <strong>Add App Password</strong> and name it <em>Weblog.social</em>.</li>
                        <li>Copy the generated 16-character code <code>xxxx-xxxx-xxxx-xxxx</code>.</li>
                    </ol>
                </div>
            </section>

            <!-- Ulysses Integration -->
            <section class="card integration-card">
                <div class="card-header">
                    <span class="icon">📱</span>
                    <h2>2A. Connect Ulysses (iOS / Mac)</h2>
                </div>
                <div class="card-body">
                    <p>Ulysses natively utilizes the standard <strong>WordPress REST API</strong> natively mapped by this server.</p>
                    <ul>
                        <li><span class="label">Platform:</span> <strong>WordPress</strong></li>
                        <li><span class="label">URL:</span> <code>https://weblog.social/</code></li>
                        <li><span class="label">Username:</span> Your Handle (e.g. <code>alice.bsky.social</code>)</li>
                        <li><span class="label">Password:</span> Your App Password</li>
                    </ul>
                </div>
            </section>

            <!-- MarsEdit Integration -->
            <section class="card integration-card">
                <div class="card-header">
                    <span class="icon">🖥️</span>
                    <h2>2B. Connect MarsEdit (Mac Desktop)</h2>
                </div>
                <div class="card-body">
                    <p>MarsEdit inherently connects through the legacy <strong>MetaWeblog XML-RPC</strong> API framework.</p>
                    <ul>
                        <li><span class="label">System:</span> <strong>WordPress API</strong></li>
                        <li><span class="label">Blog URL:</span> <code>https://weblog.social/</code></li>
                        <li><span class="label">API Endpoint:</span> <code>https://weblog.social/xmlrpc</code></li>
                        <li><span class="label">Username:</span> Your Handle</li>
                        <li><span class="label">Password:</span> Your App Password</li>
                    </ul>
                </div>
            </section>
        </div>

        <!-- System Status Footer -->
        <footer class="system-footer">
            <p>Ready to deploy. All services mapping properly.</p>
        </footer>

    </div>
</body>
</html>
  `;
}
