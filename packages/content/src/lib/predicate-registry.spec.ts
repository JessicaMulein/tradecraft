import { describe, expect, it } from 'vitest';

import {
  compilePredicateRegistry,
  type EntityBinding,
  type Namer,
  type PredicateDefinition,
  type RenderBindings,
} from '../index.js';

// A namer that spells an entity binding as "<kind>:<id>" so tests can assert
// exactly which binding reached a slot and in which perspective. A literal
// object (and the place/when strings) arrive already stringified, so a plain
// string is returned as-is.
const taggingNamer: Namer = (value: unknown) => {
  if (typeof value === 'string') return value;
  const b = value as EntityBinding;
  return `${b.kind}:${b.id}`;
};

// MEETS_AT from the design example: two entities, place + window required.
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

// PAYS: a literal amount object, no place, optional window with an optional
// section — exercises literal objects and {?when}…{/when}.
const pays: PredicateDefinition = {
  id: 'PAYS',
  subject: ['npc'],
  object: { literal: 'amount' },
  place: 'none',
  window: 'optional',
  evaluator: 'fact-match',
  fieldCode: 'PY',
  render: {
    second: 'You pay {object}{?when} {when}{/when}.',
    third: '{subject} pays {object}{?when} {when}{/when}.',
  },
  extractorHint: 'One person pays an amount.',
};

const meetsBindings: RenderBindings = {
  subject: { kind: 'npc', id: 'alpha' },
  object: { kind: 'unk', id: '7' },
  place: 'the Kaffeehaus',
  when: 'on Tuesday',
};

