/**
 * Property 16: ambient prompt containment and budget.
 * Validates Requirements 12.5, 21.1, 21.2, 21.3.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { compilePredicateRegistry, type Namer, type PredicateDefinition, type PredicateRegistry } from '@tradecraft/content';
import type { EntityId, Proposition } from '@tradecraft/engine';

import {
  AMBIENT_FACT_CAP,
  AMBIENT_TOKEN_CAP,
  buildPrompt,
  estimateTokens,
  type PromptInput,
} from './prompt-builder.js';

const status: PredicateDefinition = {
  id: 'HAS_STATUS',
  subject: ['npc'],
  object: { literal: 'text' },
  place: 'none',
  window: 'none',
  evaluator: 'fact-match',
  fieldCode: 'HS',
  render: { second: 'You are {object}.', third: '{subject} is {object}.' },
  extractorHint: 'A person has a status.',
};

function registry(): PredicateRegistry {
  const result = compilePredicateRegistry([status]);
  if (!result.ok) {
    throw new Error('fixture predicates failed to compile');
  }
  return result.registry;
}

const namer: Namer = (value: unknown): string => {
  const id = typeof value === 'string' ? value : (value as { id: string }).id;
  if (id === 'npc:hidden') {
    return 'Viktor';
  }
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(colon + 1);
};

function proposition(id: string, value: string): Proposition {
  return {
    id,
    subject: 'npc:ana',
    predicate: 'HAS_STATUS',
    object: { kind: 'text', value },
  };
}

function input(ambient: PromptInput['ambient'], playerLine: string): PromptInput {
  return {
    predicates: registry(),
    namer,
    persona: { name: 'Ana', background: '', voiceTraits: [], mannerisms: [] },
    knowledge: { known: [], falseBeliefs: [], knownEntities: ['npc:ana'] },
    toldList: [],
    recentTurns: [],
    playerLine,
    ...(ambient === undefined ? {} : { ambient }),
  };
}

function knowledgeBlock(text: string): string {
  const start = text.indexOf('# What you know');
  const end = text.indexOf('# Already said');
  return text.slice(start, end);
}

function ambientSections(text: string): string {
  const parts: string[] = [];
  const city = text.indexOf('# The city as you know it');
  const already = text.indexOf('# Already said');
  if (city >= 0 && already > city) {
    parts.push(text.slice(city, already));
  }
  const memory = text.indexOf('# What you remember');
  const recent = text.indexOf('# Recent conversation');
  if (memory >= 0 && recent > memory) {
    parts.push(text.slice(memory, recent));
  }
  return parts.join('\n');
}

describe('Property 16: Ambient prompt containment and budget', () => {
  // Feature: ambient-world, Property 16: Ambient prompt containment and budget
  it('renders only held facts, names an unknown person by descriptor, and stays within 400 tokens', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z]{3,8}$/), { minLength: 1, maxLength: 12 }),
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.string({ minLength: 1, maxLength: 24 }),
        (words, lineA, lineB) => {
          const held = words.map((word, index) => ({
            proposition: proposition(`prop:${word}`, word),
            salience: index / words.length,
          }));
          const ambient = {
            facts: held,
            recollections: [
              {
                text: 'You remember seeing you with a porter at the cafe.',
                salience: 0.9,
                entities: ['loc:cafe' as EntityId],
              },
            ],
          };
          const first = buildPrompt(input(ambient, lineA));
          const second = buildPrompt(input(ambient, lineB));
          expect(knowledgeBlock(first.text)).toBe(knowledgeBlock(second.text));
          expect(estimateTokens(ambientSections(first.text))).toBeLessThanOrEqual(AMBIENT_TOKEN_CAP);
          const city = first.text.slice(
            first.text.indexOf('# The city as you know it'),
            first.text.indexOf('# Already said'),
          );
          const mentioned = [...city.matchAll(/- You are ([a-z]+)\./g)].map((match) => match[1] ?? '');
          expect(mentioned.length).toBeGreaterThan(0);
          expect(mentioned.length).toBeLessThanOrEqual(AMBIENT_FACT_CAP);
          for (const word of mentioned) {
            expect(words).toContain(word);
          }
          expect(first.text).toContain('a porter');
          expect(first.text).not.toContain('Viktor');
          expect(first.knownEntities).toContain('loc:cafe');
          expect(first.knownEntities).not.toContain('npc:hidden');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('leaves block 3 unchanged when ambient is absent', () => {
    const quiet = buildPrompt(input(undefined, 'Hello.'));
    expect(quiet.text).not.toContain('# The city as you know it');
    expect(quiet.text).not.toContain('# What you remember');
  });
});
