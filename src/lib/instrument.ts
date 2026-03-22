/**
 * OpenTelemetry auto-instrumentation bootstrap.
 *
 * This file must be loaded BEFORE the application code via:
 *   node --import tsx/esm --require ./src/lib/instrument.ts src/web/index.tsx
 *
 * Or in ESM mode via --import flag (see ecosystem.config.js).
 *
 * Env vars:
 *   OTEL_ENABLED=true          — enable tracing/metrics (default: false)
 *   OTEL_SERVICE_NAME          — service name (default: open-news)
 *   OTEL_EXPORTER_OTLP_ENDPOINT — collector endpoint (default: http://localhost:4318)
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const enabled = process.env.OTEL_ENABLED === 'true';

if (enabled) {
  const serviceName = process.env.OTEL_SERVICE_NAME || 'open-news';
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '0.1.0',
    'deployment.environment': process.env.NODE_ENV || 'development',
  });

  const sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${endpoint}/v1/metrics`,
      }),
      exportIntervalMillis: 30_000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Auto-instrument HTTP, fetch, pg, dns, net, etc.
        '@opentelemetry/instrumentation-http': { enabled: true },
        '@opentelemetry/instrumentation-pg': { enabled: true },
        // Disable noisy/unnecessary instrumentations
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  // Graceful shutdown
  const shutdown = () => {
    sdk.shutdown()
      .then(() => console.log('OpenTelemetry SDK shut down'))
      .catch((err) => console.error('OpenTelemetry shutdown error', err))
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log(`OpenTelemetry enabled: service=${serviceName} endpoint=${endpoint}`);
}
