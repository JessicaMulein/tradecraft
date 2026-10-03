/**
 * Tests for the Relationship / Asset status model and Asset reporting (task
 * 18.1; Requirements 10.3, 10.4, 10.6).
 *
 * These check:
 *
 * - `assetStatus`/`isAsset` read the recruited/turned flags (People view);
 * - `factInAccess` admits a fact only when its subject/object, place or
 *   (via the injected membership lookup) org falls within the Asset's access
 *   (Req 10.6);
 * - `reportFacts` returns only in-access Propositions, omits/distorts at the
 *   reliability rate, caps at 3, and is deterministic for a seed (Req 10.4,
 *   10.6);
 * - a perfectly reliable Asset reports every in-access fact verbatim (up to the
 *   cap); a zero-reliability Asset reports nothing.
 */

import { describe, expect, it } from 'vitest';

import { createPrng } from '../prng/prng.js';
import {
  asTruth,
  type LocId,
  type NpcId,
  type OrgId,
  type Proposition,
  type Truth,
} from '../model/core.js';
import {
  assetStatus,
  distortProposition,
  factInAccess,
  isAsset,
  newRelationship,
  reportFacts,
  MAX_REPORTED_PROPS,
  type AssetAccess,
  type AssetProfile,
  type OrgMembershipLookup,
  type Relationship,
} from './asset.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function prop(
  id: string,
  subject: string,
  overrides: Partial<Proposition> = {},
): Truth<Proposition> {
  return asTruth({
    id,
    subject: subject as NpcId,
    predicate: 'LOCATED_AT',
    object: { kind: 'text', value: 'somewhere' },
    ...overrides,
  });
}

function profile(
  access: Partial<AssetAccess>,
  reliability: number,
  overrides: Partial<AssetProfile> = {},
): AssetProfile {
  return {
    access: asTruth({ locs: [], orgs: [], npcs: [], ...access }),
    reliability: asTruth(reliability),
    turned: false,
    hostileControlled: asTruth(false),
    ...overrides,
  };
}

const NO_MEMBERS: OrgMembershipLookup = () => false;

function assetRel(overrides: Partial<AssetProfile> = {}): Relationship {
  return {
    ...newRelationship('npc:a' as NpcId),
    recruited: true,
    asset: profile({ npcs: ['npc:a' as NpcId] }, 1, overrides),
  };
}

// ---------------------------------------------------------------------------
// Asset status
// ---------------------------------------------------------------------------

describe('assetStatus / isAsset', () => {
  it('is none before recruitment', () => {
    const rel = newRelationship('npc:a' as NpcId);
    expect(assetStatus(rel)).toBe('none');
    expect(isAsset(rel)).toBe(false);
  });

  it('is recruited for a plain Asset and turned for a turned double', () => {
    const plain = assetRel();
    expect(assetStatus(plain)).toBe('recruited');
    expect(isAsset(plain)).toBe(true);

    const turned = assetRel({ turned: true });
    expect(assetStatus(turned)).toBe('turned');
  });

  it('does not surface a hostile-controlled Asset as anything special', () => {
    const doubled = assetRel({ hostileControlled: asTruth(true) });
    expect(assetStatus(doubled)).toBe('recruited');
  });
});

// ---------------------------------------------------------------------------
// factInAccess (Req 10.6)
// ---------------------------------------------------------------------------

