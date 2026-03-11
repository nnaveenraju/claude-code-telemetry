import { describe, it, expect } from 'vitest';
import { ModelAnalyzer } from '../src/analysis/model-analyzer.js';
import type { SkillInvocationEvent } from '../src/types.js';

function makeCompleted(
  overrides: Partial<SkillInvocationEvent>
): SkillInvocationEvent {
  return {
    timestamp: new Date().toISOString(),
    traceId: 't1',
    spanId: 's1',
    eventType: 'skill_completed',
    success: true,
    skillName: 'test-skill',
    triggerReason: 'explicit_request',
    metadata: {},
    ...overrides,
  };
}

describe('ModelAnalyzer', () => {
  it('recommends haiku for low-token high-success skills', () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      makeCompleted({
        spanId: `s${i}`,
        skillName: 'commit-craft',
        durationMs: 800,
        modelUsed: 'opus',
        tokenUsage: { inputTokens: 200, outputTokens: 300, contextBudgetPercent: 3 },
      })
    );

    const analyzer = new ModelAnalyzer(events);
    const recs = analyzer.analyze();
    const rec = recs.find(r => r.skillName === 'commit-craft');

    expect(rec).toBeDefined();
    expect(rec!.recommendedModel).toBe('haiku');
  });

  it('recommends opus for high-token complex skills', () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      makeCompleted({
        spanId: `s${i}`,
        skillName: 'architect',
        durationMs: 15000,
        modelUsed: 'opus',
        skillComplexityHint: 'high',
        tokenUsage: { inputTokens: 4000, outputTokens: 5000, contextBudgetPercent: 40 },
      })
    );

    const analyzer = new ModelAnalyzer(events);
    const recs = analyzer.analyze();
    const rec = recs.find(r => r.skillName === 'architect');

    expect(rec).toBeDefined();
    expect(rec!.recommendedModel).toBe('opus');
  });

  it('flags conflicting signals as needs-investigation', () => {
    // avgTokens=6000, contextBudget=42% → opus scores 4 (tokens+context), gemini scores 4 (tokens+context+successRate)
    const events = Array.from({ length: 10 }, (_, i) =>
      makeCompleted({
        spanId: `s${i}`,
        skillName: 'ambiguous-skill',
        durationMs: 5000,
        tokenUsage: { inputTokens: 3000, outputTokens: 3000, contextBudgetPercent: 42 },
      })
    );

    const analyzer = new ModelAnalyzer(events);
    const recs = analyzer.analyze();
    const rec = recs.find(r => r.skillName === 'ambiguous-skill');

    expect(rec).toBeDefined();
    expect(rec!.reasoning).toContain('investigation');
  });

  it('returns empty array for empty dataset', () => {
    const analyzer = new ModelAnalyzer([]);
    expect(analyzer.analyze()).toEqual([]);
  });

  it('respects custom thresholds', () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      makeCompleted({
        spanId: `s${i}`,
        skillName: 'custom-skill',
        durationMs: 2000,
        tokenUsage: { inputTokens: 500, outputTokens: 400, contextBudgetPercent: 8 },
      })
    );

    const analyzer = new ModelAnalyzer(events, {
      thresholds: {
        opus: { minTokens: 100, minContextPercent: 5, minCascadeDepth: 0 },
        sonnet: { minTokens: 50, maxTokens: 99, minContextPercent: 2, maxContextPercent: 4 },
        haiku: { maxTokens: 49, maxContextPercent: 1, minSuccessRate: 0.99 },
        gemini: { minTokens: 2000, maxContextPercent: 50, minSuccessRate: 0.95 },
      },
    });
    const recs = analyzer.analyze();
    const rec = recs.find(r => r.skillName === 'custom-skill');
    expect(rec).toBeDefined();
    expect(rec!.recommendedModel).toBe('opus');
  });
});
