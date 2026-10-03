/**
 * Unit tests for the pure Case File browser reducer (task 22.4; design, "Case
 * File"; Requirements 8.1, 13.3). These exercise the Claim cursor, the filter
 * axis/value cycling (which produces the `CaseFileFilter` the screen applies),
 * the Admiralty Grade composition and the link anchor without a TTY — the
 * component tests then confirm the Ink layer wires keys to these.
 */

import { describe, expect, it } from 'vitest';
import {
  ADMIRALTY_CREDIBILITY,
  CLAIM_SOURCE_KINDS,
  formatGrade,
  initialCaseFileState,
  reduceCaseFile,
  type CaseFileState,
  type EntityId,
} from './case-file.js';

const ENTITIES: readonly EntityId[] = ['npc:viktor', 'loc:cafe', 'org:station'];

describe('initialCaseFileState', () => {
  it('starts on the first Claim, source axis, no filter, grade A1, no link anchor', () => {
    expect(initialCaseFileState({ count: 3 })).toEqual<CaseFileState>({
      cursor: 0,
      count: 3,
      axis: 'source',
      filter: {},
      grade: { reliability: 'A', credibility: 1 },
      linkAnchor: undefined,
    });
  });

  it('can open pre-filtered', () => {
    const s = initialCaseFileState({ count: 1, filter: { source: 'intercept' } });
    expect(s.filter).toEqual({ source: 'intercept' });
  });
});

describe('reduceCaseFile cursor movement', () => {
  it('walks the shown list and clamps at both ends (no wrap)', () => {
    let s = initialCaseFileState({ count: 2 });
    s = reduceCaseFile(s, { type: 'cursor-next' });
    expect(s.cursor).toBe(1);
    s = reduceCaseFile(s, { type: 'cursor-next' });
    expect(s.cursor).toBe(1); // clamped at the last Claim
    s = reduceCaseFile(s, { type: 'cursor-prev' });
    s = reduceCaseFile(s, { type: 'cursor-prev' });
    expect(s.cursor).toBe(0); // clamped at the first Claim
  });

  it('keeps the cursor at 0 for an empty list', () => {
    const s = reduceCaseFile(initialCaseFileState({ count: 0 }), {
      type: 'cursor-next',
    });
    expect(s.cursor).toBe(0);
  });

  it('re-clamps the cursor when the shown count shrinks after re-filtering', () => {
    let s = initialCaseFileState({ count: 5 });
    s = reduceCaseFile(s, { type: 'cursor-next' });
    s = reduceCaseFile(s, { type: 'cursor-next' });
    s = reduceCaseFile(s, { type: 'cursor-next' }); // cursor 3
    expect(s.cursor).toBe(3);
    s = reduceCaseFile(s, { type: 'set-count', count: 2 });
    expect(s.count).toBe(2);
    expect(s.cursor).toBe(1);
  });
});

describe('reduceCaseFile filter axis focus', () => {
  it('walks source → grade → entity and wraps', () => {
    let s = initialCaseFileState();
    expect(s.axis).toBe('source');
    s = reduceCaseFile(s, { type: 'axis-next' });
    expect(s.axis).toBe('grade');
    s = reduceCaseFile(s, { type: 'axis-next' });
    expect(s.axis).toBe('entity');
    s = reduceCaseFile(s, { type: 'axis-next' });
    expect(s.axis).toBe('source');
  });

  it('walks backward and wraps', () => {
    const s = reduceCaseFile(initialCaseFileState(), { type: 'axis-prev' });
    expect(s.axis).toBe('entity');
  });
});

describe('reduceCaseFile source filter (Req 13.3)', () => {
  it('cycles the source axis through all → each kind → all', () => {
    let s = initialCaseFileState();
    const seen: (string | undefined)[] = [s.filter.source];
    for (let i = 0; i <= CLAIM_SOURCE_KINDS.length; i++) {
      s = reduceCaseFile(s, { type: 'filter-next' });
      seen.push(s.filter.source);
    }
    expect(seen).toEqual([
      undefined,
      'npc',
      'intercept',
      'surveillance',
      'document',
      undefined,
    ]);
  });

  it('cycles the source axis backward from all to the last kind', () => {
    const s = reduceCaseFile(initialCaseFileState(), { type: 'filter-prev' });
    expect(s.filter.source).toBe('document');
  });

  it('omits the source key entirely when back on "all"', () => {
    let s = reduceCaseFile(initialCaseFileState(), { type: 'filter-next' });
    expect('source' in s.filter).toBe(true);
    s = reduceCaseFile(s, { type: 'filter-prev' });
    expect('source' in s.filter).toBe(false);
  });
});

