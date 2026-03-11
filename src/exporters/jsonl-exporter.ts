// src/exporters/jsonl-exporter.ts
import { appendFile, stat, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { TelemetryEvent, TelemetryExporter } from '../types.js';

export class JsonlExporter implements TelemetryExporter {
  private buffer: string[] = [];
  private flushing = false;
  private currentFile: string;
  private readonly maxBytes: number;

  constructor(
    private readonly logDir: string,
    maxLogFileSizeMB: number
  ) {
    this.maxBytes = maxLogFileSizeMB * 1024 * 1024;
    this.currentFile = this.buildFilename();
  }

  private buildFilename(): string {
    const date = new Date().toISOString().slice(0, 10);
    return join(this.logDir, `telemetry-${date}.jsonl`);
  }

  private buildRotatedFilename(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toISOString().slice(11, 19).replace(/:/g, '');
    return join(this.logDir, `telemetry-${date}-${time}.jsonl`);
  }

  async export(event: TelemetryEvent): Promise<void> {
    try {
      const line = JSON.stringify(event) + '\n';
      this.buffer.push(line);
    } catch (err) {
      console.error('[telemetry] Failed to serialize event:', err);
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;

    const lines = this.buffer.splice(0);

    try {
      await mkdir(this.logDir, { recursive: true });
      for (const line of lines) {
        await this.rotateIfNeeded();
        await appendFile(this.currentFile, line, 'utf-8');
      }
    } catch (err) {
      console.error('[telemetry] Failed to write JSONL:', err);
    } finally {
      this.flushing = false;
    }
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const fileStat = await stat(this.currentFile);
      if (fileStat.size >= this.maxBytes) {
        const rotated = this.buildRotatedFilename();
        await rename(this.currentFile, rotated);
        this.currentFile = this.buildFilename();
      }
    } catch {
      // File does not exist yet - no rotation needed
    }
  }

  async shutdown(): Promise<void> {
    await this.flush();
  }
}
