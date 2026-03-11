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
  private flushing = false;

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
      process.on('beforeExit', () => { void this.flush(); });
      process.on('SIGINT', () => { void this.shutdown().then(() => process.exit(0)); });
      process.on('SIGTERM', () => { void this.shutdown().then(() => process.exit(0)); });
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
    if (TelemetryClient.instance?.flushTimer) {
      clearInterval(TelemetryClient.instance.flushTimer);
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
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;

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
    } finally {
      this.flushing = false;
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
