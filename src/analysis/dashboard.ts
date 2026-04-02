#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import { ModelAnalyzer } from './model-analyzer.js';
import type {
  TelemetryEvent,
  SkillInvocationEvent,
  RoutingDecisionEvent,
  ContextBudgetEvent,
} from '../types.js';

const LOGS_DIR = join(homedir(), '.claude-code-telemetry', 'logs');

interface CliArgs {
  report: string;
  date: string;
  skill?: string;
  traceId?: string;
  errorsOnly: boolean;
  format: 'table' | 'json';
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    report: 'skills',
    date: new Date().toISOString().slice(0, 10),
    errorsOnly: false,
    format: 'table',
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--report' && args[i + 1]) result.report = args[++i];
    if (args[i] === '--date' && args[i + 1]) result.date = args[++i];
    if (args[i] === '--skill' && args[i + 1]) result.skill = args[++i];
    if (args[i] === '--trace-id' && args[i + 1]) result.traceId = args[++i];
    if (args[i] === '--errors-only') result.errorsOnly = true;
    if (args[i] === '--format' && args[i + 1]) result.format = args[++i] as 'table' | 'json';
  }
  return result;
}

async function loadEvents(date: string): Promise<TelemetryEvent[]> {
  const events: TelemetryEvent[] = [];
  try {
    const files = await readdir(LOGS_DIR);
    const matching = files.filter(f => f.includes(date) && f.endsWith('.jsonl'));
    for (const file of matching) {
      const content = await readFile(join(LOGS_DIR, file), 'utf-8');
      for (const line of content.trim().split('\n')) {
        if (!line) continue;
        try {
          events.push(JSON.parse(line) as TelemetryEvent);
        } catch {
          // Skip malformed lines
        }
      }
    }
  } catch {
    // No log directory yet
  }
  return events;
}

function filterEvents(events: TelemetryEvent[], args: CliArgs): TelemetryEvent[] {
  let filtered = events;
  if (args.skill) {
    filtered = filtered.filter(e => {
      const skill = (e as SkillInvocationEvent).skillName;
      return skill === args.skill;
    });
  }
  if (args.errorsOnly) {
    filtered = filtered.filter(e => e.success === false);
  }
  return filtered;
}

