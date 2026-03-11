import { readdir, readFile, writeFile, unlink, mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { homedir } from 'node:os';
import type { PendingSpan, TelemetryEvent, SkillInvocationEvent } from '../types.js';

const BASE_DIR = join(homedir(), '.claude-code-telemetry');
const SPANS_DIR = join(BASE_DIR, '.pending-spans');
const LOGS_DIR = join(BASE_DIR, 'logs');

export async function ensureDirs(): Promise<void> {
  await mkdir(SPANS_DIR, { recursive: true });
  await mkdir(LOGS_DIR, { recursive: true });
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export async function writePendingSpan(span: PendingSpan): Promise<void> {
  await ensureDirs();
  const file = join(SPANS_DIR, `${span.spanId}.json`);
  await writeFile(file, JSON.stringify(span), 'utf-8');
}

export async function readAllPendingSpans(): Promise<PendingSpan[]> {
  await ensureDirs();
  const files = await readdir(SPANS_DIR);
  const spans: PendingSpan[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = await readFile(join(SPANS_DIR, file), 'utf-8');
      spans.push(JSON.parse(data) as PendingSpan);
    } catch {
      // Skip corrupt files
    }
  }
  return spans;
}

export async function deletePendingSpan(spanId: string): Promise<void> {
  try {
    await unlink(join(SPANS_DIR, `${spanId}.json`));
  } catch {
    // Already deleted
  }
}

export async function appendEvent(event: TelemetryEvent): Promise<void> {
  await ensureDirs();
  const date = new Date().toISOString().slice(0, 10);
  const file = join(LOGS_DIR, `telemetry-${date}.jsonl`);
  await appendFile(file, JSON.stringify(event) + '\n', 'utf-8');
}

export function makeSkillEvent(
  type: SkillInvocationEvent['eventType'],
  skillName: string,
  spanId: string,
  traceId: string,
  extra: Partial<SkillInvocationEvent> = {}
): SkillInvocationEvent {
  return {
    timestamp: new Date().toISOString(),
    traceId,
    spanId,
    eventType: type,
    skillName,
    triggerReason: 'explicit_request',
    metadata: {},
    ...extra,
  };
}

export { SPANS_DIR, LOGS_DIR, uuidv4 };
