import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../dashboard/api/server.js';

function makeJsonl(events: object[]): string {
  return events.map(e => JSON.stringify(e)).join('\n') + '\n';
}

describe('Grafana JSON API', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'telemetry-api-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('GET / returns health check', async () => {
    const app = createApp(tmpDir);
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'ok' });
  });

  it('POST /search returns metric names', async () => {
    const app = createApp(tmpDir);
    const res = await app.inject({ method: 'POST', url: '/search' });
    expect(res.statusCode).toBe(200);
    const metrics = JSON.parse(res.payload);
    expect(metrics).toContain('skill_invocations');
    expect(metrics).toContain('skill_duration_ms');
  });

  it('POST /query returns skill invocation data', async () => {
    const events = [
      { timestamp: '2026-03-11T10:00:00Z', traceId: 't1', spanId: 's1', eventType: 'skill_completed', success: true, skillName: 'architect', durationMs: 5000, metadata: {} },
      { timestamp: '2026-03-11T10:01:00Z', traceId: 't1', spanId: 's2', eventType: 'skill_completed', success: true, skillName: 'architect', durationMs: 3000, metadata: {} },
    ];
    await writeFile(join(tmpDir, 'telemetry-2026-03-11.jsonl'), makeJsonl(events));

    const app = createApp(tmpDir);
    const res = await app.inject({
      method: 'POST',
      url: '/query',
      payload: {
        targets: [{ target: 'skill_invocations', type: 'table' }],
        range: { from: '2026-03-11T00:00:00Z', to: '2026-03-12T00:00:00Z' },
      },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].type).toBe('table');
  });

  it('POST /annotations returns failure events', async () => {
    const events = [
      { timestamp: '2026-03-11T10:00:00Z', traceId: 't1', spanId: 's1', eventType: 'skill_failed', success: false, skillName: 'test-gen', metadata: { error: { message: 'timeout' } } },
    ];
    await writeFile(join(tmpDir, 'telemetry-2026-03-11.jsonl'), makeJsonl(events));

    const app = createApp(tmpDir);
    const res = await app.inject({
      method: 'POST',
      url: '/annotations',
      payload: {
        annotation: { query: 'failures' },
        range: { from: '2026-03-11T00:00:00Z', to: '2026-03-12T00:00:00Z' },
      },
    });
    expect(res.statusCode).toBe(200);
    const annotations = JSON.parse(res.payload);
    expect(annotations.length).toBe(1);
    expect(annotations[0].title).toContain('test-gen');
  });
});
