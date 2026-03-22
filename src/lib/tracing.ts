/**
 * Custom OpenTelemetry span helpers for application-specific tracing.
 *
 * Use these to instrument LLM calls, bot interactions, and other
 * domain-specific operations that auto-instrumentation doesn't cover.
 */

import { trace, SpanStatusCode, context, type Span } from '@opentelemetry/api';

const tracer = trace.getTracer('open-news', '0.1.0');

/**
 * Wrap an async function in a traced span.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Trace an LLM completion call.
 */
export function traceLlmCall(
  provider: string,
  model: string,
  fn: (span: Span) => Promise<{ inputTokens?: number; outputTokens?: number; text: string }>
) {
  return withSpan('llm.complete', {
    'llm.provider': provider,
    'llm.model': model,
    'llm.system': 'open-news',
  }, async (span) => {
    const result = await fn(span);
    span.setAttribute('llm.input_tokens', result.inputTokens ?? 0);
    span.setAttribute('llm.output_tokens', result.outputTokens ?? 0);
    span.setAttribute('llm.response_length', result.text.length);
    return result;
  });
}

/**
 * Trace a bot interaction (DM or mention reply).
 */
export function traceBotInteraction(
  interactionType: string,
  senderDid: string,
  fn: (span: Span) => Promise<void>
) {
  return withSpan('bot.interaction', {
    'bot.interaction_type': interactionType,
    'bot.sender_did': senderDid,
  }, fn);
}

/**
 * Trace DM polling cycle.
 */
export function traceDmPoll(fn: (span: Span) => Promise<number>) {
  return withSpan('dm.poll', {}, async (span) => {
    const messagesProcessed = await fn(span);
    span.setAttribute('dm.messages_processed', messagesProcessed);
    return messagesProcessed;
  });
}

// Re-export for convenience
export { trace, context, SpanStatusCode };
