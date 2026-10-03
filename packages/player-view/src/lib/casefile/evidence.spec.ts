import {
  type EntityId,
  type GameTime,
  type Literal,
  type LocId,
  type Proposition,
} from '@tradecraft/engine';

import { CaseFile, type ClaimSource } from './casefile.js';
import {
  aliasClasses,
  evidenceCount,
  hostileMarks,
  implicates,
  implicationRules,
  type BriefView,
  type ImplicationRules,
} from './evidence.js';

// ---------------------------------------------------------------------------
// Fixtures: the core-pack implication rules (design "Arrest Evidence" table)
// ---------------------------------------------------------------------------

const CORE_RULES: ImplicationRules = implicationRules([
  ['MEMBER_OF', { role: 'subject', other: ['hostile-org'] }],
  ['WORKS_FOR', { role: 'subject', other: ['hostile-org'] }],
  ['REPORTS_TO', { role: 'subject', other: ['hostile-person', 'hostile-org'] }],
  ['MEETS_AT', { role: 'either', other: ['hostile-person'] }],
  ['CARRIES', { role: 'subject', other: ['materiel'] }],
  ['SUPPLIES', { role: 'subject', other: ['materiel'] }],
  ['USES_CHANNEL', { role: 'subject', other: ['hostile-channel'] }],
  ['PLANS', { role: 'subject', other: ['none'] }],
  ['TARGETS', { role: 'subject', other: ['none'] }],
  // Not an evidence predicate, but held in the Case File for alias resolution.
  ['IS_ALIAS_OF', undefined],
]);

