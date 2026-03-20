import type { SSEStreamingApi } from 'hono/streaming';

/**
 * In-memory SSE registry. Maps userId → Set of active SSE streams.
 * Supports multiple tabs per user (each tab opens its own EventSource).
 */
const streams = new Map<number, Set<SSEStreamingApi>>();

export const sseRegistry = {
  add(userId: number, stream: SSEStreamingApi) {
    if (!streams.has(userId)) streams.set(userId, new Set());
    streams.get(userId)!.add(stream);
  },

  remove(userId: number, stream: SSEStreamingApi) {
    const set = streams.get(userId);
    if (!set) return;
    set.delete(stream);
    if (set.size === 0) streams.delete(userId);
  },

  /** Push an SSE event to all streams for a given user. */
  push(userId: number, event: { event: string; data: unknown }) {
    const set = streams.get(userId);
    if (!set) return;
    const payload = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
    for (const stream of set) {
      stream.writeSSE({ event: event.event, data: payload }).catch(() => {
        // Stream closed — will be cleaned up via onAbort
      });
    }
  },

  /** Check if a user has any active SSE connections. */
  hasStreams(userId: number): boolean {
    return (streams.get(userId)?.size ?? 0) > 0;
  },
};
