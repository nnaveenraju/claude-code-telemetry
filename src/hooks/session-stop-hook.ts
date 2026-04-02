import {
  readAllPendingSpans,
  deletePendingSpan,
  appendEvent,
  makeSkillEvent,
} from './shared.js';
const ORPHAN_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

async function main(): Promise<void> {
  try {
    const spans = await readAllPendingSpans();
    const now = Date.now();
    for (const span of spans) {
      const durationMs = now - new Date(span.startTime).getTime();
      const timedOut = durationMs > ORPHAN_THRESHOLD_MS;

      if (span.type === 'delegation') {
        await appendEvent({
          timestamp: new Date().toISOString(),
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId,
          eventType: 'subagent_returned',
          durationMs,
          success: !timedOut,
          metadata: {
            agentType: span.agentType,
            closedBy: 'session_stop',
            ...(timedOut ? { error: 'orphaned delegation (>1hr)' } : {}),
          },
        });
      } else {
        const eventType = timedOut ? 'skill_failed' : 'skill_completed';
        const extra = timedOut
          ? { durationMs, success: false, error: { code: 'TIMEOUT', message: 'Span orphaned (>1hr)' } }
          : { durationMs, success: true };
        await appendEvent(makeSkillEvent(eventType, span.skillName, span.spanId, span.traceId, extra));
      }
      await deletePendingSpan(span.spanId);
    }
  } catch {
    // Never block
  }
}

main();
