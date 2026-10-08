import { describe, expect, it } from 'vitest';

import { ambientBudgets } from './budgets.js';
import { ambientInitRetry, ambientKeySeed } from './streams.js';

describe('ambient streams and budgets', () => {
  it('keeps two keys independent of the order they are drawn', () => {
    const first = ambientKeySeed('seed', 'life', 'npc:a', 3);
    const second = ambientKeySeed('seed', 'life', 'npc:b', 3);
    expect(ambientKeySeed('seed', 'life', 'npc:b', 3)).toBe(second);
    expect(ambientKeySeed('seed', 'life', 'npc:a', 3)).toBe(first);
    expect(first).not.toBe(second);
    expect(ambientKeySeed('seed', 'life', 'npc:a', 4)).not.toBe(first);
  });

  it('derives init retries from the init stream', () => {
    expect(ambientInitRetry('seed', 0)).not.toBe(ambientInitRetry('seed', 1));
    expect(ambientInitRetry('seed', 2)).toBe(ambientInitRetry('seed', 2));
  });

  it('scales the density table and holds the constant caps', () => {
    expect(ambientBudgets('rich').townsfolk).toBe(160);
    expect(ambientBudgets('standard').townsfolk).toBe(120);
    expect(ambientBudgets('sparse').townsfolk).toBe(80);
    expect(ambientBudgets('rich').eventStarts).toBe(2);
    expect(ambientBudgets('sparse').activeEvents).toBe(3);
    for (const density of ['sparse', 'standard', 'rich'] as const) {
      expect(ambientBudgets(density).fullTier).toBe(48);
      expect(ambientBudgets(density).promotionsPerDay).toBe(3);
      expect(ambientBudgets(density).emergentThreads).toBe(3);
    }
  });
});
