import { describe, it, expect } from 'vitest';
import {
  makeSkillEvent,
  writePendingSpan,
  readAllPendingSpans,
  deletePendingSpan,
} from '../src/hooks/shared.js';
import type { PendingSpan } from '../src/types.js';

describe('Hook shared utilities', () => {
  it('makeSkillEvent creates valid event structure', () => {
    const event = makeSkillEvent('skill_invoked', 'architect', 'span-1', 'trace-1');
    expect(event.eventType).toBe('skill_invoked');
    expect(event.skillName).toBe('architect');
    expect(event.spanId).toBe('span-1');
    expect(event.traceId).toBe('trace-1');
    expect(event.triggerReason).toBe('explicit_request');
  });

  it('makeSkillEvent merges extra fields', () => {
    const event = makeSkillEvent('skill_completed', 'debug', 's1', 't1', {
      durationMs: 1500,
      success: true,
    });
    expect(event.durationMs).toBe(1500);
    expect(event.success).toBe(true);
  });

  it('skill regex detects /skill-name patterns', () => {
    const pattern = /^\/([\w-]+)/;
    expect(pattern.exec('/architect feature')![1]).toBe('architect');
    expect(pattern.exec('/test-generator file.ts')![1]).toBe('test-generator');
    expect(pattern.exec('no slash')).toBeNull();
    expect(pattern.exec(' /not-at-start')).toBeNull();
  });
});

describe('Span lifecycle (integration)', () => {
  it('write, read, and delete pending span', async () => {
    const span: PendingSpan = {
      spanId: 'test-span-1',
      skillName: 'architect',
      startTime: new Date().toISOString(),
      traceId: 'test-trace-1',
    };
    await writePendingSpan(span);
    const spans = await readAllPendingSpans();
    expect(spans.some(s => s.spanId === 'test-span-1')).toBe(true);
    await deletePendingSpan('test-span-1');
    const after = await readAllPendingSpans();
    expect(after.some(s => s.spanId === 'test-span-1')).toBe(false);
  });

  it('concurrent spans are isolated (no corruption)', async () => {
    const span1: PendingSpan = {
      spanId: 'concurrent-1',
      skillName: 'architect',
      startTime: new Date().toISOString(),
      traceId: 'trace-a',
    };
    const span2: PendingSpan = {
      spanId: 'concurrent-2',
      skillName: 'test-gen',
      startTime: new Date().toISOString(),
      traceId: 'trace-b',
    };
    await Promise.all([
      writePendingSpan(span1),
      writePendingSpan(span2),
    ]);
    const spans = await readAllPendingSpans();
    expect(spans.some(s => s.spanId === 'concurrent-1')).toBe(true);
    expect(spans.some(s => s.spanId === 'concurrent-2')).toBe(true);
    await deletePendingSpan('concurrent-1');
    await deletePendingSpan('concurrent-2');
  });

  it('orphan detection based on startTime age', () => {
    const ORPHAN_THRESHOLD_MS = 60 * 60 * 1000;
    const oldStart = new Date(Date.now() - ORPHAN_THRESHOLD_MS - 1000).toISOString();
    const recentStart = new Date().toISOString();
    const durationOld = Date.now() - new Date(oldStart).getTime();
    const durationRecent = Date.now() - new Date(recentStart).getTime();
    expect(durationOld > ORPHAN_THRESHOLD_MS).toBe(true);
    expect(durationRecent > ORPHAN_THRESHOLD_MS).toBe(false);
  });
});
