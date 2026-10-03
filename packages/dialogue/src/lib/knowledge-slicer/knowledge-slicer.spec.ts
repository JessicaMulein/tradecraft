import fc from 'fast-check';

import {
  compilePredicateRegistry,
  type EntityBinding,
  type Namer,
  type PredicateDefinition,
  type PredicateRegistry,
} from '@tradecraft/content';
import type { EntityId, KnowledgeSlice, Proposition } from '@tradecraft/engine';

import { sliceKnowledge, type KnowledgeView } from './knowledge-slicer.js';

// ---------------------------------------------------------------------------
// Fixtures: a tiny predicate set and a namer, enough to render real sentences.
// ---------------------------------------------------------------------------

// Two entities, place + window required (the design's MEETS_AT example).
const meetsAt: PredicateDefinition = {
  id: 'MEETS_AT',
  subject: ['npc', 'unk'],
  object: { entity: ['npc', 'unk'] },
  place: 'required',
  window: 'required',
  evaluator: 'fact-match',
  fieldCode: 'MT',
  render: {
    second: 'You meet {object} at {place} {when}.',
    third: '{subject} meets {object} at {place} {when}.',
  },
  extractorHint: 'Two people meet at a place.',
};

// An org-object membership: entity object, no place or window.
const memberOf: PredicateDefinition = {
  id: 'MEMBER_OF',
  subject: ['npc'],
  object: { entity: ['org'] },
  place: 'none',
  window: 'none',
  evaluator: 'membership-transitive',
  fieldCode: 'MO',
  render: {
    second: 'You belong to {object}.',
    third: '{subject} belongs to {object}.',
  },
  extractorHint: 'A person belongs to an organisation.',
};

// A literal amount object, no place, no window.
const pays: PredicateDefinition = {
  id: 'PAYS',
  subject: ['npc'],
  object: { literal: 'amount' },
  place: 'none',
  window: 'none',
  evaluator: 'fact-match',
  fieldCode: 'PY',
  render: {
    second: 'You pay {object} schillings.',
    third: '{subject} pays {object} schillings.',
  },
  extractorHint: 'One person pays an amount.',
};

function registry(): PredicateRegistry {
  const result = compilePredicateRegistry([meetsAt, memberOf, pays]);
  if (!result.ok) throw new Error('fixture predicates failed to compile');
  return result.registry;
}

// A namer that resolves known ids to friendly display names and otherwise
// returns the local id. An EntityBinding (`{ kind, id }`) is unwrapped to its
// id first; literal / place / when strings pass straight through, matching the
// engine's predicate namer contract.
const NAMES: Record<string, string> = {
  'npc:ana': 'Ana',
  'npc:viktor': 'Viktor',
  'org:ring': 'the Ring',
  'loc:pier': 'the Pier',
};

const namer: Namer = (value: unknown): string => {
  const id =
    typeof value === 'string' ? value : (value as EntityBinding).id;
  if (NAMES[id] !== undefined) return NAMES[id];
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(colon + 1);
};

function prop(partial: Partial<Proposition> & Pick<Proposition, 'id'>): Proposition {
  return {
    subject: 'npc:ana',
    predicate: 'MEMBER_OF',
    object: 'org:ring',
    ...partial,
  };
}

const meeting: Proposition = {
  id: 'prop:meet',
  subject: 'npc:ana',
  predicate: 'MEETS_AT',
  object: 'npc:viktor',
  place: 'loc:pier',
  window: { from: { day: 2, phase: 2 } },
};