// The Brief designates the Hostile Service and the Cell as hostile orgs, the
// Cell's radio Channel as a hostile Channel, and names one piece of materiel.
const BRIEF: BriefView = {
  hostileOrgs: ['org:hs', 'org:cell'],
  hostileChannels: ['chan:cell-radio'],
  materiel: ['item:brief-crate'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const T: GameTime = { day: 0, phase: 0 };

let propCounter = 0;
function prop(
  subject: EntityId,
  predicate: string,
  object: EntityId | Literal,
  extra: { place?: LocId } = {},
): Proposition {
  propCounter += 1;
  return {
    id: `prop:${propCounter}`,
    subject,
    predicate,
    object,
    ...(extra.place ? { place: extra.place } : {}),
  };
}

const npc = (n: string): ClaimSource => ({ kind: 'npc', npc: `npc:${n}` });
const doc = (id: string): ClaimSource => ({
  kind: 'document',
  id: `doc:${id}`,
});
const intercept = (id: string): ClaimSource => ({
  kind: 'intercept',
  id: `int:${id}`,
});

/**
 * Add two Claims from different sources asserting the same Proposition, so the
 * Claims corroborate (Requirement 7.4). Returns the Case File for chaining.
 */
function corroborate(
  cf: CaseFile,
  subject: EntityId,
  predicate: string,
  object: EntityId | Literal,
  extra: { place?: LocId } = {},
): CaseFile {
  cf.add({ source: npc('a'), prop: prop(subject, predicate, object, extra), observedAt: T });
  cf.add({ source: doc('b'), prop: prop(subject, predicate, object, extra), observedAt: T });
  return cf;
}

// ---------------------------------------------------------------------------
// aliasClasses
// ---------------------------------------------------------------------------

describe('aliasClasses', () => {
  it('maps an unlinked id to itself', () => {
    const cf = new CaseFile();
    cf.add({ source: npc('a'), prop: prop('npc:viktor', 'MEMBER_OF', 'org:hs'), observedAt: T });
    const canon = aliasClasses(cf);
    expect(canon('npc:viktor')).toBe('npc:viktor');
    expect(canon('unk:3')).toBe('unk:3');
  });

  it('folds an unk: id into a named entity through a held IS_ALIAS_OF Claim', () => {
    const cf = new CaseFile();
    cf.add({ source: npc('a'), prop: prop('unk:3', 'IS_ALIAS_OF', 'npc:viktor'), observedAt: T });
    const canon = aliasClasses(cf);
    expect(canon('unk:3')).toBe(canon('npc:viktor'));
  });
});

// ---------------------------------------------------------------------------
// Core-pack rules: one implicating case per predicate (design table)
// ---------------------------------------------------------------------------

describe('core-pack implication rules', () => {
  it('MEMBER_OF implicates a subject tied to a hostile org', () => {
    const cf = new CaseFile();
    corroborate(cf, 'npc:viktor', 'MEMBER_OF', 'org:cell');
    expect(evidenceCount(cf, 'npc:viktor', BRIEF, CORE_RULES)).toBe(1);
  });

  it('WORKS_FOR implicates a subject tied to a hostile org', () => {
    const cf = new CaseFile();
    corroborate(cf, 'npc:viktor', 'WORKS_FOR', 'org:hs');
    expect(evidenceCount(cf, 'npc:viktor', BRIEF, CORE_RULES)).toBe(1);
  });

  it('WORKS_FOR does not implicate when the org is not hostile', () => {
    const cf = new CaseFile();
    corroborate(cf, 'npc:viktor', 'WORKS_FOR', 'org:bank');
    expect(evidenceCount(cf, 'npc:viktor', BRIEF, CORE_RULES)).toBe(0);
  });

  it('REPORTS_TO implicates a subject reporting to a hostile person', () => {
    const cf = new CaseFile();
    // Viktor is a hostile person (MEMBER_OF the Cell); Ana reports to Viktor.
    corroborate(cf, 'npc:viktor', 'MEMBER_OF', 'org:cell');
    corroborate(cf, 'npc:ana', 'REPORTS_TO', 'npc:viktor');
    expect(evidenceCount(cf, 'npc:ana', BRIEF, CORE_RULES)).toBe(1);
  });

  it('REPORTS_TO implicates a subject reporting to a hostile org', () => {
    const cf = new CaseFile();
    corroborate(cf, 'npc:ana', 'REPORTS_TO', 'org:hs');
    expect(evidenceCount(cf, 'npc:ana', BRIEF, CORE_RULES)).toBe(1);
  });

  it('MEETS_AT implicates the party meeting a hostile person (role either)', () => {
    const cf = new CaseFile();
    corroborate(cf, 'npc:viktor', 'MEMBER_OF', 'org:cell');
    corroborate(cf, 'npc:ana', 'MEETS_AT', 'npc:viktor', { place: 'loc:pier' });
    // Ana meets the hostile Viktor: the other party (Viktor) is a hostile
    // person, so Ana is implicated (role either, subject side).
    expect(evidenceCount(cf, 'npc:ana', BRIEF, CORE_RULES)).toBe(1);
    // Viktor is implicated by the MEMBER_OF Claim. MEETS_AT does NOT add a
    // second: for Viktor (object side) the other party is Ana, who is not a
    // hostile person, so that Claim does not implicate Viktor.
    expect(evidenceCount(cf, 'npc:viktor', BRIEF, CORE_RULES)).toBe(1);
  });

  it('MEETS_AT implicates both parties when each meets a hostile person', () => {
    const cf = new CaseFile();
    // Both Viktor and Ana are hostile (Cell members). Their meeting implicates
    // each, since each is meeting a hostile person.
    corroborate(cf, 'npc:viktor', 'MEMBER_OF', 'org:cell');
    corroborate(cf, 'npc:ana', 'MEMBER_OF', 'org:cell');
    corroborate(cf, 'npc:ana', 'MEETS_AT', 'npc:viktor', { place: 'loc:pier' });
    // MEMBER_OF (1) + MEETS_AT (1) for each.
    expect(evidenceCount(cf, 'npc:ana', BRIEF, CORE_RULES)).toBe(2);
    expect(evidenceCount(cf, 'npc:viktor', BRIEF, CORE_RULES)).toBe(2);
  });

  it('CARRIES implicates a hostile person carrying materiel', () => {
    const cf = new CaseFile();
    corroborate(cf, 'npc:viktor', 'MEMBER_OF', 'org:cell');
    corroborate(cf, 'npc:viktor', 'CARRIES', 'item:brief-crate');
    // Two distinct implicating Propositions against Viktor.
    expect(evidenceCount(cf, 'npc:viktor', BRIEF, CORE_RULES)).toBe(2);
  });

  it('SUPPLIES implicates a hostile person supplying materiel', () => {
    const cf = new CaseFile();
    corroborate(cf, 'npc:viktor', 'MEMBER_OF', 'org:cell');
    corroborate(cf, 'npc:viktor', 'SUPPLIES', 'item:brief-crate');
    expect(evidenceCount(cf, 'npc:viktor', BRIEF, CORE_RULES)).toBe(2);
  });

  it('USES_CHANNEL implicates a hostile person using a hostile channel', () => {
    const cf = new CaseFile();
    corroborate(cf, 'npc:viktor', 'MEMBER_OF', 'org:cell');
    corroborate(cf, 'npc:viktor', 'USES_CHANNEL', 'chan:cell-radio');
    expect(evidenceCount(cf, 'npc:viktor', BRIEF, CORE_RULES)).toBe(2);
  });

  it('PLANS implicates on its own (other = none)', () => {
    const cf = new CaseFile();
    corroborate(cf, 'npc:viktor', 'PLANS', 'item:bomb');
    expect(evidenceCount(cf, 'npc:viktor', BRIEF, CORE_RULES)).toBe(1);
  });

  it('TARGETS implicates on its own (other = none)', () => {
    const cf = new CaseFile();
    corroborate(cf, 'npc:viktor', 'TARGETS', 'loc:embassy');
    expect(evidenceCount(cf, 'npc:viktor', BRIEF, CORE_RULES)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// hostileMarks: the fixpoint
// ---------------------------------------------------------------------------

describe('hostileMarks', () => {
  it('seeds orgs, channels and materiel from the Brief', () => {
    const cf = new CaseFile();
    const marks = hostileMarks(cf, BRIEF, CORE_RULES);
    expect(marks.orgs.has('org:hs')).toBe(true);
    expect(marks.orgs.has('org:cell')).toBe(true);
    expect(marks.channels.has('chan:cell-radio')).toBe(true);
    expect(marks.materiel.has('item:brief-crate')).toBe(true);
    expect(marks.persons.size).toBe(0);
  });

  it('marks a person via a corroborated MEMBER_OF to a hostile org', () => {
    const cf = new CaseFile();
    corroborate(cf, 'npc:viktor', 'MEMBER_OF', 'org:cell');
    const marks = hostileMarks(cf, BRIEF, CORE_RULES);
    expect(marks.persons.has('npc:viktor')).toBe(true);
  });

  it('ignores a single uncorroborated Claim', () => {
    const cf = new CaseFile();
    cf.add({ source: npc('a'), prop: prop('npc:viktor', 'MEMBER_OF', 'org:cell'), observedAt: T });
    const marks = hostileMarks(cf, BRIEF, CORE_RULES);
    expect(marks.persons.has('npc:viktor')).toBe(false);
  });

  it('propagates materiel and channels off a newly hostile person to a fixpoint', () => {
    const cf = new CaseFile();
    corroborate(cf, 'npc:viktor', 'MEMBER_OF', 'org:cell');
    corroborate(cf, 'npc:viktor', 'CARRIES', 'item:plans');
    corroborate(cf, 'npc:viktor', 'USES_CHANNEL', 'chan:dead-drop');
    const marks = hostileMarks(cf, BRIEF, CORE_RULES);
    expect(marks.persons.has('npc:viktor')).toBe(true);
    expect(marks.materiel.has('item:plans')).toBe(true);
    expect(marks.channels.has('chan:dead-drop')).toBe(true);
  });

  it('reaches a multi-step fixpoint (REPORTS_TO chains hostility)', () => {
    const cf = new CaseFile();
    // Viktor -> Cell makes Viktor hostile; Ana reports to Viktor; Boris reports
    // to Ana. REPORTS_TO's rule allows a hostile-person other, so hostility
    // should propagate down the chain within hostileMarks' person set only if
    // REPORTS_TO were a person-marking rule. The design marks persons from
    // MEMBER_OF/WORKS_FOR only, so Ana and Boris are NOT in persons — but each
    // is independently implicated via REPORTS_TO. Verify persons stays minimal.
    corroborate(cf, 'npc:viktor', 'MEMBER_OF', 'org:cell');
    corroborate(cf, 'npc:ana', 'REPORTS_TO', 'npc:viktor');
    const marks = hostileMarks(cf, BRIEF, CORE_RULES);
    expect(marks.persons.has('npc:viktor')).toBe(true);
    expect(marks.persons.has('npc:ana')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// implicates: role and mark logic
// ---------------------------------------------------------------------------

describe('implicates', () => {
  it('is false for a predicate with no implication rule', () => {
    const cf = new CaseFile();
    const claim = cf.add({
      source: npc('a'),
      prop: prop('npc:viktor', 'KNOWS', 'npc:ana'),
      observedAt: T,
    });
    const marks = hostileMarks(cf, BRIEF, CORE_RULES);
    const canon = aliasClasses(cf);
    expect(implicates(claim, 'npc:viktor', marks, canon, CORE_RULES)).toBe(false);
  });

  it('is false when the target does not fill the rule role', () => {
    const cf = new CaseFile();
    const claim = cf.add({
      source: npc('a'),
      prop: prop('npc:viktor', 'MEMBER_OF', 'org:cell'),
      observedAt: T,
    });
    const marks = hostileMarks(cf, BRIEF, CORE_RULES);
    const canon = aliasClasses(cf);
    // The org fills the object slot, but MEMBER_OF's role is subject.
    expect(implicates(claim, 'org:cell', marks, canon, CORE_RULES)).toBe(false);
    expect(implicates(claim, 'npc:viktor', marks, canon, CORE_RULES)).toBe(true);
  });

  it('is false when a real-mark rule has a literal other argument', () => {
    const cf = new CaseFile();
    // CARRIES with a literal amount object cannot carry the materiel mark.
    const amount: Literal = { kind: 'amount', value: 5 };
    const claim = cf.add({
      source: npc('a'),
      prop: prop('npc:viktor', 'CARRIES', amount),
      observedAt: T,
    });
    const marks = hostileMarks(cf, BRIEF, CORE_RULES);
    const canon = aliasClasses(cf);
    expect(implicates(claim, 'npc:viktor', marks, canon, CORE_RULES)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evidenceCount: distinctness and corroboration gating
// ---------------------------------------------------------------------------

describe('evidenceCount', () => {
  it('counts distinct implicating Propositions once each', () => {
    const cf = new CaseFile();
    // Three sources all assert the same MEMBER_OF fact: one distinct key.
    cf.add({ source: npc('a'), prop: prop('npc:viktor', 'MEMBER_OF', 'org:cell'), observedAt: T });
    cf.add({ source: doc('b'), prop: prop('npc:viktor', 'MEMBER_OF', 'org:cell'), observedAt: T });
    cf.add({ source: intercept('c'), prop: prop('npc:viktor', 'MEMBER_OF', 'org:cell'), observedAt: T });
    expect(evidenceCount(cf, 'npc:viktor', BRIEF, CORE_RULES)).toBe(1);
  });

  it('ignores an uncorroborated implicating Claim', () => {
    const cf = new CaseFile();
    cf.add({ source: npc('a'), prop: prop('npc:viktor', 'MEMBER_OF', 'org:cell'), observedAt: T });
    expect(evidenceCount(cf, 'npc:viktor', BRIEF, CORE_RULES)).toBe(0);
  });

  it('does not count a conflicted Claim', () => {
    const cf = new CaseFile();
    // Two sources disagree on the org: the Claims conflict, so neither counts.
    cf.add({ source: npc('a'), prop: prop('npc:viktor', 'MEMBER_OF', 'org:cell'), observedAt: T });
    cf.add({ source: doc('b'), prop: prop('npc:viktor', 'MEMBER_OF', 'org:bank'), observedAt: T });
    expect(evidenceCount(cf, 'npc:viktor', BRIEF, CORE_RULES)).toBe(0);
  });

  it('separates distinct implicating facts', () => {
    const cf = new CaseFile();
    corroborate(cf, 'npc:viktor', 'MEMBER_OF', 'org:cell');
    corroborate(cf, 'npc:viktor', 'PLANS', 'item:bomb');
    corroborate(cf, 'npc:viktor', 'TARGETS', 'loc:embassy');
    expect(evidenceCount(cf, 'npc:viktor', BRIEF, CORE_RULES)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Alias resolution of unk: ids (Requirement 40.2; design Property 12)
// ---------------------------------------------------------------------------

describe('alias resolution of unk: ids', () => {
  it('implicates a named target through a Claim about an aliased unk: id', () => {
    const cf = new CaseFile();
    // The player observed unk:3 as a Cell member, then learned unk:3 is Viktor.
    corroborate(cf, 'unk:3', 'MEMBER_OF', 'org:cell');
    cf.add({ source: npc('a'), prop: prop('unk:3', 'IS_ALIAS_OF', 'npc:viktor'), observedAt: T });
    cf.add({ source: doc('b'), prop: prop('unk:3', 'IS_ALIAS_OF', 'npc:viktor'), observedAt: T });
    // The count is equal for the unk: id and the named entity (Property 12).
    expect(evidenceCount(cf, 'npc:viktor', BRIEF, CORE_RULES)).toBe(1);
    expect(evidenceCount(cf, 'unk:3', BRIEF, CORE_RULES)).toBe(1);
  });

  it('merges Claims about the same fact across an alias boundary', () => {
    const cf = new CaseFile();
    // One source names unk:3, another names Viktor; once aliased, they are the
    // same subject and so corroborate into a single distinct implicating fact.
    cf.add({ source: npc('a'), prop: prop('unk:3', 'MEMBER_OF', 'org:cell'), observedAt: T });
    cf.add({ source: doc('b'), prop: prop('npc:viktor', 'MEMBER_OF', 'org:cell'), observedAt: T });
    cf.add({ source: npc('c'), prop: prop('unk:3', 'IS_ALIAS_OF', 'npc:viktor'), observedAt: T });
    cf.add({ source: doc('d'), prop: prop('unk:3', 'IS_ALIAS_OF', 'npc:viktor'), observedAt: T });
    expect(evidenceCount(cf, 'npc:viktor', BRIEF, CORE_RULES)).toBe(1);
  });

  it('resolves a hostile person through an aliased org id', () => {
    const cf = new CaseFile();
    // The Brief marks org:cell hostile; a Claim ties Viktor to org:kompromat,
    // and another aliases org:kompromat to org:cell. Viktor is then implicated.
    corroborate(cf, 'npc:viktor', 'MEMBER_OF', 'org:kompromat');
    cf.add({ source: npc('a'), prop: prop('org:kompromat', 'IS_ALIAS_OF', 'org:cell'), observedAt: T });
    cf.add({ source: doc('b'), prop: prop('org:kompromat', 'IS_ALIAS_OF', 'org:cell'), observedAt: T });
    expect(evidenceCount(cf, 'npc:viktor', BRIEF, CORE_RULES)).toBe(1);
  });
});
