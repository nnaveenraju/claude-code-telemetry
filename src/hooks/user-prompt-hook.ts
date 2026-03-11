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

async function main(): Promise<void> {
  try {
    const input = await readStdin();
    const hookData = JSON.parse(input);
    const userMessage: string = hookData?.message ?? hookData?.prompt ?? '';

    const match = SKILL_PATTERN.exec(userMessage);
    if (!match) return;

    const skillName = match[1];

    // Close any existing open spans first
    const openSpans = await readAllPendingSpans();
    for (const span of openSpans) {
      const durationMs = Date.now() - new Date(span.startTime).getTime();
      await appendEvent(
        makeSkillEvent('skill_completed', span.skillName, span.spanId, span.traceId, {
          durationMs,
          success: true,
        })
      );
      await deletePendingSpan(span.spanId);
    }

    // Start new span
    const spanId = uuidv4();
    const traceId = uuidv4();
    await writePendingSpan({
      spanId,
      skillName,
      startTime: new Date().toISOString(),
      traceId,
    });
    await appendEvent(makeSkillEvent('skill_invoked', skillName, spanId, traceId));
  } catch {
    // Never block
  }
}

main();
