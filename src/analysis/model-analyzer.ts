import type {
  SkillInvocationEvent,
  ModelRecommendation,
  ModelAnalyzerConfig,
} from '../types.js';

interface SkillMetrics {
  avgTokens: number;
  avgLatencyMs: number;
  successRate: number;
  invocationCount: number;
  avgContextBudgetPercent: number;
  complexityHints: Map<string, number>;
}

type ModelScore = { model: string; score: number };

export class ModelAnalyzer {
  private readonly config: ModelAnalyzerConfig;

  constructor(
    private readonly events: SkillInvocationEvent[],
    config?: ModelAnalyzerConfig
  ) {
    this.config = config ?? ModelAnalyzer.defaultConfig();
  }

  private static defaultConfig(): ModelAnalyzerConfig {
    return {
      thresholds: {
        opus:   { minTokens: 5000, minContextPercent: 30, minCascadeDepth: 2 },
        sonnet: { minTokens: 1000, maxTokens: 5000, minContextPercent: 10, maxContextPercent: 30 },
        haiku:  { maxTokens: 1000, maxContextPercent: 10, minSuccessRate: 0.98 },
        gemini: { minTokens: 3000, maxContextPercent: 40, minSuccessRate: 0.95 },
      },
    };
  }

  analyze(): ModelRecommendation[] {
    const metricsMap = this.computeMetrics();
    const recommendations: ModelRecommendation[] = [];
    for (const [skillName, metrics] of metricsMap) {
      recommendations.push(this.buildRecommendation(skillName, metrics));
    }
    return recommendations;
  }

  private buildRecommendation(skillName: string, metrics: SkillMetrics): ModelRecommendation {
    const scores = this.scoreModels(metrics);
    const conflicting = scores.length >= 2 && scores[0].score - scores[1].score < 0.5;
    const reasoning = conflicting
      ? `Conflicting signals - needs investigation. Top candidates: ${scores[0].model} (${scores[0].score.toFixed(1)}), ${scores[1].model} (${scores[1].score.toFixed(1)})`
      : `${scores[0].model} recommended: avg ${metrics.avgTokens} tokens, ${(metrics.successRate * 100).toFixed(0)}% success, ${metrics.avgContextBudgetPercent.toFixed(0)}% context budget.`;
    return {
      skillName,
      currentModel: this.getCurrentModel(skillName),
      recommendedModel: scores[0].model,
      reasoning,
      metrics: {
        avgTokens: metrics.avgTokens,
        avgLatencyMs: metrics.avgLatencyMs,
        successRate: metrics.successRate,
        invocationCount: metrics.invocationCount,
        avgContextBudgetPercent: metrics.avgContextBudgetPercent,
      },
    };
  }

  private computeMetrics(): Map<string, SkillMetrics> {
    const bySkill = new Map<string, SkillInvocationEvent[]>();
    for (const event of this.events) {
      if (event.eventType !== 'skill_completed' && event.eventType !== 'skill_failed') continue;
      const bucket = bySkill.get(event.skillName) ?? [];
      bucket.push(event);
      bySkill.set(event.skillName, bucket);
    }
    const result = new Map<string, SkillMetrics>();
    for (const [skill, evts] of bySkill) {
      result.set(skill, this.aggregateEvents(evts));
    }
    return result;
  }

  private aggregateEvents(evts: SkillInvocationEvent[]): SkillMetrics {
    const n = evts.length;
    const successes = evts.filter(e => e.success !== false).length;
    const totalTokens = evts.reduce((s, e) => s + (e.tokenUsage ? e.tokenUsage.inputTokens + e.tokenUsage.outputTokens : 0), 0);
    const totalLatency = evts.reduce((s, e) => s + (e.durationMs ?? 0), 0);
    const totalBudget = evts.reduce((s, e) => s + (e.tokenUsage?.contextBudgetPercent ?? 0), 0);
    const hints = new Map<string, number>();
    for (const e of evts) {
      if (e.skillComplexityHint) {
        hints.set(e.skillComplexityHint, (hints.get(e.skillComplexityHint) ?? 0) + 1);
      }
    }
    return {
      avgTokens: Math.round(totalTokens / n),
      avgLatencyMs: Math.round(totalLatency / n),
      successRate: successes / n,
      invocationCount: n,
      avgContextBudgetPercent: totalBudget / n,
      complexityHints: hints,
    };
  }

  private scoreModels(metrics: SkillMetrics): ModelScore[] {
    const t = this.config.thresholds;
    return [
      { model: 'opus',   score: this.scoreOpus(metrics, t.opus) },
      { model: 'sonnet', score: this.scoreSonnet(metrics, t.sonnet) },
      { model: 'haiku',  score: this.scoreHaiku(metrics, t.haiku) },
      { model: 'gemini', score: this.scoreGemini(metrics, t.gemini) },
    ].sort((a, b) => b.score - a.score);
  }

  private scoreOpus(m: SkillMetrics, t: ModelAnalyzerConfig['thresholds']['opus']): number {
    let s = 0;
    if (m.avgTokens >= t.minTokens) s += 2;
    if (m.avgContextBudgetPercent >= t.minContextPercent) s += 2;
    if (m.successRate < 0.9) s += 1;
    if (m.complexityHints.get('high')) s += 2;
    return s;
  }

  private scoreSonnet(m: SkillMetrics, t: ModelAnalyzerConfig['thresholds']['sonnet']): number {
    let s = 0;
    if (m.avgTokens >= t.minTokens && m.avgTokens <= t.maxTokens) s += 2;
    if (m.avgContextBudgetPercent >= t.minContextPercent && m.avgContextBudgetPercent <= t.maxContextPercent) s += 2;
    if (m.successRate >= 0.9 && m.successRate <= 0.98) s += 1;
    if (m.complexityHints.get('medium')) s += 1;
    return s;
  }

  private scoreHaiku(m: SkillMetrics, t: ModelAnalyzerConfig['thresholds']['haiku']): number {
    let s = 0;
    if (m.avgTokens <= t.maxTokens) s += 2;
    if (m.avgContextBudgetPercent <= t.maxContextPercent) s += 2;
    if (m.successRate >= t.minSuccessRate) s += 2;
    if (m.complexityHints.get('low')) s += 1;
    return s;
  }

  private scoreGemini(m: SkillMetrics, t: ModelAnalyzerConfig['thresholds']['gemini']): number {
    let s = 0;
    if (m.avgTokens >= t.minTokens) s += 1;
    if (m.avgContextBudgetPercent >= t.maxContextPercent) s += 2;
    if (m.successRate >= t.minSuccessRate) s += 1;
    if (m.complexityHints.get('low') || m.complexityHints.get('medium')) s += 1;
    return s;
  }

  private getCurrentModel(skillName: string): string | null {
    return this.events.find(e => e.skillName === skillName && e.modelUsed)?.modelUsed ?? null;
  }
}