function emptySlice(overrides: Partial<KnowledgeSlice> = {}): KnowledgeSlice {
  return { known: [], falseBeliefs: [], knownEntities: [], ...overrides };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('sliceKnowledge — rendering facts', () => {
  it('renders each known Proposition as a second-person sentence', () => {
    const slice = emptySlice({
      known: [meeting, prop({ id: 'prop:member' })],
      knownEntities: ['npc:ana', 'npc:viktor', 'org:ring', 'loc:pier'],
    });

    const view = sliceKnowledge(slice, registry(), namer);

    expect(view.facts.map((f) => f.sentence)).toEqual([
      'You meet Viktor at the Pier Day 2, evening.',
      'You belong to the Ring.',
    ]);
    expect(view.facts.map((f) => f.propId)).toEqual(['prop:meet', 'prop:member']);
  });

  it('renders a literal object as its pre-formatted text', () => {
    const slice = emptySlice({
      known: [
        prop({
          id: 'prop:pay',
          predicate: 'PAYS',
          object: { kind: 'amount', value: 500 },
        }),
      ],
      knownEntities: ['npc:ana'],
    });

    const view = sliceKnowledge(slice, registry(), namer);

    expect(view.facts[0]?.sentence).toBe('You pay 500 schillings.');
  });

  it('renders false beliefs after known facts, in slice order', () => {
    const slice = emptySlice({
      known: [prop({ id: 'prop:member' })],
      falseBeliefs: [
        prop({ id: 'prop:false-a', subject: 'npc:viktor' }),
        prop({ id: 'prop:false-b', subject: 'npc:viktor' }),
      ],
      knownEntities: ['npc:ana', 'npc:viktor', 'org:ring'],
    });

    const view = sliceKnowledge(slice, registry(), namer);

    expect(view.facts.map((f) => f.propId)).toEqual([
      'prop:member',
      'prop:false-a',
      'prop:false-b',
    ]);
  });

  it('falls back to a readable line for an unknown predicate', () => {
    const slice = emptySlice({
      known: [prop({ id: 'prop:ghost', predicate: 'GHOST', object: 'org:ring' })],
      knownEntities: ['npc:ana', 'org:ring'],
    });

    const view = sliceKnowledge(slice, registry(), namer);

    expect(view.facts[0]?.sentence).toBe('Ana GHOST the Ring');
  });
});

// ---------------------------------------------------------------------------
// Known-entity list
// ---------------------------------------------------------------------------

describe('sliceKnowledge — known entities', () => {
  it('passes the known-entity list through in order, de-duplicated', () => {
    const slice = emptySlice({
      knownEntities: ['npc:ana', 'npc:viktor', 'npc:ana', 'org:ring', 'npc:viktor'],
    });

    const view = sliceKnowledge(slice, registry(), namer);

    expect(view.knownEntities).toEqual(['npc:ana', 'npc:viktor', 'org:ring']);
  });

  it('keeps an entity on the list even when its only fact is concealed', () => {
    const slice = emptySlice({
      known: [prop({ id: 'prop:member' })],
      knownEntities: ['npc:ana', 'org:ring'],
    });

    const view = sliceKnowledge(slice, registry(), namer, {
      conceal: ['prop:member'],
    });

    expect(view.facts).toEqual([]);
    expect(view.knownEntities).toEqual(['npc:ana', 'org:ring']);
  });
});

// ---------------------------------------------------------------------------
// Concealment and secret containment
// ---------------------------------------------------------------------------

describe('sliceKnowledge — concealment', () => {
  it('drops a fact whose id is in the conceal set', () => {
    const slice = emptySlice({
      known: [meeting, prop({ id: 'prop:member' })],
      knownEntities: ['npc:ana', 'npc:viktor', 'org:ring', 'loc:pier'],
    });

    const view = sliceKnowledge(slice, registry(), namer, {
      conceal: ['prop:meet'],
    });

    expect(view.facts.map((f) => f.propId)).toEqual(['prop:member']);
  });

  it('conceals a false belief too', () => {
    const slice = emptySlice({
      falseBeliefs: [prop({ id: 'prop:lie' })],
      knownEntities: ['npc:ana', 'org:ring'],
    });

    const view = sliceKnowledge(slice, registry(), namer, {
      conceal: ['prop:lie'],
    });

    expect(view.facts).toEqual([]);
  });

  it('conceals nothing by default', () => {
    const slice = emptySlice({
      known: [prop({ id: 'prop:member' })],
      knownEntities: ['npc:ana', 'org:ring'],
    });

    expect(sliceKnowledge(slice, registry(), namer).facts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Purity / determinism
// ---------------------------------------------------------------------------

describe('sliceKnowledge — determinism (Req 4.1, 5.1)', () => {
  it('is a pure function: identical inputs give identical output', () => {
    const slice = emptySlice({
      known: [meeting, prop({ id: 'prop:member' })],
      falseBeliefs: [prop({ id: 'prop:false', subject: 'npc:viktor' })],
      knownEntities: ['npc:ana', 'npc:viktor', 'org:ring', 'loc:pier'],
    });
    const reg = registry();

    const a = sliceKnowledge(slice, reg, namer);
    const b = sliceKnowledge(slice, reg, namer);

    expect(a).toEqual(b);
  });

  it('never emits a fact for a Proposition outside the slice (Req 5.1)', () => {
    const reg = registry();
    const propArb = fc
      .record({
        n: fc.integer({ min: 0, max: 50 }),
        subject: fc.constantFrom<EntityId>('npc:ana', 'npc:viktor'),
      })
      .map(({ n, subject }) =>
        prop({ id: `prop:${n}`, subject, predicate: 'MEMBER_OF' }),
      );

    fc.assert(
      fc.property(
        fc.uniqueArray(propArb, { selector: (p) => p.id, maxLength: 8 }),
        fc.uniqueArray(propArb, { selector: (p) => p.id, maxLength: 8 }),
        (known, falseBeliefs) => {
          const sliceIds = new Set<string>(
            [...known, ...falseBeliefs].map((p) => p.id),
          );
          const slice = emptySlice({
            known,
            falseBeliefs,
            knownEntities: ['npc:ana', 'npc:viktor', 'org:ring'],
          });

          const view: KnowledgeView = sliceKnowledge(slice, reg, namer);

          // Every rendered fact traces back to a Proposition in the slice.
          for (const fact of view.facts) {
            expect(sliceIds.has(fact.propId)).toBe(true);
          }
        },
      ),
    );
  });
});
