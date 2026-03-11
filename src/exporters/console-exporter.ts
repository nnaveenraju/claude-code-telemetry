// src/exporters/console-exporter.ts
import chalk from 'chalk';
import type {
  TelemetryEvent,
  TelemetryExporter,
  ConsoleVerbosity,
  SkillInvocationEvent,
  RoutingDecisionEvent,
} from '../types.js';

export class ConsoleExporter implements TelemetryExporter {
  constructor(private readonly verbosity: ConsoleVerbosity = 'normal') {}

  async export(event: TelemetryEvent): Promise<void> {
    const time = new Date(event.timestamp).toLocaleTimeString('en-US', {
      hour12: false,
    });
    const line = this.formatEvent(event, time);
    if (line) console.log(line);
  }

  private formatEvent(event: TelemetryEvent, time: string): string | null {
    const skillEvents = ['skill_completed', 'skill_failed', 'skill_invoked'];
    if (skillEvents.includes(event.eventType)) {
      return this.formatSkillEvent(event as SkillInvocationEvent, time);
    }
    if (event.eventType === 'routing_decision') {
      return this.formatRoutingEvent(event as RoutingDecisionEvent, time);
    }
    if (event.eventType === 'fallback_triggered') {
      const msg = `warning: fallback: ${event.metadata['reason'] ?? 'unknown'}`;
      return chalk.yellow(`[${time}] ${msg}`);
    }
    if (this.verbosity === 'verbose') {
      const msg = `${event.eventType}: ${JSON.stringify(event.metadata)}`;
      return chalk.gray(`[${time}] ${msg}`);
    }
    return null;
  }

  private formatSkillEvent(
    event: SkillInvocationEvent,
    time: string
  ): string {
    const model = event.modelUsed ? ` (${event.modelUsed})` : '';
    const duration = event.durationMs
      ? ` ${(event.durationMs / 1000).toFixed(1)}s`
      : '';
    const tokens = event.tokenUsage
      ? ` ${event.tokenUsage.inputTokens + event.tokenUsage.outputTokens}tok`
      : '';

    if (event.eventType === 'skill_invoked') {
      return chalk.blue(`[${time}] -> ${event.skillName}${model}`);
    }
    if (event.success === false || event.eventType === 'skill_failed') {
      const errMsg = event.error?.message ? `: ${event.error.message}` : '';
      return chalk.red(
        `[${time}] FAIL ${event.skillName}${model}${duration}${errMsg}`
      );
    }
    return chalk.green(
      `[${time}] OK ${event.skillName}${model}${duration}${tokens}`
    );
  }

  private formatRoutingEvent(
    event: RoutingDecisionEvent,
    time: string
  ): string {
    if (this.verbosity === 'minimal') {
      const msg = `route -> ${event.selectedSkill ?? 'none'} (depth: ${event.cascadeDepth})`;
      return chalk.cyan(`[${time}] ${msg}`);
    }
    const lines = [
      chalk.cyan(`[${time}] Routing decision (depth: ${event.cascadeDepth}):`),
    ];
    for (const c of event.candidates) {
      const icon = c.matched ? chalk.green('Y') : chalk.gray('.');
      const reason = c.matchReason ? ` - ${c.matchReason}` : '';
      lines.push(
        `  ${icon} ${c.skillName}: ${(c.confidenceScore * 100).toFixed(0)}%${reason}`
      );
    }
    lines.push(`  Selected: ${chalk.bold(event.selectedSkill ?? 'none')}`);
    return lines.join('\n');
  }

  async flush(): Promise<void> {
    // Console writes are immediate
  }

  async shutdown(): Promise<void> {
    // Nothing to clean up
  }
}