function reportSkills(events: TelemetryEvent[], format: string): void {
  const skillEvents = events.filter(
    e => e.eventType === 'skill_completed' || e.eventType === 'skill_failed'
  ) as SkillInvocationEvent[];
  if (skillEvents.length === 0) {
    console.log(chalk.yellow('No skill events found.'));
    return;
  }
  const bySkill = new Map<string, SkillInvocationEvent[]>();
  for (const e of skillEvents) {
    const arr = bySkill.get(e.skillName) ?? [];
    arr.push(e);
    bySkill.set(e.skillName, arr);
  }
  if (format === 'json') {
    const data = Array.from(bySkill.entries()).map(([name, evts]) => ({
      skill: name,
      count: evts.length,
      avgDurationMs: Math.round(evts.reduce((s, e) => s + (e.durationMs ?? 0), 0) / evts.length),
      successRate: evts.filter(e => e.success !== false).length / evts.length,
      avgTokens: Math.round(evts.reduce((s, e) => s + (e.tokenUsage ? e.tokenUsage.inputTokens + e.tokenUsage.outputTokens : 0), 0) / evts.length),
    }));
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(chalk.bold('\n  Skill Usage Report\n'));
  console.log(chalk.gray('  Skill                Count  Avg Duration  Success  Avg Tokens'));
  console.log(chalk.gray('  ' + '-'.repeat(65)));
  for (const [name, evts] of bySkill) {
    const count = evts.length;
    const avgDur = Math.round(evts.reduce((s, e) => s + (e.durationMs ?? 0), 0) / count);
    const successRate = evts.filter(e => e.success !== false).length / count;
    const avgTokens = Math.round(evts.reduce((s, e) => s + (e.tokenUsage ? e.tokenUsage.inputTokens + e.tokenUsage.outputTokens : 0), 0) / count);
    const rateColor = successRate >= 0.95 ? chalk.green : successRate >= 0.85 ? chalk.yellow : chalk.red;
    console.log(
      `  ${name.padEnd(20)} ${String(count).padStart(5)}  ${String(avgDur + 'ms').padStart(12)}  ${rateColor((successRate * 100).toFixed(0) + '%').padStart(7)}  ${String(avgTokens).padStart(10)}`
    );
  }
  console.log();
}

function reportRouting(events: TelemetryEvent[], format: string): void {
  const routingEvents = events.filter(
    e => e.eventType === 'routing_decision'
  ) as RoutingDecisionEvent[];
  if (routingEvents.length === 0) {
    console.log(chalk.yellow('No routing events found.'));
    return;
  }
  if (format === 'json') {
    console.log(JSON.stringify(routingEvents, null, 2));
    return;
  }
  console.log(chalk.bold('\n  Routing Decisions\n'));
  for (const e of routingEvents) {
    const time = new Date(e.timestamp).toLocaleTimeString('en-US', { hour12: false });
    console.log(chalk.cyan(`  [${time}] depth:${e.cascadeDepth} -> ${e.selectedSkill ?? 'none'}`));
    for (const c of e.candidates) {
      const icon = c.matched ? chalk.green('Y') : chalk.gray('.');
      console.log(`    ${icon} ${c.skillName}: ${(c.confidenceScore * 100).toFixed(0)}%`);
    }
  }
  console.log();
}

function reportContext(events: TelemetryEvent[], format: string): void {
  const ctxEvents = events.filter(
    e => e.eventType === 'context_budget_snapshot'
  ) as ContextBudgetEvent[];
  if (ctxEvents.length === 0) {
    console.log(chalk.yellow('No context budget events found.'));
    return;
  }
  if (format === 'json') {
    console.log(JSON.stringify(ctxEvents, null, 2));
    return;
  }
  console.log(chalk.bold('\n  Context Budget Snapshots\n'));
  for (const e of ctxEvents) {
    const time = new Date(e.timestamp).toLocaleTimeString('en-US', { hour12: false });
    const pct = e.totalTokenBudget > 0
      ? ((e.remainingTokens / e.totalTokenBudget) * 100).toFixed(1)
      : '0.0';
    const color = Number(pct) < 20 ? chalk.red : Number(pct) < 50 ? chalk.yellow : chalk.green;
    console.log(`  [${time}] ${color(pct + '% remaining')} (${e.remainingTokens}/${e.totalTokenBudget})`);
  }
  console.log();
}

function reportModelRecommendations(events: TelemetryEvent[], format: string): void {
  const skillEvents = events.filter(
    e => e.eventType === 'skill_completed' || e.eventType === 'skill_failed'
  ) as SkillInvocationEvent[];
  const analyzer = new ModelAnalyzer(skillEvents);
  const recs = analyzer.analyze();
  if (recs.length === 0) {
    console.log(chalk.yellow('No skill data for model recommendations.'));
    return;
  }
  if (format === 'json') {
    console.log(JSON.stringify(recs, null, 2));
    return;
  }
  console.log(chalk.bold('\n  Model Recommendations\n'));
  for (const rec of recs) {
    const arrow = rec.currentModel !== rec.recommendedModel
      ? chalk.yellow(`${rec.currentModel ?? '?'} -> ${rec.recommendedModel}`)
      : chalk.green(rec.recommendedModel);
    console.log(`  ${rec.skillName.padEnd(20)} ${arrow}`);
    console.log(chalk.gray(`    ${rec.reasoning}`));
  }
  console.log();
}

async function loadAllEvents(): Promise<TelemetryEvent[]> {
  const events: TelemetryEvent[] = [];
  try {
    const files = await readdir(LOGS_DIR);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl')).sort();
    for (const file of jsonlFiles) {
      const content = await readFile(join(LOGS_DIR, file), 'utf-8');
      for (const line of content.trim().split('\n')) {
        if (!line) continue;
        try { events.push(JSON.parse(line) as TelemetryEvent); } catch { /* skip */ }
      }
    }
  } catch { /* no logs */ }
  return events;
}

interface TraceSpanNode {
  spanId: string;
  parentSpanId?: string;
  name: string;
  type: 'skill' | 'delegation' | 'tool';
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: 'ok' | 'error';
  depth: number;
  children: TraceSpanNode[];
}

function buildTraceTree(events: TelemetryEvent[]): TraceSpanNode[] {
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const nodes = new Map<string, TraceSpanNode>();
  const roots: TraceSpanNode[] = [];

  for (const e of sorted) {
    if (e.eventType === 'skill_invoked') {
      nodes.set(e.spanId, {
        spanId: e.spanId, parentSpanId: e.parentSpanId,
        name: (e as SkillInvocationEvent).skillName ?? 'unknown', type: 'skill',
        startTime: new Date(e.timestamp).getTime(), status: 'ok', depth: 0, children: [],
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
        type: 'delegation', startTime: new Date(e.timestamp).getTime(),
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
      nodes.set(pre?.spanId ?? e.spanId, {
        spanId: pre?.spanId ?? e.spanId, parentSpanId: e.parentSpanId,
        name: toolName, type: 'tool', startTime: startTs, endTime: endTs,
        durationMs: endTs - startTs, status: 'ok', depth: 0, children: [],
      });
    }
  }
  for (const pre of prePending) {
    nodes.set(pre.spanId, {
      spanId: pre.spanId, parentSpanId: pre.parentSpanId,
      name: (pre.metadata?.toolName as string) ?? 'unknown', type: 'tool',
      startTime: new Date(pre.timestamp).getTime(),
      status: 'ok', depth: 0, children: [],
    });
  }

  for (const node of nodes.values()) {
    if (node.parentSpanId && nodes.has(node.parentSpanId)) {
      nodes.get(node.parentSpanId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function setDepth(node: TraceSpanNode, depth: number) {
    node.depth = depth;
    node.children.sort((a, b) => a.startTime - b.startTime);
    for (const child of node.children) setDepth(child, depth + 1);
  }
  for (const root of roots) setDepth(root, 0);
  roots.sort((a, b) => a.startTime - b.startTime);
  return roots;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function reportTraces(events: TelemetryEvent[], format: string): void {
  const traceMap = new Map<string, {
    prompt: string; start: string; durationMs: number;
    spanCount: number; status: string;
    tools: Set<string>; agents: Set<string>;
  }>();
  for (const e of events) {
    if (e.traceId === 'no-trace') continue;
    const existing = traceMap.get(e.traceId);
    if (!existing) {
      traceMap.set(e.traceId, {
        prompt: (e as SkillInvocationEvent).skillName ?? '—',
        start: e.timestamp, durationMs: 0, spanCount: 1, status: 'ok',
        tools: new Set(), agents: new Set(),
      });
    } else {
      existing.spanCount++;
      if (e.eventType === 'skill_failed') existing.status = 'error';
      if (e.eventType === 'skill_completed' || e.eventType === 'skill_failed') {
        existing.durationMs = e.durationMs ?? 0;
        if ((e as SkillInvocationEvent).skillName) existing.prompt = (e as SkillInvocationEvent).skillName;
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
  const traces = Array.from(traceMap.entries()).sort((a, b) => b[1].start.localeCompare(a[1].start));
  if (traces.length === 0) { console.log(chalk.yellow('No traces found.')); return; }
  if (format === 'json') { console.log(JSON.stringify(traces.map(([id, info]) => ({ traceId: id, ...info, tools: [...info.tools], agents: [...info.agents] })), null, 2)); return; }
  console.log(chalk.bold('\n  Recent Traces\n'));
  for (const [traceId, info] of traces.slice(0, 20)) {
    const statusIcon = info.status === 'ok' ? chalk.green('✓') : chalk.red('✗');
    const dur = formatDuration(info.durationMs).padStart(8);
    const promptLabel = info.prompt.length > 50 ? info.prompt.slice(0, 47) + '...' : info.prompt;
    console.log(`  ${statusIcon} ${chalk.cyan(traceId)}  ${dur}  ${String(info.spanCount).padStart(3)} spans`);
    console.log(chalk.gray(`    Prompt: ${promptLabel}`));
    if (info.agents.size > 0) console.log(chalk.magenta(`    Agents: ${[...info.agents].join(', ')}`));
    console.log(chalk.yellow(`    Tools:  ${[...info.tools].join(', ') || '—'}`));
    console.log();
  }
}

function reportTrace(events: TelemetryEvent[], traceId: string, format: string): void {
  const traceEvents = events.filter(e => e.traceId === traceId);
  if (traceEvents.length === 0) { console.log(chalk.red(`No events found for trace ${traceId}`)); return; }
  const roots = buildTraceTree(traceEvents);
  if (format === 'json') {
    console.log(JSON.stringify(roots, null, 2));
    return;
  }
  const traceStart = Math.min(...traceEvents.map(e => new Date(e.timestamp).getTime()));
  console.log(chalk.bold(`\n  Trace: ${chalk.cyan(traceId)}\n`));

  function renderNode(node: TraceSpanNode, prefix: string, isLast: boolean) {
    const connector = node.depth === 0 ? '' : (isLast ? '└─ ' : '├─ ');
    const relStart = formatDuration(node.startTime - traceStart);
    const durStr = node.durationMs != null ? formatDuration(node.durationMs) : '—';
    const barWidth = node.durationMs != null ? Math.max(1, Math.min(30, Math.round(node.durationMs / 1000))) : 1;
    const bar = '─'.repeat(barWidth);
    const statusColor = node.status === 'ok' ? chalk.green : chalk.red;
    const nameColor = node.type === 'delegation' ? chalk.magenta : node.type === 'skill' ? chalk.bold : chalk.white;
    const timing = chalk.gray(`[${relStart} ${bar} ${durStr}]`);
    console.log(`  ${prefix}${connector}${nameColor(node.name.padEnd(40 - prefix.length - connector.length))} ${timing} ${statusColor(node.status === 'ok' ? '✓' : '✗')}`);
    const childPrefix = node.depth === 0 ? '' : prefix + (isLast ? '   ' : '│  ');
    for (let i = 0; i < node.children.length; i++) {
      renderNode(node.children[i], childPrefix, i === node.children.length - 1);
    }
  }
  for (const root of roots) renderNode(root, '', true);
  console.log();
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.report === 'trace' && args.traceId) {
    const events = await loadAllEvents();
    reportTrace(events, args.traceId, args.format);
    return;
  }
  if (args.report === 'traces') {
    const events = args.date ? await loadEvents(args.date) : await loadAllEvents();
    reportTraces(events, args.format);
    return;
  }

  const events = await loadEvents(args.date);
  const filtered = filterEvents(events, args);
  switch (args.report) {
    case 'skills': reportSkills(filtered, args.format); break;
    case 'routing': reportRouting(filtered, args.format); break;
    case 'context': reportContext(filtered, args.format); break;
    case 'model-recs': reportModelRecommendations(filtered, args.format); break;
    default:
      console.log(chalk.red(`Unknown report type: ${args.report}`));
      console.log('Available: skills, routing, context, model-recs, traces, trace');
  }
}

main().catch(err => {
  console.error(chalk.red('Dashboard error:'), err);
  process.exit(1);
});
