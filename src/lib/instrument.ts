/**
 * OpenTelemetry auto-instrumentation bootstrap.
 *
 * Env vars:
 *   OTEL_ENABLED=true                    — enable tracing/metrics (default: false)
 *   OTEL_SERVICE_NAME                    — service name (default: open-news)
 *   OTEL_EXPORTER_OTLP_ENDPOINT         — collector endpoint (default: http://localhost:4318)
 *   OTEL_EXPORTER_OTLP_HEADERS          — auth headers, e.g. "Authorization=Basic xxx" (optional)
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

  // Parse OTEL_EXPORTER_OTLP_HEADERS (format: "Key=Value,Key2=Value2")
  const headers: Record<string, string> = {};
  const rawHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS;
  if (rawHeaders) {
    for (const pair of rawHeaders.split(',')) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        headers[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
      }
    }
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '0.1.0',
    'deployment.environment': process.env.NODE_ENV || 'development',
  });

  const sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
      headers,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${endpoint}/v1/metrics`,
        headers,
      }),
      exportIntervalMillis: 30_000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': { enabled: true },
        '@opentelemetry/instrumentation-pg': { enabled: true },
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

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
