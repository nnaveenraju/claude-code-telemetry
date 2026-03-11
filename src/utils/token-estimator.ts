import { createHash } from 'node:crypto';

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(wordCount / 0.75);
}

export function computeContextHash(input: string): string {
  const truncated = input.slice(0, 500);
  return createHash('sha256').update(truncated).digest('hex');
}
