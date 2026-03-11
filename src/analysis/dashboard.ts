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

async function main(): Promise<void> {
  const args = parseArgs();
  const events = await loadEvents(args.date);
  const filtered = filterEvents(events, args);
  switch (args.report) {
    case 'skills': reportSkills(filtered, args.format); break;
    case 'routing': reportRouting(filtered, args.format); break;
    case 'context': reportContext(filtered, args.format); break;
    case 'model-recs': reportModelRecommendations(filtered, args.format); break;
    default:
      console.log(chalk.red(`Unknown report type: ${args.report}`));
      console.log('Available: skills, routing, context, model-recs');
  }
}

main().catch(err => {
  console.error(chalk.red('Dashboard error:'), err);
  process.exit(1);
});
