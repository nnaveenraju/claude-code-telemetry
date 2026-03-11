import { describe, it, expect, beforeEach } from 'vitest';
import { TraceContext } from '../src/utils/trace-context.js';

describe('TraceContext', () => {
  let ctx: TraceContext;

  beforeEach(() => {
    ctx = new TraceContext();
  });

  it('generates valid UUID trace IDs', () => {
    const traceId = ctx.startTrace();
    expect(traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('generates unique span IDs', () => {
    const span1 = ctx.generateSpanId();
    const span2 = ctx.generateSpanId();
    expect(span1).not.toBe(span2);
  });

  it('tracks current trace', () => {
    expect(ctx.getCurrentTraceId()).toBeUndefined();
    const traceId = ctx.startTrace();
    expect(ctx.getCurrentTraceId()).toBe(traceId);
    ctx.endTrace();
    expect(ctx.getCurrentTraceId()).toBeUndefined();
  });

  it('maintains parent span stack', () => {
    const parent = ctx.generateSpanId();
    ctx.pushSpan(parent);
    expect(ctx.getCurrentParentSpanId()).toBe(parent);

    const child = ctx.generateSpanId();
    ctx.pushSpan(child);
    expect(ctx.getCurrentParentSpanId()).toBe(child);

    ctx.popSpan();
    expect(ctx.getCurrentParentSpanId()).toBe(parent);

    ctx.popSpan();
    expect(ctx.getCurrentParentSpanId()).toBeUndefined();
  });

  it('handles 3-level cascade nesting', () => {
    const traceId = ctx.startTrace();
    const span1 = ctx.generateSpanId();
    ctx.pushSpan(span1);
    const span2 = ctx.generateSpanId();
    ctx.pushSpan(span2);
    const span3 = ctx.generateSpanId();
    ctx.pushSpan(span3);

    expect(ctx.getCurrentParentSpanId()).toBe(span3);
    expect(ctx.getCurrentTraceId()).toBe(traceId);

    ctx.popSpan();
    ctx.popSpan();
    ctx.popSpan();
    expect(ctx.getCurrentParentSpanId()).toBeUndefined();
  });
});