describe('factInAccess', () => {
  const access: AssetAccess = {
    locs: ['loc:cafe' as LocId],
    orgs: ['org:cell' as OrgId],
    npcs: ['npc:known' as NpcId],
  };

  it('admits a fact whose subject is a known person', () => {
    expect(factInAccess(prop('p1', 'npc:known'), access, NO_MEMBERS)).toBe(true);
  });

  it('admits a fact whose entity object is a known person', () => {
    const p = prop('p2', 'npc:other', { object: 'npc:known' as NpcId });
    expect(factInAccess(p, access, NO_MEMBERS)).toBe(true);
  });

  it('admits a fact placed at a known Location', () => {
    const p = prop('p3', 'npc:other', { place: 'loc:cafe' as LocId });
    expect(factInAccess(p, access, NO_MEMBERS)).toBe(true);
  });

  it('admits a fact whose subject is a member of a known org (via the lookup)', () => {
    const isMember: OrgMembershipLookup = (s, o) =>
      s === 'npc:other' && o === 'org:cell';
    const p = prop('p4', 'npc:other');
    expect(factInAccess(p, access, isMember)).toBe(true);
    expect(factInAccess(p, access, NO_MEMBERS)).toBe(false);
  });

  it('rejects a fact outside every access branch', () => {
    const p = prop('p5', 'npc:stranger', { place: 'loc:elsewhere' as LocId });
    expect(factInAccess(p, access, NO_MEMBERS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reportFacts (Req 10.4, 10.6)
// ---------------------------------------------------------------------------

describe('reportFacts', () => {
  const access = { npcs: ['npc:a', 'npc:b', 'npc:c'] as NpcId[] };

  const inAccess = [
    prop('f1', 'npc:a'),
    prop('f2', 'npc:b'),
    prop('f3', 'npc:c'),
  ];

  it('reports every in-access fact verbatim at reliability 1 (up to the cap)', () => {
    const reported = reportFacts(
      inAccess,
      profile(access, 1),
      NO_MEMBERS,
      createPrng('rel-1'),
    );
    expect(reported).toHaveLength(3);
    expect(reported.map((p) => p.id)).toEqual(['f1', 'f2', 'f3']);
  });

  it('reports nothing at reliability 0 (all omitted)', () => {
    const reported = reportFacts(
      inAccess,
      profile(access, 0),
      NO_MEMBERS,
      createPrng('rel-0'),
    );
    expect(reported).toHaveLength(0);
  });

  it('filters out facts outside the access reach (Req 10.6)', () => {
    const mixed = [
      prop('in', 'npc:a'),
      prop('out', 'npc:stranger'),
    ];
    const reported = reportFacts(
      mixed,
      profile(access, 1),
      NO_MEMBERS,
      createPrng('filter'),
    );
    expect(reported.map((p) => p.id)).toEqual(['in']);
  });

  it('caps the report at MAX_REPORTED_PROPS', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      prop(`m${i}`, 'npc:a'),
    );
    const reported = reportFacts(
      many,
      profile(access, 1),
      NO_MEMBERS,
      createPrng('cap'),
    );
    expect(reported).toHaveLength(MAX_REPORTED_PROPS);
  });

  it('is deterministic for a seed', () => {
    const p = profile(access, 0.6);
    const a = reportFacts(inAccess, p, NO_MEMBERS, createPrng('det'));
    const b = reportFacts(inAccess, p, NO_MEMBERS, createPrng('det'));
    expect(a).toEqual(b);
  });

  it('omits more as reliability falls (statistical, over many facts)', () => {
    const many = Array.from({ length: 200 }, (_, i) => prop(`r${i}`, 'npc:a'));
    // Cap is small, so compare omission by sampling before the cap: use a
    // reliability sweep on the raw report-coin via a large unique-fact set and
    // the fact that lower reliability yields a report no larger than higher.
    const high = reportFacts(many, profile(access, 0.9), NO_MEMBERS, createPrng('s'));
    const low = reportFacts(many, profile(access, 0.1), NO_MEMBERS, createPrng('s'));
    // Both are capped at 3, but a 0.1 Asset frequently returns fewer than 3.
    expect(low.length).toBeLessThanOrEqual(high.length);
  });
});

// ---------------------------------------------------------------------------
// distortProposition
// ---------------------------------------------------------------------------

describe('distortProposition', () => {
  const access: AssetAccess = {
    locs: [],
    orgs: [],
    npcs: ['npc:a', 'npc:b', 'npc:c'] as NpcId[],
  };

  it('swaps the subject for another person in access and mints a new id', () => {
    const original = prop('orig', 'npc:a') as Proposition;
    const distorted = distortProposition(original, access, createPrng('d'));
    expect(distorted.subject).not.toBe('npc:a');
    expect(['npc:b', 'npc:c']).toContain(distorted.subject);
    expect(distorted.id).not.toBe('orig');
  });

  it('returns the fact unchanged when no distinct replacement exists', () => {
    const soloAccess: AssetAccess = { locs: [], orgs: [], npcs: ['npc:a' as NpcId] };
    const original = prop('orig', 'npc:a') as Proposition;
    const distorted = distortProposition(original, soloAccess, createPrng('d'));
    expect(distorted).toEqual(original);
  });
});
