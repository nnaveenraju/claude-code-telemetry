import { describe, it, expect } from 'vitest';
import { estimateTokens, computeContextHash } from '../src/utils/token-estimator.js';

describe('estimateTokens', () => {
  it('estimates tokens from word count', () => {
    const text = 'hello world foo bar'; // 4 words
    const tokens = estimateTokens(text);
    expect(tokens).toBe(Math.ceil(4 / 0.75)); // ~6
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('handles single word', () => {
    expect(estimateTokens('hello')).toBe(Math.ceil(1 / 0.75));
  });
});

describe('computeContextHash', () => {
  it('produces consistent hash for same input', () => {
    const hash1 = computeContextHash('test input');
    const hash2 = computeContextHash('test input');
    expect(hash1).toBe(hash2);
  });

  it('produces different hash for different input', () => {
    const hash1 = computeContextHash('input a');
    const hash2 = computeContextHash('input b');
    expect(hash1).not.toBe(hash2);
  });

  it('truncates to first 500 chars before hashing', () => {
    const long = 'a'.repeat(1000);
    const truncated = 'a'.repeat(500);
    expect(computeContextHash(long)).toBe(computeContextHash(truncated));
  });

  it('returns hex string', () => {
    const hash = computeContextHash('test');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
