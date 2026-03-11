// tests/skill-collector.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillCollector } from '../src/collectors/skill-collector.js';
import { TelemetryClient } from '../src/telemetry-client.js';
import type { TelemetryEvent } from '../src/types.js';

describe('SkillCollector', () => {
  let captured: TelemetryEvent[];
  let collector: SkillCollector;

  beforeEach(() => {
    TelemetryClient.reset();
    captured = [];
    const mockExporter = {
      async export(event: TelemetryEvent) { captured.push(event); },
      async flush() {},
      async shutdown() {},
    };
    const client = TelemetryClient.init({
      enabled: true,
      exporters: [mockExporter],
      samplingRate: 1.0,
      redactSensitiveFields: false,
    });
    collector = new SkillCollector(client);
  });

  afterEach(async () => {
    await TelemetryClient.getInstance().shutdown();
    TelemetryClient.reset();
  });

  it('wrap() emits skill_invoked then skill_completed on success', async () => {
    const result = await collector.wrap(
      'architect',
      async () => 'design-doc',
      { triggerReason: 'explicit_request', modelUsed: 'opus' }
    );

    await TelemetryClient.getInstance().flush();

    expect(result).toBe('design-doc');
    expect(captured.length).toBe(2);
    expect(captured[0].eventType).toBe('skill_invoked');
    expect(captured[1].eventType).toBe('skill_completed');
    expect(captured[1].durationMs).toBeGreaterThanOrEqual(0);
    expect(captured[1].success).toBe(true);
  });

  it('wrap() emits skill_invoked then skill_failed on error', async () => {
    await expect(
      collector.wrap(
        'test-gen',
        async () => { throw new Error('timeout'); },
        { triggerReason: 'chained' }
      )
    ).rejects.toThrow('timeout');

    await TelemetryClient.getInstance().flush();

    expect(captured.length).toBe(2);
    expect(captured[0].eventType).toBe('skill_invoked');
    expect(captured[1].eventType).toBe('skill_failed');
    expect(captured[1].success).toBe(false);
  });

  it('context hash is deterministic for same input', async () => {
    await collector.wrap('a', async () => 'x', {
      triggerReason: 'explicit_request',
      inputContext: 'same input',
    });
    await collector.wrap('b', async () => 'y', {
      triggerReason: 'explicit_request',
      inputContext: 'same input',
    });

    await TelemetryClient.getInstance().flush();

    const completed = captured.filter(
      e => e.eventType === 'skill_completed'
    ) as Record<string, unknown>[];
    expect(completed[0]['inputContextHash']).toBe(
      completed[1]['inputContextHash']
    );
  });

  it('recordFromHook records skill event', async () => {
    collector.recordFromHook({
      skillName: 'debug',
      phase: 'post',
      success: true,
      metadata: { model: 'sonnet' },
    });

    await TelemetryClient.getInstance().flush();

    expect(captured.length).toBe(1);
    expect(captured[0].eventType).toBe('skill_completed');
  });
});
