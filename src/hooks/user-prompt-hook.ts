import {
  readStdin,
  readAllPendingSpans,
  deletePendingSpan,
  writePendingSpan,
  appendEvent,
  makeSkillEvent,
  uuidv4,
} from './shared.js';
const SKILL_PATTERN = /^\/([\w-]+)/;

function deriveLabel(message: string): string {
  const match = SKILL_PATTERN.exec(message);
  if (match) return match[1];
  const trimmed = message.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 40) return trimmed || 'conversation';
  return trimmed.slice(0, 37) + '...';
}

async function main(): Promise<void> {
  try {
    const input = await readStdin();
    const hookData = JSON.parse(input);
    const userMessage: string = hookData?.user_prompt ?? hookData?.message ?? hookData?.prompt ?? '';
    if (!userMessage.trim()) return;

    const label = deriveLabel(userMessage);

    // Close any existing open spans first
    const openSpans = await readAllPendingSpans();
    for (const span of openSpans) {
      const durationMs = Date.now() - new Date(span.startTime).getTime();
      if (span.type === 'delegation') {
        await appendEvent({
          timestamp: new Date().toISOString(),
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId,
          eventType: 'subagent_returned',
          durationMs,
          success: true,
          metadata: { agentType: span.agentType, closedBy: 'new_prompt' },
        });
      } else {
        await appendEvent(
          makeSkillEvent('skill_completed', span.skillName, span.spanId, span.traceId, {
            durationMs,
            success: true,
          })
        );
      }
      await deletePendingSpan(span.spanId);
    }

    // Start new trace for every user message
    const spanId = uuidv4();
    const traceId = uuidv4();
    await writePendingSpan({
      spanId,
      skillName: label,
      startTime: new Date().toISOString(),
      traceId,
      type: 'skill',
    });
    await appendEvent(makeSkillEvent('skill_invoked', label, spanId, traceId));
  } catch {
    // Never block
  }
}

main();
