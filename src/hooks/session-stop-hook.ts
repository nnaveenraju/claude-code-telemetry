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
      const eventType = timedOut ? 'skill_failed' : 'skill_completed';
      const extra = timedOut
        ? { durationMs, success: false, error: { code: 'TIMEOUT', message: 'Span orphaned (>1hr)' } }
        : { durationMs, success: true };
      await appendEvent(makeSkillEvent(eventType, span.skillName, span.spanId, span.traceId, extra));
      await deletePendingSpan(span.spanId);
    }
  } catch {
    // Never block
  }
}

main();
