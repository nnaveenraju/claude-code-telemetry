import {
  readStdin,
  readAllPendingSpans,
  deletePendingSpan,
  findLatestDelegation,
  appendEvent,
  uuidv4,
  DELEGATION_TOOLS,
} from './shared.js';
import type { PendingSpan } from '../types.js';

function emitCascadeStep(parentSpan: PendingSpan | undefined, toolName: string) {
  return appendEvent({
    timestamp: new Date().toISOString(),
    traceId: parentSpan?.traceId ?? 'no-trace',
    spanId: uuidv4(),
    parentSpanId: parentSpan?.spanId,
    eventType: 'cascade_step',
    success: true,
    metadata: { toolName, phase: 'post' },
  });
}

async function main(): Promise<void> {
  try {
    const input = await readStdin();
    const hookData = JSON.parse(input);
    const toolName: string = hookData?.tool_name ?? 'unknown';
    const spans = await readAllPendingSpans();

    if (DELEGATION_TOOLS.has(toolName)) {
      const delegation = findLatestDelegation(spans);
      if (delegation) {
        const durationMs = Date.now() - new Date(delegation.startTime).getTime();
        await appendEvent({
          timestamp: new Date().toISOString(),
          traceId: delegation.traceId,
          spanId: delegation.spanId,
          parentSpanId: delegation.parentSpanId,
          eventType: 'subagent_returned',
          durationMs,
          success: true,
          metadata: {
            toolName,
            agentType: delegation.agentType,
            description: delegation.description,
          },
        });
        await deletePendingSpan(delegation.spanId);
      } else {
        const parentSpan = spans.length > 0 ? spans[spans.length - 1] : undefined;
        await emitCascadeStep(parentSpan, toolName);
      }
    } else {
      const parentSpan = spans.length > 0 ? spans[spans.length - 1] : undefined;
      await emitCascadeStep(parentSpan, toolName);
    }
  } catch {
    // Never block
  }
}
main();
