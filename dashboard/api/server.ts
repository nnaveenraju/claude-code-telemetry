import Fastify, { FastifyInstance } from 'fastify';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_LOG_DIR = join(homedir(), '.claude-code-telemetry', 'logs');

interface TelemetryEvent {
  timestamp: string;
  traceId: string;
  spanId: string;
  eventType: string;
  success?: boolean;
  durationMs?: number;
  skillName?: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    contextBudgetPercent: number;
  };
  metadata: Record<string, unknown>;
}

interface QueryRequest {
  targets: Array<{ target: string; type?: string }>;
  range?: { from: string; to: string };
}

interface AnnotationRequest {
  annotation: { query: string };
  range?: { from: string; to: string };
}

async function loadEvents(logDir: string, from?: string, to?: string): Promise<TelemetryEvent[]> {
  const events: TelemetryEvent[] = [];
  try {
    const files = await readdir(logDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl')).sort();
    for (const file of jsonlFiles) {
      const content = await readFile(join(logDir, file), 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as TelemetryEvent;
          if (from && event.timestamp < from) continue;
          if (to && event.timestamp > to) continue;
          events.push(event);
        } catch {
          // skip malformed
        }
      }
    }
  } catch {
    // no logs yet
  }
  return events;
}

async function loadRangeEvents(
  logDir: string,
  range?: { from: string; to: string }
): Promise<TelemetryEvent[]> {
  return loadEvents(logDir, range?.from, range?.to);
}

function skillName(e: TelemetryEvent): string {
  return e.skillName ?? 'unknown';
}

export function createApp(logDir: string = DEFAULT_LOG_DIR): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/', async () => ({ status: 'ok' }));

  app.post('/search', async () => [
    'skill_invocations',
    'skill_duration_ms',
    'skill_tokens',
    'skill_success_rate',
    'context_budget_percent',
    'routing_decisions',
  ]);

  app.post<{ Body: QueryRequest }>('/query', async (request) => {
    const { targets, range } = request.body;
    const events = await loadRangeEvents(logDir, range);
    const results: unknown[] = [];

    for (const target of targets) {
      if (target.target === 'skill_invocations') {
        const skillEvents = events.filter(
          e => e.eventType === 'skill_completed' || e.eventType === 'skill_failed'
        );
        const bySkill = new Map<string, number>();
        for (const e of skillEvents) {
          bySkill.set(e.skillName ?? 'unknown', (bySkill.get(e.skillName ?? 'unknown') ?? 0) + 1);
        }
        if (target.type === 'table') {
          results.push({
            type: 'table',
            columns: [
              { text: 'Skill', type: 'string' },
              { text: 'Count', type: 'number' },
            ],
            rows: Array.from(bySkill.entries()).map(([skill, count]) => [skill, count]),
          });
        } else {
          for (const [skill, count] of bySkill) {
            results.push({
              target: skill,
              datapoints: [[count, new Date(events[events.length - 1]?.timestamp ?? Date.now()).getTime()]],
            });
          }
        }
      }

      if (target.target === 'skill_duration_ms') {
        const skillEvents = events.filter(e => e.eventType === 'skill_completed' && e.durationMs);
        for (const e of skillEvents) {
          results.push({
            target: e.skillName ?? 'unknown',
            datapoints: [[e.durationMs, new Date(e.timestamp).getTime()]],
          });
        }
      }

      if (target.target === 'skill_tokens') {
        const skillEvents = events.filter(e => e.eventType === 'skill_completed' && e.tokenUsage);
        for (const e of skillEvents) {
          const total = (e.tokenUsage!.inputTokens + e.tokenUsage!.outputTokens);
          results.push({
            target: e.skillName ?? 'unknown',
            datapoints: [[total, new Date(e.timestamp).getTime()]],
          });
        }
      }

      if (target.target === 'skill_success_rate') {
        const skillEvents = events.filter(
          e => e.eventType === 'skill_completed' || e.eventType === 'skill_failed'
        );
        const bySkill = new Map<string, { success: number; total: number }>();
        for (const e of skillEvents) {
          const name = e.skillName ?? 'unknown';
          const entry = bySkill.get(name) ?? { success: 0, total: 0 };
          entry.total++;
          if (e.success !== false) entry.success++;
          bySkill.set(name, entry);
        }
        results.push({
          type: 'table',
          columns: [
            { text: 'Skill', type: 'string' },
            { text: 'Success Rate', type: 'number' },
            { text: 'Total', type: 'number' },
          ],
          rows: Array.from(bySkill.entries()).map(([skill, { success, total }]) => [
            skill,
            Math.round((success / total) * 100),
            total,
          ]),
        });
      }

      if (target.target === 'context_budget_percent') {
        const ctxEvents = events.filter(e => e.eventType === 'context_budget_snapshot');
        for (const e of ctxEvents) {
          const remaining = (e as unknown as { remainingTokens: number; totalTokenBudget: number });
          const pct = remaining.totalTokenBudget > 0
            ? (remaining.remainingTokens / remaining.totalTokenBudget) * 100
            : 0;
          results.push({
            target: 'context_remaining_%',
            datapoints: [[pct, new Date(e.timestamp).getTime()]],
          });
        }
      }
    }

    return results;
  });

  // Grafana JSON datasource: /annotations
  app.post<{ Body: AnnotationRequest }>('/annotations', async (request) => {
    const events = await loadRangeEvents(logDir, request.body.range);
    return events
      .filter(e => e.eventType === 'skill_failed')
      .map(e => ({
        time: new Date(e.timestamp).getTime(),
        title: `${skillName(e)} failed`,
        text: (e.metadata?.error as { message?: string })?.message ?? 'Unknown error',
        tags: ['failure', skillName(e)],
      }));
  });

  return app;
}

// Start server if run directly
const isMain = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts');
if (isMain) {
  const app = createApp();
  app.listen({ port: 4000, host: '0.0.0.0' }).then(addr => {
    console.log(`Telemetry API listening on ${addr}`);
  });
}
