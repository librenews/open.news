const { readFileSync } = require('fs');
const { resolve } = require('path');

// Load .env file into env vars for all processes
const envFile = resolve(__dirname, '.env');
const envVars = {};
try {
  readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    if (eq === -1) return;
    envVars[line.slice(0, eq)] = line.slice(eq + 1);
  });
} catch {}

module.exports = {
  apps: [
    {
      name: 'web',
      script: 'node',
      args: '--import tsx/esm --import ./src/lib/instrument.ts src/web/index.tsx',
      cwd: '/home/opennews/open-news',
      instances: 1, autorestart: true, watch: false,
      max_memory_restart: '512M',
      env: { ...envVars, OTEL_SERVICE_NAME: 'open-news-web' },
      error_file: '/var/log/opennews/web-error.log',
      out_file: '/var/log/opennews/web-out.log',
    },
    {
      name: 'firehose',
      script: 'node',
      args: '--import tsx/esm --import ./src/lib/instrument.ts src/firehose/index.ts',
      cwd: '/home/opennews/open-news',
      instances: 1, autorestart: true, watch: false,
      max_memory_restart: '256M',
      env: { ...envVars, OTEL_SERVICE_NAME: 'open-news-firehose' },
      error_file: '/var/log/opennews/firehose-error.log',
      out_file: '/var/log/opennews/firehose-out.log',
      exp_backoff_restart_delay: 100,
    },
    {
      name: 'worker',
      script: 'node',
      args: '--import tsx/esm --import ./src/lib/instrument.ts src/worker/index.ts',
      cwd: '/home/opennews/open-news',
      instances: 1, autorestart: true, watch: false,
      max_memory_restart: '384M',
      env: { ...envVars, OTEL_SERVICE_NAME: 'open-news-worker' },
      error_file: '/var/log/opennews/worker-error.log',
      out_file: '/var/log/opennews/worker-out.log',
    },
    {
      name: 'track-web',
      script: 'node',
      args: '--import tsx/esm src/track/web.ts',
      cwd: '/home/opennews/open-news',
      instances: 1, autorestart: true, watch: false,
      max_memory_restart: '256M',
      env: { ...envVars, TRACK_PORT: '4200' },
      error_file: '/var/log/opennews/track-web-error.log',
      out_file: '/var/log/opennews/track-web-out.log',
    },
    {
      name: 'track-worker',
      script: 'node',
      args: '--import tsx/esm src/track/worker.ts',
      cwd: '/home/opennews/open-news',
      instances: 1, autorestart: true, watch: false,
      max_memory_restart: '256M',
      env: envVars,
      error_file: '/var/log/opennews/track-worker-error.log',
      out_file: '/var/log/opennews/track-worker-out.log',
    },
    {
      name: 'feeds-web',
      script: 'node',
      args: '--import tsx/esm src/feeds/web.ts',
      cwd: '/home/opennews/open-news',
      instances: 1, autorestart: true, watch: false,
      max_memory_restart: '256M',
      env: envVars,
      error_file: '/var/log/opennews/feeds-web-error.log',
      out_file: '/var/log/opennews/feeds-web-out.log',
    },
    {
      name: 'weblog',
      script: 'node',
      args: '--import tsx/esm src/weblog/index.ts',
      cwd: '/home/opennews/open-news',
      instances: 1, autorestart: true, watch: false,
      max_memory_restart: '256M',
      env: { ...envVars, WEBLOG_PORT: '4400' },
      error_file: '/var/log/opennews/weblog-error.log',
      out_file: '/var/log/opennews/weblog-out.log',
    },
    {
      name: 'longform',
      script: 'node',
      args: '--import tsx/esm src/longform/index.tsx',
      cwd: '/home/opennews/open-news',
      instances: 1, autorestart: true, watch: false,
      max_memory_restart: '256M',
      env: { ...envVars, LONGFORM_PORT: '3001' },
      error_file: '/var/log/opennews/longform-error.log',
      out_file: '/var/log/opennews/longform-out.log',
    },
  ],
};
