import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../dashboard/api/server.js';

const TEST_DIR = join(tmpdir(), `trace-test-${Date.now()}`);

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: new Date().toISOString(),
    traceId: 'trace-1',
    spanId: 'span-1',
    eventType: 'cascade_step',
    success: true,
    metadata: {},
    ...overrides,
  };
}

describe('Trace Visualization', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('Span Tree Builder via API', () => {
    it('builds a tree with skill root and tool children', async () => {
      const events = [
        makeEvent({ spanId: 'skill-1', eventType: 'skill_invoked', skillName: 'architect', timestamp: '2026-03-22T10:00:00.000Z' }),
        makeEvent({ spanId: 'tool-1', parentSpanId: 'skill-1', eventType: 'cascade_step', metadata: { toolName: 'Bash', phase: 'pre' }, timestamp: '2026-03-22T10:00:01.000Z' }),
        makeEvent({ spanId: 'tool-1-post', parentSpanId: 'skill-1', eventType: 'cascade_step', metadata: { toolName: 'Bash', phase: 'post' }, timestamp: '2026-03-22T10:00:02.000Z' }),
        makeEvent({ spanId: 'skill-1', eventType: 'skill_completed', skillName: 'architect', durationMs: 5000, timestamp: '2026-03-22T10:00:05.000Z' }),
      ];
      const logFile = join(TEST_DIR, 'telemetry-2026-03-22.jsonl');
      await writeFile(logFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');

      const app = createApp(TEST_DIR);
      const res = await app.inject({
        method: 'POST', url: '/query',
        payload: {
          targets: [{ target: 'trace_detail', type: 'table', payload: '{"traceId":"trace-1"}' }],
          range: { from: '2026-03-22T00:00:00Z', to: '2026-03-23T00:00:00Z' },
        },
      });
      const data = JSON.parse(res.payload);
      expect(data).toHaveLength(1);
      expect(data[0].rows.length).toBe(2); // skill root + Bash tool
      expect(data[0].rows[0][0]).toContain('architect');
      expect(data[0].rows[1][0]).toContain('Bash');
    });

    it('nests delegation spans under skill with tool children under delegation', async () => {
      const events = [
        makeEvent({ spanId: 'skill-1', eventType: 'skill_invoked', skillName: 'architect', timestamp: '2026-03-22T10:00:00.000Z' }),
        makeEvent({ spanId: 'deleg-1', parentSpanId: 'skill-1', eventType: 'subagent_delegated', metadata: { agentType: 'Explore' }, timestamp: '2026-03-22T10:00:01.000Z' }),
        makeEvent({ spanId: 'tool-1', parentSpanId: 'deleg-1', eventType: 'cascade_step', metadata: { toolName: 'Glob', phase: 'pre' }, timestamp: '2026-03-22T10:00:02.000Z' }),
        makeEvent({ spanId: 'tool-1-post', parentSpanId: 'deleg-1', eventType: 'cascade_step', metadata: { toolName: 'Glob', phase: 'post' }, timestamp: '2026-03-22T10:00:03.000Z' }),
        makeEvent({ spanId: 'deleg-1', parentSpanId: 'skill-1', eventType: 'subagent_returned', durationMs: 4000, timestamp: '2026-03-22T10:00:05.000Z' }),
        makeEvent({ spanId: 'skill-1', eventType: 'skill_completed', skillName: 'architect', durationMs: 10000, timestamp: '2026-03-22T10:00:10.000Z' }),
      ];
      const logFile = join(TEST_DIR, 'telemetry-2026-03-22.jsonl');
      await writeFile(logFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');

      const app = createApp(TEST_DIR);
      const res = await app.inject({
        method: 'POST', url: '/query',
        payload: {
          targets: [{ target: 'trace_detail', type: 'table', payload: '{"traceId":"trace-1"}' }],
          range: { from: '2026-03-22T00:00:00Z', to: '2026-03-23T00:00:00Z' },
        },
      });
      const data = JSON.parse(res.payload);
      const rows = data[0].rows;
      expect(rows.length).toBe(3); // skill, delegation, Glob tool
      expect(rows[0][0]).toContain('architect');
      expect(rows[1][0]).toContain('Agent: Explore');
      expect(rows[1][1]).toBe('delegation');
      expect(rows[2][0]).toContain('Glob');
    });

    it('handles nested delegations (agent within agent)', async () => {
      const events = [
        makeEvent({ spanId: 'skill-1', eventType: 'skill_invoked', skillName: 'pipeline', timestamp: '2026-03-22T10:00:00.000Z' }),
        makeEvent({ spanId: 'deleg-1', parentSpanId: 'skill-1', eventType: 'subagent_delegated', metadata: { agentType: 'Plan' }, timestamp: '2026-03-22T10:00:01.000Z' }),
        makeEvent({ spanId: 'deleg-2', parentSpanId: 'deleg-1', eventType: 'subagent_delegated', metadata: { agentType: 'Explore' }, timestamp: '2026-03-22T10:00:02.000Z' }),
        makeEvent({ spanId: 'tool-1', parentSpanId: 'deleg-2', eventType: 'cascade_step', metadata: { toolName: 'Grep', phase: 'pre' }, timestamp: '2026-03-22T10:00:03.000Z' }),
        makeEvent({ spanId: 'tool-1p', parentSpanId: 'deleg-2', eventType: 'cascade_step', metadata: { toolName: 'Grep', phase: 'post' }, timestamp: '2026-03-22T10:00:04.000Z' }),
        makeEvent({ spanId: 'deleg-2', parentSpanId: 'deleg-1', eventType: 'subagent_returned', durationMs: 3000, timestamp: '2026-03-22T10:00:05.000Z' }),
        makeEvent({ spanId: 'deleg-1', parentSpanId: 'skill-1', eventType: 'subagent_returned', durationMs: 5000, timestamp: '2026-03-22T10:00:06.000Z' }),
        makeEvent({ spanId: 'skill-1', eventType: 'skill_completed', skillName: 'pipeline', durationMs: 8000, timestamp: '2026-03-22T10:00:08.000Z' }),
      ];
      const logFile = join(TEST_DIR, 'telemetry-2026-03-22.jsonl');
      await writeFile(logFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');

      const app = createApp(TEST_DIR);
      const res = await app.inject({
        method: 'POST', url: '/query',
        payload: {
          targets: [{ target: 'trace_detail', type: 'table', payload: '{"traceId":"trace-1"}' }],
          range: { from: '2026-03-22T00:00:00Z', to: '2026-03-23T00:00:00Z' },
        },
      });
      const data = JSON.parse(res.payload);
      const rows = data[0].rows;
      expect(rows.length).toBe(4); // pipeline -> Plan -> Explore -> Grep
      expect(rows[0][0]).toContain('pipeline');
      expect(rows[1][0]).toContain('Plan');
      expect(rows[2][0]).toContain('Explore');
      expect(rows[3][0]).toContain('Grep');
      // Check depth via indentation
      expect(rows[2][0].indexOf('Agent')).toBeGreaterThan(rows[1][0].indexOf('Agent'));
    });
  });

  describe('Trace List API', () => {
    it('returns distinct traces with summary info', async () => {
      const events = [
        makeEvent({ traceId: 'trace-A', spanId: 's1', eventType: 'skill_invoked', skillName: 'architect', timestamp: '2026-03-22T10:00:00.000Z' }),
        makeEvent({ traceId: 'trace-A', spanId: 's2', parentSpanId: 's1', eventType: 'cascade_step', metadata: { toolName: 'Read', phase: 'pre' }, timestamp: '2026-03-22T10:00:01.000Z' }),
        makeEvent({ traceId: 'trace-A', spanId: 's1', eventType: 'skill_completed', skillName: 'architect', durationMs: 5000, timestamp: '2026-03-22T10:00:05.000Z' }),
        makeEvent({ traceId: 'trace-B', spanId: 's3', eventType: 'skill_invoked', skillName: 'analyze', timestamp: '2026-03-22T11:00:00.000Z' }),
        makeEvent({ traceId: 'trace-B', spanId: 's3', eventType: 'skill_failed', skillName: 'analyze', durationMs: 2000, success: false, timestamp: '2026-03-22T11:00:02.000Z' }),
      ];
      const logFile = join(TEST_DIR, 'telemetry-2026-03-22.jsonl');
      await writeFile(logFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');

      const app = createApp(TEST_DIR);
      const res = await app.inject({
        method: 'POST', url: '/query',
        payload: {
          targets: [{ target: 'trace_list', type: 'table' }],
          range: { from: '2026-03-22T00:00:00Z', to: '2026-03-23T00:00:00Z' },
        },
      });
      const data = JSON.parse(res.payload);
      expect(data[0].columns).toHaveLength(8);
      expect(data[0].rows).toHaveLength(2);
      // Most recent first
      expect(data[0].rows[0][0]).toBe('trace-B');
      expect(data[0].rows[0][1]).toBe('analyze');
      expect(data[0].rows[0][7]).toBe('error');
      expect(data[0].rows[1][0]).toBe('trace-A');
      expect(data[0].rows[1][1]).toBe('architect');
      expect(data[0].rows[1][7]).toBe('ok');
    });
  });

  describe('Delegation Span Pending Files', () => {
    it('findLatestDelegation returns most recent delegation span', async () => {
      const { findLatestDelegation } = await import('../src/hooks/shared.js');
      const spans = [
        { spanId: 'a', skillName: 'architect', startTime: '2026-03-22T10:00:00Z', traceId: 't1', type: 'skill' as const },
        { spanId: 'b', skillName: 'subagent:Explore', startTime: '2026-03-22T10:00:01Z', traceId: 't1', type: 'delegation' as const, parentSpanId: 'a', agentType: 'Explore' },
        { spanId: 'c', skillName: 'subagent:Plan', startTime: '2026-03-22T10:00:02Z', traceId: 't1', type: 'delegation' as const, parentSpanId: 'b', agentType: 'Plan' },
      ];
      const latest = findLatestDelegation(spans);
      expect(latest).toBeDefined();
      expect(latest!.spanId).toBe('c');
      expect(latest!.agentType).toBe('Plan');
    });

    it('findLatestDelegation returns undefined when no delegations exist', async () => {
      const { findLatestDelegation } = await import('../src/hooks/shared.js');
      const spans = [
        { spanId: 'a', skillName: 'architect', startTime: '2026-03-22T10:00:00Z', traceId: 't1' },
      ];
      expect(findLatestDelegation(spans)).toBeUndefined();
    });
  });
});
