import {
  readStdin,
  readAllPendingSpans,
  appendEvent,
  uuidv4,
} from './shared.js';
async function main(): Promise<void> {
  try {
    const input = await readStdin();
    const hookData = JSON.parse(input);
    const toolName: string = hookData?.tool_name ?? 'unknown';
    const spans = await readAllPendingSpans();
    const parentSpan = spans.length > 0 ? spans[spans.length - 1] : undefined;
    await appendEvent({
      timestamp: new Date().toISOString(),
      traceId: parentSpan?.traceId ?? 'no-trace',
      spanId: uuidv4(),
      parentSpanId: parentSpan?.spanId,
      eventType: 'cascade_step',
      success: true,
      metadata: { toolName, phase: 'pre' },
    });
  } catch {
    // Never block
  }
}
main();
