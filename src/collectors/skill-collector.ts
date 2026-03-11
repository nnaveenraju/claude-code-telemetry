// src/collectors/skill-collector.ts
import type { TelemetryClient } from '../telemetry-client.js';
import type { SkillInvocationEvent } from '../types.js';
import { computeContextHash, estimateTokens } from '../utils/token-estimator.js';

interface WrapOptions {
  triggerReason: SkillInvocationEvent['triggerReason'];
  modelUsed?: string;
  skillComplexityHint?: 'low' | 'medium' | 'high';
  parentSpanId?: string;
  inputContext?: string;
}

interface HookData {
  skillName: string;
  phase: 'pre' | 'post';
  success?: boolean;
  error?: { code: string; message: string };
  metadata?: Record<string, unknown>;
}

export class SkillCollector {
  constructor(private readonly client: TelemetryClient) {}

  async wrap<T>(
    skillName: string,
    fn: () => Promise<T>,
    options: WrapOptions
  ): Promise<T> {
    const ctx = this.client.getTraceContext();
    const traceId = ctx.getCurrentTraceId() ?? 'no-trace';
    const spanId = ctx.generateSpanId();
    const startTime = Date.now();

    const invokedEvent: SkillInvocationEvent = {
      timestamp: new Date().toISOString(),
      traceId,
      spanId,
      parentSpanId: options.parentSpanId ?? ctx.getCurrentParentSpanId(),
      eventType: 'skill_invoked',
      skillName,
      triggerReason: options.triggerReason,
      modelUsed: options.modelUsed,
      skillComplexityHint: options.skillComplexityHint,
      metadata: {},
    };
    this.client.record(invokedEvent);
    ctx.pushSpan(spanId);

    try {
      const result = await fn();
      const durationMs = Date.now() - startTime;
      const resultStr =
        typeof result === 'string' ? result : JSON.stringify(result);

      const completedEvent: SkillInvocationEvent = {
        timestamp: new Date().toISOString(),
        traceId,
        spanId,
        parentSpanId: options.parentSpanId ?? ctx.getCurrentParentSpanId(),
        eventType: 'skill_completed',
        durationMs,
        success: true,
        skillName,
        triggerReason: options.triggerReason,
        modelUsed: options.modelUsed,
        inputContextHash: options.inputContext
          ? computeContextHash(options.inputContext)
          : undefined,
        tokenUsage: {
          inputTokens: options.inputContext
            ? estimateTokens(options.inputContext)
            : 0,
          outputTokens: estimateTokens(resultStr ?? ''),
          contextBudgetPercent: 0,
        },
        metadata: {},
      };
      this.client.record(completedEvent);
      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const error =
        err instanceof Error ? err : new Error(String(err));

      const failedEvent: SkillInvocationEvent = {
        timestamp: new Date().toISOString(),
        traceId,
        spanId,
        parentSpanId: options.parentSpanId ?? ctx.getCurrentParentSpanId(),
        eventType: 'skill_failed',
        durationMs,
        success: false,
        skillName,
        triggerReason: options.triggerReason,
        modelUsed: options.modelUsed,
        error: {
          code: error.name,
          message: error.message,
          stack: error.stack,
        },
        metadata: {},
      };
      this.client.record(failedEvent);
      throw err;
    } finally {
      ctx.popSpan();
    }
  }

  recordFromHook(hookData: HookData): void {
    const ctx = this.client.getTraceContext();
    const traceId = ctx.getCurrentTraceId() ?? 'hook-trace';
    const spanId = ctx.generateSpanId();

    const eventType =
      hookData.phase === 'pre'
        ? ('skill_invoked' as const)
        : hookData.success !== false
          ? ('skill_completed' as const)
          : ('skill_failed' as const);

    const event: SkillInvocationEvent = {
      timestamp: new Date().toISOString(),
      traceId,
      spanId,
      eventType,
      success: hookData.phase === 'pre' ? undefined : hookData.success,
      skillName: hookData.skillName,
      triggerReason: 'explicit_request',
      error: hookData.error
        ? { ...hookData.error, code: hookData.error.code }
        : undefined,
      metadata: hookData.metadata ?? {},
    };
    this.client.record(event);
  }
}
