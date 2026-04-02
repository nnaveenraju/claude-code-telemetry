import Fastify, { FastifyInstance } from 'fastify';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_LOG_DIR = join(homedir(), '.claude-code-telemetry', 'logs');

interface TelemetryEvent {
  timestamp: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
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
  targets: Array<{ target: string; type?: string; payload?: string }>;
  range?: { from: string; to: string };
}

interface SpanNode {
  spanId: string;
  parentSpanId?: string;
  name: string;
  type: 'skill' | 'delegation' | 'tool';
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: 'ok' | 'error';
  depth: number;
  children: SpanNode[];
}

function buildSpanTree(events: TelemetryEvent[]): SpanNode[] {
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const nodes = new Map<string, SpanNode>();
  const roots: SpanNode[] = [];

  // Pass 1: Create root skill spans and delegation spans
  for (const e of sorted) {
    if (e.eventType === 'skill_invoked') {
      nodes.set(e.spanId, {
        spanId: e.spanId, parentSpanId: e.parentSpanId,
        name: e.skillName ?? 'unknown', type: 'skill',
        startTime: new Date(e.timestamp).getTime(),
        status: 'ok', depth: 0, children: [],
      });
    }
    if (e.eventType === 'skill_completed' || e.eventType === 'skill_failed') {
      const node = nodes.get(e.spanId);
      if (node) {
        node.endTime = new Date(e.timestamp).getTime();
        node.durationMs = e.durationMs ?? (node.endTime - node.startTime);
        if (e.eventType === 'skill_failed') node.status = 'error';
      }
    }
    if (e.eventType === 'subagent_delegated') {
      nodes.set(e.spanId, {
        spanId: e.spanId, parentSpanId: e.parentSpanId,
        name: `Agent: ${(e.metadata?.agentType as string) ?? 'unknown'}`,
        type: 'delegation',
        startTime: new Date(e.timestamp).getTime(),
        status: 'ok', depth: 0, children: [],
      });
    }
    if (e.eventType === 'subagent_returned') {
      const node = nodes.get(e.spanId);
      if (node) {
        node.endTime = new Date(e.timestamp).getTime();
        node.durationMs = e.durationMs ?? (node.endTime - node.startTime);
        if (e.success === false) node.status = 'error';
      }
    }
  }

  // Pass 2: Pair pre/post cascade_steps into tool spans
  const prePending: TelemetryEvent[] = [];
  for (const e of sorted) {
    if (e.eventType !== 'cascade_step') continue;
    const phase = e.metadata?.phase as string;
    const toolName = (e.metadata?.toolName as string) ?? 'unknown';
    if (phase === 'pre') {
      prePending.push(e);
    } else if (phase === 'post') {
      const matchIdx = prePending.findIndex(
        p => (p.metadata?.toolName as string) === toolName && p.parentSpanId === e.parentSpanId
      );
      const pre = matchIdx >= 0 ? prePending.splice(matchIdx, 1)[0] : undefined;
      const startTs = pre ? new Date(pre.timestamp).getTime() : new Date(e.timestamp).getTime();
      const endTs = new Date(e.timestamp).getTime();
      const toolNode: SpanNode = {
        spanId: pre?.spanId ?? e.spanId, parentSpanId: e.parentSpanId,
        name: toolName, type: 'tool',
        startTime: startTs, endTime: endTs,
        durationMs: endTs - startTs,
        status: 'ok', depth: 0, children: [],
      };
      nodes.set(toolNode.spanId, toolNode);
    }
  }
  // Remaining unpaired pre events become tool spans too
  for (const pre of prePending) {
    const toolName = (pre.metadata?.toolName as string) ?? 'unknown';
    const toolNode: SpanNode = {
      spanId: pre.spanId, parentSpanId: pre.parentSpanId,
      name: toolName, type: 'tool',
      startTime: new Date(pre.timestamp).getTime(),
      status: 'ok', depth: 0, children: [],
    };
    nodes.set(toolNode.spanId, toolNode);
  }

  // Pass 3: Build tree from parentSpanId relationships
  for (const node of nodes.values()) {
    if (node.parentSpanId && nodes.has(node.parentSpanId)) {
      nodes.get(node.parentSpanId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Pass 4: Compute depth and sort children by startTime
  function setDepth(node: SpanNode, depth: number) {
    node.depth = depth;
    node.children.sort((a, b) => a.startTime - b.startTime);
    for (const child of node.children) setDepth(child, depth + 1);
  }
  for (const root of roots) setDepth(root, 0);
  roots.sort((a, b) => a.startTime - b.startTime);
  return roots;
}

function flattenTree(roots: SpanNode[]): SpanNode[] {
  const flat: SpanNode[] = [];
  function walk(node: SpanNode) {
    flat.push(node);
    for (const child of node.children) walk(child);
  }
  for (const root of roots) walk(root);
  return flat;
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

/** Merge per-event datapoints into one series per target name (SimpleJSON protocol) */
function mergeTimeseries(
  entries: Array<{ name: string; value: number; ts: number }>
): Array<{ target: string; datapoints: number[][] }> {
  const grouped = new Map<string, number[][]>();
  for (const { name, value, ts } of entries) {
    const arr = grouped.get(name) ?? [];
    arr.push([value, ts]);
    grouped.set(name, arr);
  }
  return Array.from(grouped.entries()).map(([target, datapoints]) => ({
    target,
    datapoints: datapoints.sort((a, b) => a[1] - b[1]),
  }));
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
    'trace_list',
    'trace_detail',
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
          bySkill.set(skillName(e), (bySkill.get(skillName(e)) ?? 0) + 1);
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
          const entries = Array.from(bySkill.entries()).map(([skill, count]) => ({
            name: skill,
            value: count,
            ts: new Date(events[events.length - 1]?.timestamp ?? Date.now()).getTime(),
          }));
          results.push(...mergeTimeseries(entries));
        }
      }

      if (target.target === 'skill_duration_ms') {
        const skillEvents = events.filter(e => e.eventType === 'skill_completed' && e.durationMs);
        const entries = skillEvents.map(e => ({
          name: skillName(e),
          value: e.durationMs!,
          ts: new Date(e.timestamp).getTime(),
        }));
        results.push(...mergeTimeseries(entries));
      }

      if (target.target === 'skill_tokens') {
        const skillEvents = events.filter(e => e.eventType === 'skill_completed' && e.tokenUsage);
        const entries = skillEvents.map(e => ({
          name: skillName(e),
          value: e.tokenUsage!.inputTokens + e.tokenUsage!.outputTokens,
          ts: new Date(e.timestamp).getTime(),
        }));
        results.push(...mergeTimeseries(entries));
      }

      if (target.target === 'skill_success_rate') {
        const skillEvents = events.filter(
          e => e.eventType === 'skill_completed' || e.eventType === 'skill_failed'
        );
        const bySkill = new Map<string, { success: number; total: number }>();
        for (const e of skillEvents) {
          const name = skillName(e);
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
        const entries = ctxEvents.map(e => {
          const remaining = (e as unknown as { remainingTokens: number; totalTokenBudget: number });
          const pct = remaining.totalTokenBudget > 0
            ? (remaining.remainingTokens / remaining.totalTokenBudget) * 100
            : 0;
          return { name: 'context_remaining_%', value: pct, ts: new Date(e.timestamp).getTime() };
        });
        results.push(...mergeTimeseries(entries));
      }

      if (target.target === 'trace_list') {
        const traceMap = new Map<string, {
          skill: string; start: string; duration: number;
          spanCount: number; status: string;
          tools: Set<string>; agents: Set<string>;
        }>();
        for (const e of events) {
          if (e.traceId === 'no-trace') continue;
          const existing = traceMap.get(e.traceId);
          if (!existing) {
            traceMap.set(e.traceId, {
              skill: e.skillName ?? '—',
              start: e.timestamp, duration: 0, spanCount: 1, status: 'ok',
              tools: new Set(), agents: new Set(),
            });
          } else {
            existing.spanCount++;
            if (e.eventType === 'skill_failed') existing.status = 'error';
            if (e.eventType === 'skill_completed' || e.eventType === 'skill_failed') {
              existing.duration = e.durationMs ?? 0;
              if (e.skillName) existing.skill = e.skillName;
            }
          }
          const entry = traceMap.get(e.traceId)!;
          if (e.eventType === 'cascade_step') {
            const tool = e.metadata?.toolName as string;
            if (tool) entry.tools.add(tool);
          }
          if (e.eventType === 'subagent_delegated') {
            const agent = e.metadata?.agentType as string;
            if (agent) entry.agents.add(agent);
          }
        }
        const rows = Array.from(traceMap.entries())
          .sort((a, b) => b[1].start.localeCompare(a[1].start))
          .map(([traceId, info]) => {
            const agentStr = info.agents.size > 0 ? [...info.agents].join(', ') : '—';
            const toolStr = [...info.tools].join(', ') || '—';
            return [traceId, info.skill, info.start, info.duration, info.spanCount, agentStr, toolStr, info.status];
          });
        results.push({
          type: 'table',
          columns: [
            { text: 'Trace ID', type: 'string' },
            { text: 'Prompt', type: 'string' },
            { text: 'Start', type: 'time' },
            { text: 'Duration (ms)', type: 'number' },
            { text: 'Spans', type: 'number' },
            { text: 'Agents', type: 'string' },
            { text: 'Tools Used', type: 'string' },
            { text: 'Status', type: 'string' },
          ],
          rows,
        });
      }

      const traceDetailMatch = target.target.match(/^trace_detail(?::(.+))?$/);
      if (traceDetailMatch) {
        let traceId = traceDetailMatch[1] ?? '';
        if (!traceId && target.payload) {
          try { traceId = (JSON.parse(target.payload) as { traceId?: string }).traceId ?? ''; } catch { /* ignore */ }
        }
        if (traceId) {
          const traceEvents = events.filter(e => e.traceId === traceId);
          const tree = buildSpanTree(traceEvents);
          const flat = flattenTree(tree);
          const rows = flat.map(node => {
            const indent = '  '.repeat(node.depth) + (node.depth > 0 ? '├─ ' : '');
            const durStr = node.durationMs != null ? `${node.durationMs}ms` : '—';
            return [indent + node.name, node.type, durStr, node.status];
          });
          results.push({
            type: 'table',
            columns: [
              { text: 'Span', type: 'string' },
              { text: 'Type', type: 'string' },
              { text: 'Duration', type: 'string' },
              { text: 'Status', type: 'string' },
            ],
            rows,
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

  // ─── Jaeger-style HTML trace viewer ───
  app.get<{ Params: { traceId: string } }>('/trace/:traceId', async (request, reply) => {
    const { traceId } = request.params;
    const events = await loadEvents(logDir);
    const traceEvents = events.filter(e => e.traceId === traceId);
    if (traceEvents.length === 0) {
      reply.code(404);
      return { error: 'Trace not found' };
    }
    const tree = buildSpanTree(traceEvents);
    const flat = flattenTree(tree);
    const traceStart = Math.min(...flat.map(n => n.startTime));
    const traceEnd = Math.max(...flat.map(n => (n.endTime ?? n.startTime)));
    const traceDur = traceEnd - traceStart || 1;
    const rootSkill = flat[0]?.name ?? 'unknown';
    const maxDepth = Math.max(...flat.map(n => n.depth));
    const totalSpans = flat.length;

    function fmtMs(ms: number): string {
      if (ms < 1000) return `${ms.toFixed(1)}ms`;
      if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
      return `${(ms / 60000).toFixed(1)}m`;
    }

    const COLORS: Record<string, string> = {
      skill: '#17a2b8',
      delegation: '#9b59b6',
      tool: '#d4a259',
    };

    const spanRows = flat.map((node, i) => {
      const left = ((node.startTime - traceStart) / traceDur) * 100;
      const width = Math.max(0.3, ((node.durationMs ?? 0) / traceDur) * 100);
      const color = COLORS[node.type] ?? '#888';
      const indent = node.depth * 24;
      const durLabel = node.durationMs != null ? fmtMs(node.durationMs) : '';
      const childIds = node.children.map((_, ci) => flat.indexOf(node.children[ci]));

      return `
        <div class="span-row" data-idx="${i}" data-depth="${node.depth}" data-parent="${node.parentSpanId ?? ''}">
          <div class="span-label" style="padding-left:${indent + 8}px">
            ${node.children.length > 0 ? `<span class="toggle" onclick="toggleChildren(${i})">▼</span>` : '<span class="toggle-placeholder"></span>'}
            <span class="svc" style="background:${color}">${node.type === 'delegation' ? 'agent' : node.type}</span>
            <span class="op">${escHtml(node.name)}</span>
          </div>
          <div class="span-bar-container">
            <div class="span-bar" style="left:${left}%;width:${width}%;background:${color};" title="${escHtml(node.name)}: ${durLabel}">
              <span class="bar-label">${durLabel}</span>
            </div>
          </div>
        </div>`;
    }).join('');

    // Minimap bars
    const minimapBars = flat.map(node => {
      const left = ((node.startTime - traceStart) / traceDur) * 100;
      const width = Math.max(0.2, ((node.durationMs ?? 0) / traceDur) * 100);
      const color = COLORS[node.type] ?? '#888';
      const top = (node.depth / (maxDepth + 1)) * 100;
      const height = 100 / (maxDepth + 1);
      return `<div style="position:absolute;left:${left}%;width:${width}%;top:${top}%;height:${height}%;background:${color};opacity:0.7;border-radius:1px;"></div>`;
    }).join('');

    // Timeline ticks
    const tickCount = 6;
    const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
      const pct = (i / tickCount) * 100;
      const ms = (i / tickCount) * traceDur;
      return `<div class="tick" style="left:${pct}%"><span>${fmtMs(ms)}</span></div>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escHtml(rootSkill)} - Trace Viewer</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; }
  .header { padding: 20px 24px; border-bottom: 1px solid #333; }
  .header h1 { font-size: 20px; font-weight: 600; color: #fff; }
  .header h1 .skill { color: #17a2b8; }
  .meta { margin-top: 8px; font-size: 13px; color: #999; display: flex; gap: 16px; }
  .meta b { color: #ccc; }
  .minimap { height: 50px; margin: 0 24px; position: relative; background: #111; border: 1px solid #333; border-radius: 4px; overflow: hidden; }
  .timeline { position: relative; height: 28px; margin: 0 24px; border-bottom: 1px solid #333; }
  .tick { position: absolute; top: 0; height: 100%; border-left: 1px solid #444; }
  .tick span { position: absolute; bottom: 4px; left: 4px; font-size: 11px; color: #888; white-space: nowrap; }
  .spans { margin: 0; }
  .span-row { display: flex; border-bottom: 1px solid #222; min-height: 32px; align-items: center; }
  .span-row:hover { background: #252540; }
  .span-label { width: 280px; min-width: 280px; display: flex; align-items: center; gap: 6px; font-size: 13px; padding-right: 8px; overflow: hidden; white-space: nowrap; border-right: 1px solid #333; }
  .toggle { cursor: pointer; font-size: 10px; color: #888; user-select: none; width: 14px; text-align: center; }
  .toggle-placeholder { width: 14px; }
  .svc { font-size: 10px; font-weight: 600; text-transform: uppercase; padding: 1px 5px; border-radius: 3px; color: #fff; flex-shrink: 0; }
  .op { color: #ddd; overflow: hidden; text-overflow: ellipsis; }
  .span-bar-container { flex: 1; position: relative; height: 100%; padding: 4px 12px; }
  .span-bar { position: absolute; top: 8px; height: 16px; border-radius: 3px; min-width: 2px; display: flex; align-items: center; }
  .bar-label { font-size: 11px; color: #fff; padding-left: 6px; white-space: nowrap; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
  .span-row.collapsed { display: none; }
  .legend { display: flex; gap: 16px; padding: 12px 24px; border-top: 1px solid #333; font-size: 12px; }
  .legend-item { display: flex; align-items: center; gap: 4px; }
  .legend-dot { width: 12px; height: 12px; border-radius: 2px; }
  a { color: #17a2b8; }
</style>
</head>
<body>
  <div class="header">
    <h1><span class="skill">${escHtml(rootSkill)}</span></h1>
    <div class="meta">
      <span>Trace Start: <b>${new Date(traceStart).toLocaleString()}</b></span>
      <span>Duration: <b>${fmtMs(traceDur)}</b></span>
      <span>Services: <b>${new Set(flat.map(n => n.type)).size}</b></span>
      <span>Depth: <b>${maxDepth}</b></span>
      <span>Total Spans: <b>${totalSpans}</b></span>
    </div>
  </div>
  <div class="minimap">${minimapBars}</div>
  <div class="timeline" style="margin-left: calc(280px + 24px); margin-right: 24px;">${ticks}</div>
  <div class="spans">${spanRows}</div>
  <div class="legend">
    <div class="legend-item"><div class="legend-dot" style="background:#17a2b8"></div> Skill</div>
    <div class="legend-item"><div class="legend-dot" style="background:#9b59b6"></div> Agent</div>
    <div class="legend-item"><div class="legend-dot" style="background:#d4a259"></div> Tool</div>
  </div>
  <script>
    function toggleChildren(idx) {
      const row = document.querySelector('[data-idx="'+idx+'"]');
      const depth = parseInt(row.dataset.depth);
      const toggle = row.querySelector('.toggle');
      const isCollapsing = toggle.textContent.trim() === '▼';
      toggle.textContent = isCollapsing ? '▶' : '▼';
      let sibling = row.nextElementSibling;
      while (sibling) {
        const d = parseInt(sibling.dataset.depth);
        if (d <= depth) break;
        if (isCollapsing) {
          sibling.classList.add('collapsed');
        } else {
          sibling.classList.remove('collapsed');
          const t = sibling.querySelector('.toggle');
          if (t) t.textContent = '▼';
        }
        sibling = sibling.nextElementSibling;
      }
    }
  </script>
</body>
</html>`;
    reply.header('Content-Type', 'text/html');
    return html;
  });

  return app;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Start server if run directly
const isMain = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts');
if (isMain) {
  const logDir = process.env.LOG_DIR || DEFAULT_LOG_DIR;
  const app = createApp(logDir);
  app.listen({ port: 4000, host: '0.0.0.0' }).then(addr => {
    console.log(`Telemetry API listening on ${addr}`);
  });
}