describe('compilePredicateRegistry', () => {
  it('compiles a valid set and exposes lookups', () => {
    const result = compilePredicateRegistry([meetsAt, pays]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reg = result.registry;

    expect(reg.predicates.map((p) => p.id)).toEqual(['MEETS_AT', 'PAYS']);
    expect(reg.has('MEETS_AT')).toBe(true);
    expect(reg.has('NOPE')).toBe(false);
    expect(reg.get('PAYS')?.fieldCode).toBe('PY');
  });

  it('derives the field-code map for the Cipher Engine', () => {
    const result = compilePredicateRegistry([meetsAt, pays]);
    if (!result.ok) throw new Error('expected ok');
    expect([...result.registry.fieldCodes]).toEqual([
      ['MEETS_AT', 'MT'],
      ['PAYS', 'PY'],
    ]);
  });

  it('derives the evaluator-dispatch map for the Truth Store', () => {
    const alias: PredicateDefinition = {
      ...meetsAt,
      id: 'IS_ALIAS_OF',
      fieldCode: 'AL',
      evaluator: 'alias',
    };
    const result = compilePredicateRegistry([meetsAt, alias]);
    if (!result.ok) throw new Error('expected ok');
    expect(result.registry.evaluators.get('MEETS_AT')).toBe('fact-match');
    expect(result.registry.evaluators.get('IS_ALIAS_OF')).toBe('alias');
  });
});

describe('renderers', () => {
  it('renders second and third person through the namer', () => {
    const result = compilePredicateRegistry([meetsAt]);
    if (!result.ok) throw new Error('expected ok');
    const reg = result.registry;

    expect(reg.render('MEETS_AT', 'second', meetsBindings, taggingNamer)).toBe(
      'You meet unk:7 at the Kaffeehaus on Tuesday.',
    );
    expect(reg.render('MEETS_AT', 'third', meetsBindings, taggingNamer)).toBe(
      'npc:alpha meets unk:7 at the Kaffeehaus on Tuesday.',
    );
  });

  it('renders a literal object as pre-formatted text, not through the namer', () => {
    const result = compilePredicateRegistry([pays]);
    if (!result.ok) throw new Error('expected ok');
    const out = result.registry.render(
      'PAYS',
      'third',
      {
        subject: { kind: 'npc', id: 'alpha' },
        object: { literal: '500 schillings' },
        when: 'last Friday',
      },
      taggingNamer,
    );
    expect(out).toBe('npc:alpha pays 500 schillings last Friday.');
  });

  it('drops an optional section when its slot is absent', () => {
    const result = compilePredicateRegistry([pays]);
    if (!result.ok) throw new Error('expected ok');
    const out = result.registry.render(
      'PAYS',
      'third',
      { subject: { kind: 'npc', id: 'alpha' }, object: { literal: '£5' } },
      taggingNamer,
    );
    expect(out).toBe('npc:alpha pays £5.');
  });

  it('is deterministic: the same inputs render the same string', () => {
    const result = compilePredicateRegistry([meetsAt]);
    if (!result.ok) throw new Error('expected ok');
    const once = result.registry.render(
      'MEETS_AT',
      'third',
      meetsBindings,
      taggingNamer,
    );
    const twice = result.registry.render(
      'MEETS_AT',
      'third',
      meetsBindings,
      taggingNamer,
    );
    expect(once).toBe(twice);
  });

  it('throws when rendering an unknown predicate id', () => {
    const result = compilePredicateRegistry([meetsAt]);
    if (!result.ok) throw new Error('expected ok');
    expect(() =>
      result.registry.render('GHOST', 'second', meetsBindings, taggingNamer),
    ).toThrow(/GHOST/);
  });
});

describe('error collection', () => {
  it('reports a duplicate field code against the first owner', () => {
    const clash: PredicateDefinition = { ...pays, id: 'TIPS', fieldCode: 'MT' };
    const result = compilePredicateRegistry([meetsAt, clash]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe('[1].fieldCode');
    expect(result.errors[0].message).toContain('MEETS_AT');
    expect(result.errors[0].file).toBe('predicates.yaml');
  });

  it('reports a duplicate predicate id', () => {
    const result = compilePredicateRegistry([meetsAt, { ...meetsAt, fieldCode: 'M2' }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path === '[1].id')).toBe(true);
  });

  it('reports a template that uses a slot the predicate does not provide', () => {
    const noPlace: PredicateDefinition = {
      ...pays,
      id: 'GREETS',
      fieldCode: 'GR',
      render: {
        second: 'You greet {object} at {place}.',
        third: '{subject} greets {object} at {place}.',
      },
    };
    const result = compilePredicateRegistry([noPlace]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // place is 'none', so both templates referencing {place} are errors.
    expect(result.errors).toHaveLength(2);
    expect(result.errors.every((e) => e.message.includes('place'))).toBe(true);
    expect(
      result.errors.map((e) => e.path).sort(),
    ).toEqual(['[0].render.second', '[0].render.third']);
  });

  it('reports a template that references a slot outside the predicate vocabulary', () => {
    const bad: PredicateDefinition = {
      ...meetsAt,
      id: 'ODD',
      fieldCode: 'OD',
      render: {
        second: 'You {verb} {object} at {place} {when}.',
        third: '{subject} meets {object} at {place} {when}.',
      },
    };
    const result = compilePredicateRegistry([bad]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('verb'))).toBe(true);
    expect(result.errors.some((e) => e.path === '[0].render.second')).toBe(true);
  });

  it('reports an unterminated optional section', () => {
    const bad: PredicateDefinition = {
      ...pays,
      id: 'OWES',
      fieldCode: 'OW',
      render: {
        second: 'You owe {object}{?when} {when}.',
        third: '{subject} owes {object}.',
      },
    };
    const result = compilePredicateRegistry([bad]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path === '[0].render.second')).toBe(true);
  });

  it('collects every error across the set rather than stopping at the first', () => {
    const a: PredicateDefinition = { ...meetsAt, id: 'A', fieldCode: 'XX' };
    const b: PredicateDefinition = { ...pays, id: 'B', fieldCode: 'XX' };
    const c: PredicateDefinition = {
      ...pays,
      id: 'C',
      fieldCode: 'CC',
      render: { second: 'You pay {object} at {place}.', third: '{subject} pays {object}.' },
    };
    const result = compilePredicateRegistry([a, b, c]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // one field-code clash on B, one bad {place} slot on C's second template.
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors.some((e) => e.path === '[1].fieldCode')).toBe(true);
    expect(result.errors.some((e) => e.path === '[2].render.second')).toBe(true);
  });

  it('honours a custom file name in error paths', () => {
    const clash: PredicateDefinition = { ...pays, id: 'TIPS', fieldCode: 'MT' };
    const result = compilePredicateRegistry([meetsAt, clash], 'core/predicates.yaml');
    if (result.ok) throw new Error('expected failure');
    expect(result.errors[0].file).toBe('core/predicates.yaml');
  });
});
