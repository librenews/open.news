/**
 * OpenTelemetry auto-instrumentation bootstrap.
 *
 * Supports exporting to multiple backends simultaneously:
 * - Grafana Cloud (via OTLP HTTP)
 * - AppSignal (via OTLP Proto to their collector)
 *
 * Env vars:
 *   OTEL_ENABLED=true                    — enable tracing/metrics (default: false)
 *   OTEL_SERVICE_NAME                    — service name (default: open-news)
 *
 *   Grafana Cloud:
 *   OTEL_EXPORTER_OTLP_ENDPOINT         — Grafana OTLP endpoint
 *   OTEL_EXPORTER_OTLP_HEADERS          — auth headers "Key=Value,Key2=Value2"
 *
 *   AppSignal:
 *   APPSIGNAL_COLLECTOR_ENDPOINT        — AppSignal collector URL (default: http://localhost:8099)
 *   APPSIGNAL_APP_NAME                  — app name in AppSignal dashboard
 *   APPSIGNAL_PUSH_API_KEY              — AppSignal Push API key
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter as OTLPTraceExporterProto } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter as OTLPMetricExporterProto } from '@opentelemetry/exporter-metrics-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor, type SpanProcessor, type SpanExporter } from '@opentelemetry/sdk-trace-base';
import * as os from 'node:os';

const enabled = process.env.OTEL_ENABLED === 'true';

if (enabled) {
  const serviceName = process.env.OTEL_SERVICE_NAME || 'open-news';

  // ── Grafana Cloud config ────────────────────────────────────────────────
  const grafanaEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const grafanaHeaders: Record<string, string> = {};
  const rawHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS;
  if (rawHeaders) {
    for (const pair of rawHeaders.split(',')) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        grafanaHeaders[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
      }
    }
  }

  // ── AppSignal config ────────────────────────────────────────────────────
  const appsignalEndpoint = process.env.APPSIGNAL_COLLECTOR_ENDPOINT;
  const appsignalAppName = process.env.APPSIGNAL_APP_NAME || serviceName;
  const appsignalApiKey = process.env.APPSIGNAL_PUSH_API_KEY;

  // ── Resource attributes ─────────────────────────────────────────────────
  const resourceAttrs: Record<string, string> = {
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '0.1.0',
    'deployment.environment': process.env.NODE_ENV || 'development',
    'host.name': os.hostname(),
  };

  // Add AppSignal-specific resource attributes
  if (appsignalApiKey) {
    resourceAttrs['appsignal.config.name'] = appsignalAppName;
    resourceAttrs['appsignal.config.environment'] = process.env.NODE_ENV || 'development';
    resourceAttrs['appsignal.config.push_api_key'] = appsignalApiKey;
    resourceAttrs['appsignal.config.language_integration'] = 'node.js';
    resourceAttrs['appsignal.config.app_path'] = process.cwd();
  }

  const resource = resourceFromAttributes(resourceAttrs);

  // ── Determine primary trace exporter (first configured backend) ────────
  let primaryTraceExporter: SpanExporter;
  const additionalSpanProcessors: SpanProcessor[] = [];
  const metricReaders: PeriodicExportingMetricReader[] = [];
  const backends: string[] = [];

  // Grafana Cloud (OTLP HTTP)
  if (grafanaEndpoint) {
    const grafanaTraceExporter = new OTLPTraceExporter({
      url: `${grafanaEndpoint}/v1/traces`,
      headers: grafanaHeaders,
    });
    metricReaders.push(new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${grafanaEndpoint}/v1/metrics`,
        headers: grafanaHeaders,
      }),
      exportIntervalMillis: 30_000,
    }));
    // Use Grafana as primary or additional
    if (!primaryTraceExporter!) {
      primaryTraceExporter = grafanaTraceExporter;
    } else {
      additionalSpanProcessors.push(new BatchSpanProcessor(grafanaTraceExporter));
    }
    backends.push(`Grafana(${grafanaEndpoint})`);
  }

  // AppSignal (OTLP Proto)
  if (appsignalEndpoint && appsignalApiKey) {
    const appsignalTraceExporter = new OTLPTraceExporterProto({
      url: `${appsignalEndpoint}/v1/traces`,
    });
    metricReaders.push(new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporterProto({
        url: `${appsignalEndpoint}/v1/metrics`,
      }),
      exportIntervalMillis: 10_000,
    }));
    if (!primaryTraceExporter!) {
      primaryTraceExporter = appsignalTraceExporter;
    } else {
      additionalSpanProcessors.push(new BatchSpanProcessor(appsignalTraceExporter));
    }
    backends.push(`AppSignal(${appsignalEndpoint})`);
  }

  if (backends.length === 0) {
    console.warn('OTEL_ENABLED=true but no backend configured. Set OTEL_EXPORTER_OTLP_ENDPOINT and/or APPSIGNAL_COLLECTOR_ENDPOINT.');
  } else {
    const sdk = new NodeSDK({
      resource,
      traceExporter: primaryTraceExporter!,
      metricReader: metricReaders[0],
      spanProcessors: additionalSpanProcessors,
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-http': {
            enabled: true,
            ignoreOutgoingRequestHook: (request: any) => {
              const hostname = request.hostname || request.host || '';
              return (
                hostname.includes('grafana.net') ||
                hostname.includes('appsignal-collector.net') ||
                hostname.includes('appsignal.com')
              );
            },
          },
          '@opentelemetry/instrumentation-pg': { enabled: true },
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

    console.log(`OpenTelemetry enabled: service=${serviceName} backends=[${backends.join(', ')}]`);
  }
}
