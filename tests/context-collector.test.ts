import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContextCollector } from '../src/collectors/context-collector.js';
import { TelemetryClient } from '../src/telemetry-client.js';
import type { TelemetryEvent, ContextBudgetEvent } from '../src/types.js';

describe('ContextCollector', () => {
  let captured: TelemetryEvent[];
  let collector: ContextCollector;

  beforeEach(() => {
    TelemetryClient.reset();
    captured = [];
    const mockExporter = {
      async export(e: TelemetryEvent) { captured.push(e); },
      async flush() {},
      async shutdown() {},
    };
    const client = TelemetryClient.init({
      enabled: true,
      exporters: [mockExporter],
      samplingRate: 1.0,
      redactSensitiveFields: false,
    });
    collector = new ContextCollector(client);
  });

  afterEach(async () => {
    await TelemetryClient.getInstance().shutdown();
    TelemetryClient.reset();
  });

  it('computes remainingTokens correctly', async () => {
    collector.snapshot('post-execution', {
      totalTokenBudget: 200000,
      usedByOrchestration: 5000,
      usedBySkillContext: 12000,
      usedByUserContent: 45000,
    });

    await TelemetryClient.getInstance().flush();
    const event = captured[0] as ContextBudgetEvent;
    expect(event.remainingTokens).toBe(138000);
  });

  it('clamps remaining to zero when budget exceeded', async () => {
    collector.snapshot('post-execution', {
      totalTokenBudget: 100,
      usedByOrchestration: 50,
      usedBySkillContext: 30,
      usedByUserContent: 50,
    });

    await TelemetryClient.getInstance().flush();
    const event = captured[0] as ContextBudgetEvent;
    expect(event.remainingTokens).toBe(0);
  });

  it('warns when remaining tokens below 20%', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    collector.snapshot('post-execution', {
      totalTokenBudget: 100000,
      usedByOrchestration: 40000,
      usedBySkillContext: 30000,
      usedByUserContent: 15000,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Context budget')
    );
    warnSpy.mockRestore();
  });
});