describe('reduceCaseFile grade filter (Req 13.3)', () => {
  it('cycles the grade axis from all to the first grade A1 and back to all', () => {
    let s = reduceCaseFile(initialCaseFileState(), { type: 'axis-next' }); // grade axis
    expect(s.filter.grade).toBeUndefined();
    s = reduceCaseFile(s, { type: 'filter-next' });
    expect(s.filter.grade).toEqual({ reliability: 'A', credibility: 1 });
    s = reduceCaseFile(s, { type: 'filter-prev' });
    expect(s.filter.grade).toBeUndefined();
  });
});

describe('reduceCaseFile entity filter (Req 13.3)', () => {
  it('cycles the entity axis through the supplied entities and wraps via all', () => {
    let s = reduceCaseFile(initialCaseFileState(), { type: 'axis-next' });
    s = reduceCaseFile(s, { type: 'axis-next' }); // entity axis
    s = reduceCaseFile(s, { type: 'filter-next', entities: ENTITIES });
    expect(s.filter.entity).toBe('npc:viktor');
    s = reduceCaseFile(s, { type: 'filter-next', entities: ENTITIES });
    expect(s.filter.entity).toBe('loc:cafe');
    s = reduceCaseFile(s, { type: 'filter-next', entities: ENTITIES });
    expect(s.filter.entity).toBe('org:station');
    s = reduceCaseFile(s, { type: 'filter-next', entities: ENTITIES });
    expect(s.filter.entity).toBeUndefined();
  });
});

describe('reduceCaseFile combined filter and clear', () => {
  it('keeps independent axes together in one CaseFileFilter', () => {
    let s = initialCaseFileState();
    s = reduceCaseFile(s, { type: 'filter-next' }); // source: npc
    s = reduceCaseFile(s, { type: 'axis-next' });
    s = reduceCaseFile(s, { type: 'axis-next' }); // entity axis
    s = reduceCaseFile(s, { type: 'filter-next', entities: ENTITIES });
    expect(s.filter).toEqual({ source: 'npc', entity: 'npc:viktor' });
  });

  it('clears every axis back to an empty filter', () => {
    let s = initialCaseFileState();
    s = reduceCaseFile(s, { type: 'filter-next' });
    s = reduceCaseFile(s, { type: 'filter-clear' });
    expect(s.filter).toEqual({});
  });
});

describe('reduceCaseFile grade composition (Req 8.1)', () => {
  it('cycles the reliability letter A..F and wraps', () => {
    let s = initialCaseFileState();
    s = reduceCaseFile(s, { type: 'grade-reliability', step: 1 });
    expect(s.grade.reliability).toBe('B');
    s = reduceCaseFile(s, { type: 'grade-reliability', step: -1 });
    expect(s.grade.reliability).toBe('A');
    s = reduceCaseFile(s, { type: 'grade-reliability', step: -1 });
    expect(s.grade.reliability).toBe('F'); // wraps past A
  });

  it('cycles the credibility digit 1..6 and wraps', () => {
    let s = initialCaseFileState();
    for (let i = 0; i < ADMIRALTY_CREDIBILITY.length; i++) {
      s = reduceCaseFile(s, { type: 'grade-credibility', step: 1 });
    }
    expect(s.grade.credibility).toBe(1); // wrapped a full lap
    s = reduceCaseFile(s, { type: 'grade-credibility', step: -1 });
    expect(s.grade.credibility).toBe(6);
  });

  it('formats a composed grade as it reads on a report', () => {
    let s = initialCaseFileState();
    s = reduceCaseFile(s, { type: 'grade-reliability', step: 1 }); // B
    s = reduceCaseFile(s, { type: 'grade-credibility', step: 1 }); // 2
    expect(formatGrade(s.grade)).toBe('B2');
  });
});

describe('reduceCaseFile link anchor', () => {
  it('marks and clears a link anchor', () => {
    let s = initialCaseFileState();
    s = reduceCaseFile(s, { type: 'link-anchor', id: 'claim:1' });
    expect(s.linkAnchor).toBe('claim:1');
    s = reduceCaseFile(s, { type: 'link-clear' });
    expect(s.linkAnchor).toBeUndefined();
  });
});

describe('reduceCaseFile purity', () => {
  it('does not mutate the input state', () => {
    const s = initialCaseFileState({ count: 2 });
    reduceCaseFile(s, { type: 'cursor-next' });
    reduceCaseFile(s, { type: 'filter-next' });
    expect(s.cursor).toBe(0);
    expect(s.filter).toEqual({});
  });
});
