// tests/telemetry-client.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TelemetryClient } from '../src/telemetry-client.js';
import type { TelemetryEvent, TelemetryExporter } from '../src/types.js';

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    timestamp: new Date().toISOString(),
    traceId: 'trace-1',
    spanId: 'span-1',
    eventType: 'skill_completed',
    success: true,
    metadata: {},
    ...overrides,
  };
}

function mockExporter(): TelemetryExporter & {
  events: TelemetryEvent[];
  shutdownCalled: boolean;
} {
  const state = {
    events: [] as TelemetryEvent[],
    shutdownCalled: false,
  };
  return {
    ...state,
    async export(event: TelemetryEvent) {
      state.events.push(event);
    },
    async flush() {},
    async shutdown() {
      state.shutdownCalled = true;
    },
    get events() {
      return state.events;
    },
    get shutdownCalled() {
      return state.shutdownCalled;
    },
  };
}

describe('TelemetryClient', () => {
  beforeEach(() => {
    TelemetryClient.reset();
  });

  afterEach(async () => {
    try {
      await TelemetryClient.getInstance().shutdown();
    } catch {
      // not initialized
    }
    TelemetryClient.reset();
  });

  it('enforces singleton pattern', () => {
    const a = TelemetryClient.init({ enabled: true });
    const b = TelemetryClient.getInstance();
    expect(a).toBe(b);
  });

  it('buffers events and flushes at threshold', async () => {
    const exp = mockExporter();
    const client = TelemetryClient.init({
      enabled: true,
      exporters: [exp],
      samplingRate: 1.0,
    });

    for (let i = 0; i < 50; i++) {
      client.record(makeEvent({ spanId: `span-${i}` }));
    }

    // Give async flush a moment
    await new Promise(r => setTimeout(r, 50));
    expect(exp.events.length).toBe(50);
  });

  it('drops events when sampling rate filters them', async () => {
    const exp = mockExporter();
    const client = TelemetryClient.init({
      enabled: true,
      exporters: [exp],
      samplingRate: 0.0,
    });

    client.record(makeEvent());
    await client.flush();
    expect(exp.events.length).toBe(0);
  });

  it('redacts sensitive metadata keys', async () => {
    const exp = mockExporter();
    const client = TelemetryClient.init({
      enabled: true,
      exporters: [exp],
      samplingRate: 1.0,
      redactSensitiveFields: true,
    });

    client.record(
      makeEvent({
        metadata: {
          username: 'naveen',
          password: 'secret123',
          api_token: 'tok_abc',
          authorization: 'Bearer xyz',
          safe_field: 'visible',
        },
      })
    );
    await client.flush();

    const meta = exp.events[0].metadata;
    expect(meta['username']).toBe('naveen');
    expect(meta['password']).toBe('[REDACTED]');
    expect(meta['api_token']).toBe('[REDACTED]');
    expect(meta['authorization']).toBe('[REDACTED]');
    expect(meta['safe_field']).toBe('visible');
  });

  it('generates trace IDs via startTrace', () => {
    const client = TelemetryClient.init({ enabled: true });
    const traceId = client.startTrace();
    expect(traceId).toBeTruthy();
    expect(typeof traceId).toBe('string');
  });

  it('calls shutdown on all exporters', async () => {
    const exp = mockExporter();
    const client = TelemetryClient.init({
      enabled: true,
      exporters: [exp],
    });

    await client.shutdown();
    expect(exp.shutdownCalled).toBe(true);
  });

  it('does nothing when disabled', async () => {
    const exp = mockExporter();
    const client = TelemetryClient.init({
      enabled: false,
      exporters: [exp],
    });

    client.record(makeEvent());
    await client.flush();
    expect(exp.events.length).toBe(0);
  });
});
