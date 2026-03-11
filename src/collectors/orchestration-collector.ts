import type { TelemetryClient } from '../telemetry-client.js';
import type { RoutingDecisionEvent } from '../types.js';

export class OrchestrationCollector {
  constructor(private readonly client: TelemetryClient) {}

  recordRouting(decision: {
    candidates: RoutingDecisionEvent['candidates'];
    selectedSkill: string | null;
    cascadeDepth: number;
    parentSpanId?: string;
  }): void {
    const ctx = this.client.getTraceContext();
    const event: RoutingDecisionEvent = {
      timestamp: new Date().toISOString(),
      traceId: ctx.getCurrentTraceId() ?? 'no-trace',
      spanId: ctx.generateSpanId(),
      parentSpanId: decision.parentSpanId ?? ctx.getCurrentParentSpanId(),
      eventType: 'routing_decision',
      success: decision.selectedSkill !== null,
      candidates: decision.candidates,
      selectedSkill: decision.selectedSkill,
      cascadeDepth: decision.cascadeDepth,
      metadata: {},
    };
    this.client.record(event);
  }

  recordFallback(reason: string, parentSpanId?: string): void {
    const ctx = this.client.getTraceContext();
    this.client.record({
      timestamp: new Date().toISOString(),
      traceId: ctx.getCurrentTraceId() ?? 'no-trace',
      spanId: ctx.generateSpanId(),
      parentSpanId: parentSpanId ?? ctx.getCurrentParentSpanId(),
      eventType: 'fallback_triggered',
      success: false,
      metadata: { reason },
    });
  }

  recordCascadeStep(
    fromSkill: string,
    toSkill: string,
    parentSpanId?: string
  ): void {
    const ctx = this.client.getTraceContext();
    this.client.record({
      timestamp: new Date().toISOString(),
      traceId: ctx.getCurrentTraceId() ?? 'no-trace',
      spanId: ctx.generateSpanId(),
      parentSpanId: parentSpanId ?? ctx.getCurrentParentSpanId(),
      eventType: 'cascade_step',
      success: true,
      metadata: { fromSkill, toSkill },
    });
  }
}
