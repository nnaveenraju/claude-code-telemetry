import {
  readStdin,
  readAllPendingSpans,
  writePendingSpan,
  appendEvent,
  uuidv4,
  DELEGATION_TOOLS,
} from './shared.js';

async function main(): Promise<void> {
  try {
    const input = await readStdin();
    const hookData = JSON.parse(input);
    const toolName: string = hookData?.tool_name ?? 'unknown';
    const spans = await readAllPendingSpans();
    const parentSpan = spans.length > 0 ? spans[spans.length - 1] : undefined;
    const traceId = parentSpan?.traceId ?? 'no-trace';

    if (DELEGATION_TOOLS.has(toolName)) {
      const toolInput = hookData?.tool_input ?? {};
      const agentType: string = toolInput.subagent_type ?? 'unknown';
      const description: string = toolInput.description ?? '';
      const spanId = uuidv4();
      await writePendingSpan({
        spanId,
        skillName: `subagent:${agentType}`,
        startTime: new Date().toISOString(),
        traceId,
        type: 'delegation',
        parentSpanId: parentSpan?.spanId,
        agentType,
        description,
      });
      await appendEvent({
        timestamp: new Date().toISOString(),
        traceId,
        spanId,
        parentSpanId: parentSpan?.spanId,
        eventType: 'subagent_delegated',
        success: true,
        metadata: { toolName, agentType, description },
      });
    } else {
      await appendEvent({
        timestamp: new Date().toISOString(),
        traceId,
        spanId: uuidv4(),
        parentSpanId: parentSpan?.spanId,
        eventType: 'cascade_step',
        success: true,
        metadata: { toolName, phase: 'pre' },
      });
    }
  } catch {
    // Never block
  }
}
main();
