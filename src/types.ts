export type EventType =
  | 'skill_invoked'
  | 'skill_completed'
  | 'skill_failed'
  | 'routing_decision'
  | 'context_budget_snapshot'
  | 'cascade_step'
  | 'fallback_triggered';

export interface TelemetryEvent {
  timestamp: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  eventType: EventType;
  durationMs?: number;
  success?: boolean;
  metadata: Record<string, unknown>;
}

export interface SkillInvocationEvent extends TelemetryEvent {
  eventType: 'skill_invoked' | 'skill_completed' | 'skill_failed';
  skillName: string;
  triggerReason: 'pattern_match' | 'explicit_request' | 'fallback' | 'chained';
  modelUsed?: string;
  skillComplexityHint?: 'low' | 'medium' | 'high';
  inputContextHash?: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    contextBudgetPercent: number;
  };
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
}

export interface RoutingDecisionEvent extends TelemetryEvent {
  eventType: 'routing_decision';
  candidates: Array<{
    skillName: string;
    confidenceScore: number;
    matched: boolean;
    matchReason?: string;
  }>;
  selectedSkill: string | null;
  cascadeDepth: number;
}

export interface ContextBudgetEvent extends TelemetryEvent {
  eventType: 'context_budget_snapshot';
  totalTokenBudget: number;
  usedByOrchestration: number;
  usedBySkillContext: number;
  usedByUserContent: number;
  remainingTokens: number;
}

export interface ModelRecommendation {
  skillName: string;
  currentModel: string | null;
  recommendedModel: string;
  reasoning: string;
  metrics: {
    avgTokens: number;
    avgLatencyMs: number;
    successRate: number;
    invocationCount: number;
    avgContextBudgetPercent: number;
  };
}

export interface FlagThresholds {
  maxLatencyMs?: number;
  maxTokens?: number;
  minSuccessRate?: number;
  maxContextBudgetPercent?: number;
}

export interface TelemetryExporter {
  export(event: TelemetryEvent): Promise<void>;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface TelemetryConfig {
  enabled: boolean;
  exporters: TelemetryExporter[];
  logDir: string;
  maxLogFileSizeMB: number;
  samplingRate: number;
  redactSensitiveFields: boolean;
}

export interface ModelAnalyzerConfig {
  thresholds: {
    opus: { minTokens: number; minContextPercent: number; minCascadeDepth: number };
    sonnet: { minTokens: number; maxTokens: number; minContextPercent: number; maxContextPercent: number };
    haiku: { maxTokens: number; maxContextPercent: number; minSuccessRate: number };
    gemini: { minTokens: number; maxContextPercent: number; minSuccessRate: number };
  };
}

export type ConsoleVerbosity = 'minimal' | 'normal' | 'verbose';

export interface PendingSpan {
  spanId: string;
  skillName: string;
  startTime: string;
  traceId: string;
}
