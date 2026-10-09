import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { borderCheck, BORDER_OUTCOME_RANK, type BorderOutcome } from './check.js';
import { createPrng, type Prng } from '../prng/prng.js';
import { asTruth } from '../model/core.js';

const at = { day: 1, phase: 0 as const };
const rules = {
  detentionPhases: 2,
  contrabandCashThreshold: 40,
  papersDelay: 1,
  papersCost: 10,
  watchListSensitivity: 0.5,
};

function draws(...values: number[]): Prng {
  let index = 0;
  return { next: () => values[index++] ?? 0 } as Prng;
}

function passport(quality: number) {
  return {
    id: 'paper:passport' as const,
    kind: 'passport',
    holder: 'player' as const,
    quality: asTruth(quality),
    issuedBy: { kind: 'station' as const, id: 'station' },
  };
}

describe('border check', () => {
  it('detains a watched identity and refuses a missing paper otherwise', () => {
    const missing = borderCheck(
      {
        post: { id: 'post:line', name: 'the line', strictness: 0.2, documents: ['passport'] },
        at,
        traveller: { identity: 'player' },
        papers: [],
        items: [],
        watch: { persons: [], descriptors: [] },
        rules,
      },
      createPrng('unused'),
    );
    expect(missing.outcome).toBe('refused');

    const held = borderCheck(
      {
        post: { id: 'post:line', name: 'the line', strictness: 0.2, documents: ['passport'] },
        at,
        traveller: { identity: 'npc:courier' },
        papers: [],
        items: [],
        watch: { persons: ['npc:courier'], descriptors: [] },
        rules,
      },
      createPrng('unused'),
    );
    expect(held.outcome).toBe('detained');
    expect(held.phasesAdded).toBe(2);
  });

  it('seizes a radio when the second look finds it', () => {
    const checked = borderCheck(
      {
        post: { id: 'post:line', name: 'the line', strictness: 1, documents: ['passport'] },
        at,
        traveller: { identity: 'player', coverFits: true },
        papers: [passport(0.5)],
        items: [{ id: 'item:set', kind: 'radio' }],
        watch: { persons: [], descriptors: [] },
        rules,
      },
      draws(0.3, 0.1),
    );
    expect(checked.outcome).toBe('seizure');
  });

  it('checks a sector line with the same rules as a border post', () => {
    const checked = borderCheck(
      {
        post: { id: 'line:north', name: 'the north sector line', strictness: 0.9, documents: ['laissez-passer'] },
        at,
        traveller: { identity: 'player' },
        papers: [passport(0.9)],
        items: [],
        watch: { persons: [], descriptors: [] },
        rules,
      },
      createPrng('sector'),
    );
    expect(checked.outcome).toBe('refused');
  });
});

describe('border check properties', () => {
  it('Property 9: Border Check determinism and monotonicity', () => {
    // Feature: multi-city, Property 9: Border Check determinism and monotonicity
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.double({ min: 0, max: 0.8, noNaN: true }),
        fc.double({ min: 0.05, max: 0.2, noNaN: true }),
        (seed, quality, step) => {
          const input = {
            post: { id: 'post:line', name: 'the line', strictness: 0.6, documents: ['passport'] },
            at,
            traveller: { identity: 'player', coverFits: true },
            items: [] as const,
            watch: { persons: [] as const, descriptors: [] as const },
            rules,
          };
          const lower = borderCheck(
            { ...input, papers: [passport(quality)] },
            createPrng(seed),
          );
          const again = borderCheck(
            { ...input, papers: [passport(quality)] },
            createPrng(seed),
          );
          const higher = borderCheck(
            { ...input, papers: [passport(Math.min(1, quality + step))] },
            createPrng(seed),
          );
          expect(again.outcome).toBe(lower.outcome);
          const worse =
            BORDER_OUTCOME_RANK[higher.outcome as BorderOutcome] >
            BORDER_OUTCOME_RANK[lower.outcome];
          expect(worse).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
