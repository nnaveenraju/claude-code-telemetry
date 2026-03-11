import type { TelemetryClient } from '../telemetry-client.js';
import type { ContextBudgetEvent } from '../types.js';

export class ContextCollector {
  constructor(private readonly client: TelemetryClient) {}

  snapshot(
    phase: 'pre-routing' | 'post-skill-selection' | 'post-execution',
    budget: {
      totalTokenBudget: number;
      usedByOrchestration: number;
      usedBySkillContext: number;
      usedByUserContent: number;
    }
  ): void {
    const remaining = Math.max(
      0,
      budget.totalTokenBudget -
        budget.usedByOrchestration -
        budget.usedBySkillContext -
        budget.usedByUserContent
    );

    const remainingPercent =
      budget.totalTokenBudget > 0
        ? (remaining / budget.totalTokenBudget) * 100
        : 0;

    if (remainingPercent < 20) {
      console.warn(
        `[telemetry] Context budget warning: ${remainingPercent.toFixed(1)}% remaining ` +
          `(${remaining} of ${budget.totalTokenBudget} tokens) at phase: ${phase}`
      );
    }

    const ctx = this.client.getTraceContext();
    const event: ContextBudgetEvent = {
      timestamp: new Date().toISOString(),
      traceId: ctx.getCurrentTraceId() ?? 'no-trace',
      spanId: ctx.generateSpanId(),
      eventType: 'context_budget_snapshot',
      success: true,
      totalTokenBudget: budget.totalTokenBudget,
      usedByOrchestration: budget.usedByOrchestration,
      usedBySkillContext: budget.usedBySkillContext,
      usedByUserContent: budget.usedByUserContent,
      remainingTokens: remaining,
      metadata: { phase },
    };
    this.client.record(event);
  }
}
