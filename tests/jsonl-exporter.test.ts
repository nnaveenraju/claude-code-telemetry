// tests/jsonl-exporter.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JsonlExporter } from '../src/exporters/jsonl-exporter.js';
import type { TelemetryEvent } from '../src/types.js';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

describe('JsonlExporter', () => {
  let tmpDir: string;
  let exporter: JsonlExporter;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'telemetry-test-'));
    exporter = new JsonlExporter(tmpDir, 50);
  });

  afterEach(async () => {
    await exporter.shutdown();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes valid JSONL - each line parses as JSON', async () => {
    await exporter.export(makeEvent({ spanId: 'a' }));
    await exporter.export(makeEvent({ spanId: 'b' }));
    await exporter.flush();

    const files = await readdir(tmpDir);
    const jsonlFile = files.find(f => f.endsWith('.jsonl'));
    expect(jsonlFile).toBeDefined();

    const content = await readFile(join(tmpDir, jsonlFile!), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);

    const parsed = lines.map(line => JSON.parse(line));
    expect(parsed[0].spanId).toBe('a');
    expect(parsed[1].spanId).toBe('b');
  });

  it('rotates file when size exceeds limit', async () => {
    const smallExporter = new JsonlExporter(tmpDir, 0.0001); // ~100 bytes

    for (let i = 0; i < 20; i++) {
      await smallExporter.export(makeEvent({ spanId: `span-${i}` }));
    }
    await smallExporter.flush();
    await smallExporter.shutdown();

    const files = await readdir(tmpDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    expect(jsonlFiles.length).toBeGreaterThan(1);
  });

  it('handles concurrent flush calls', async () => {
    for (let i = 0; i < 10; i++) {
      await exporter.export(makeEvent({ spanId: `span-${i}` }));
    }
    await Promise.all([exporter.flush(), exporter.flush()]);

    const files = await readdir(tmpDir);
    const jsonlFile = files.find(f => f.endsWith('.jsonl'));
    const content = await readFile(join(tmpDir, jsonlFile!), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(10);
    lines.forEach(line => {
      expect(() => JSON.parse(line)).not.toThrow();
    });
  });

  it('creates date-stamped filename', async () => {
    await exporter.export(makeEvent());
    await exporter.flush();

    const files = await readdir(tmpDir);
    const today = new Date().toISOString().slice(0, 10);
    expect(files.some(f => f.includes(today))).toBe(true);
  });
});
