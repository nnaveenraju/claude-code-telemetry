// src/telemetry-client.ts
import { TraceContext } from './utils/trace-context.js';
import type { TelemetryConfig, TelemetryEvent } from './types.js';

const REDACT_PATTERN = /password|token|secret|key|authorization|credential/i;
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_THRESHOLD = 50;

const DEFAULT_CONFIG: TelemetryConfig = {
  enabled: true,
  exporters: [],
  logDir: '~/.claude-code-telemetry/logs',
  maxLogFileSizeMB: 50,
  samplingRate: 1.0,
  redactSensitiveFields: true,
};

export class TelemetryClient {
  private static instance: TelemetryClient | undefined;

  private config: TelemetryConfig;
  private buffer: TelemetryEvent[] = [];
  private traceContext: TraceContext;
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private flushPromise: Promise<void> | undefined;

  private readonly onBeforeExit = () => { void this.flush(); };
  private readonly onSIGINT = () => { void this.shutdown().then(() => process.exit(0)); };
  private readonly onSIGTERM = () => { void this.shutdown().then(() => process.exit(0)); };

  private constructor(config: Partial<TelemetryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.traceContext = new TraceContext();

    if (this.config.enabled) {
      this.flushTimer = setInterval(() => {
        void this.flush();
      }, FLUSH_INTERVAL_MS);
      if (this.flushTimer.unref) {
        this.flushTimer.unref();
      }

      // Graceful flush on process exit
      process.on('beforeExit', this.onBeforeExit);
      process.on('SIGINT', this.onSIGINT);
      process.on('SIGTERM', this.onSIGTERM);
    }
  }

  static init(config: Partial<TelemetryConfig> = {}): TelemetryClient {
    if (!TelemetryClient.instance) {
      TelemetryClient.instance = new TelemetryClient(config);
    }
    return TelemetryClient.instance;
  }

  static getInstance(): TelemetryClient {
    if (!TelemetryClient.instance) {
      throw new Error(
        'TelemetryClient not initialized. Call TelemetryClient.init() first.'
      );
    }
    return TelemetryClient.instance;
  }

  static reset(): void {
    if (TelemetryClient.instance) {
      if (TelemetryClient.instance.flushTimer) {
        clearInterval(TelemetryClient.instance.flushTimer);
      }
      process.removeListener('beforeExit', TelemetryClient.instance.onBeforeExit);
      process.removeListener('SIGINT', TelemetryClient.instance.onSIGINT);
      process.removeListener('SIGTERM', TelemetryClient.instance.onSIGTERM);
    }
    TelemetryClient.instance = undefined;
  }

  startTrace(): string {
    return this.traceContext.startTrace();
  }

  async endTrace(_traceId: string): Promise<void> {
    this.traceContext.endTrace();
    await this.flush();
  }

  getTraceContext(): TraceContext {
    return this.traceContext;
  }

  record(event: TelemetryEvent): void {
    if (!this.config.enabled) return;
    if (
      this.config.samplingRate < 1.0 &&
      Math.random() > this.config.samplingRate
    ) {
      return;
    }

    const processed = this.config.redactSensitiveFields
      ? this.redact(event)
      : event;
    this.buffer.push(processed);

    if (this.buffer.length >= FLUSH_THRESHOLD) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    if (this.flushPromise) {
      await this.flushPromise;
      return this.flush();
    }

    this.flushPromise = this.doFlush();
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = undefined;
    }
  }

  private async doFlush(): Promise<void> {
    const events = this.buffer.splice(0);
    try {
      for (const exporter of this.config.exporters) {
        for (const event of events) {
          await exporter.export(event);
        }
        await exporter.flush();
      }
    } catch (err) {
      console.error('[telemetry] Flush error:', err);
    }
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    await this.flush();
    for (const exporter of this.config.exporters) {
      await exporter.shutdown();
    }
  }

  private redact(event: TelemetryEvent): TelemetryEvent {
    const redactedMeta: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(event.metadata)) {
      redactedMeta[k] = REDACT_PATTERN.test(k) ? '[REDACTED]' : v;
    }
    return { ...event, metadata: redactedMeta };
  }
}
