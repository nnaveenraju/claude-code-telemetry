import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OrchestrationCollector } from '../src/collectors/orchestration-collector.js';
import { TelemetryClient } from '../src/telemetry-client.js';
import type { TelemetryEvent } from '../src/types.js';

describe('OrchestrationCollector', () => {
  let captured: TelemetryEvent[];
  let collector: OrchestrationCollector;

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
    collector = new OrchestrationCollector(client);
  });

  afterEach(async () => {
    await TelemetryClient.getInstance().shutdown();
    TelemetryClient.reset();
  });

  it('records routing decision with candidates and scores', async () => {
    collector.recordRouting({
      candidates: [
        { skillName: 'architect', confidenceScore: 0.9, matched: true, matchReason: 'pattern' },
        { skillName: 'docs-gen', confidenceScore: 0.3, matched: false },
      ],
      selectedSkill: 'architect',
      cascadeDepth: 1,
    });

    await TelemetryClient.getInstance().flush();
    expect(captured.length).toBe(1);
    expect(captured[0].eventType).toBe('routing_decision');
  });

  it('records fallback when no skill matches', async () => {
    collector.recordFallback('no matching skill for prompt');

    await TelemetryClient.getInstance().flush();
    expect(captured.length).toBe(1);
    expect(captured[0].eventType).toBe('fallback_triggered');
  });

  it('records cascade steps between skills', async () => {
    collector.recordCascadeStep('architect', 'implement');

    await TelemetryClient.getInstance().flush();
    expect(captured.length).toBe(1);
    expect(captured[0].eventType).toBe('cascade_step');
  });
});
