import { v4 as uuidv4 } from 'uuid';

export class TraceContext {
  private currentTraceId: string | undefined;
  private spanStack: string[] = [];

  startTrace(): string {
    this.currentTraceId = uuidv4();
    this.spanStack = [];
    return this.currentTraceId;
  }

  endTrace(): void {
    this.currentTraceId = undefined;
    this.spanStack = [];
  }

  getCurrentTraceId(): string | undefined {
    return this.currentTraceId;
  }

  generateSpanId(): string {
    return uuidv4();
  }

  pushSpan(spanId: string): void {
    this.spanStack.push(spanId);
  }

  popSpan(): string | undefined {
    return this.spanStack.pop();
  }

  getCurrentParentSpanId(): string | undefined {
    return this.spanStack.length > 0
      ? this.spanStack[this.spanStack.length - 1]
      : undefined;
  }
}
