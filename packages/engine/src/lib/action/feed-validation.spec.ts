/**
 * Tests for the shared feed validation (slice-integration task 2.5;
 * Requirements 14.1, 14.2, 14.3, 14.4; slice Req 37.1, 37.2).
 *
 * `validateFeedItems` runs over hand-built Feed Views (the clock, a known set
 * and held Claims, with no World State or Truth Store) and the real core pack's
 * predicate registry, so each rule is exercised on its own:
 *
 * - the item count, reported once at `index: -1, field: 'items'`;
 * - held Claims, known-set entities, and `unk:` ids resolved (and rewritten)
 *   through held `IS_ALIAS_OF` Claims;
 * - the derived per-predicate schema, one example per field;
 * - windows within the next 7 days;
 * - every failure reported, in rule order, with its item index and field;
 * - every `FeedError` field produced at least once.
 *
 * The last block checks, on a generated world, that `quoteFeed` is disallowed
 * with the first error's reason exactly when validation fails (Req 14.4).
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type ContentSet,
  type DifficultyPreset,
} from '@tradecraft/content';

import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate } from '../generate.js';
import {
  asTruth,
  PHASES_PER_DAY,
  type ChannelId,
  type EntityId,
  type GameTime,
  type LocId,
  type NpcId,
  type OrgId,
  type Phase,
  type Proposition,
  type UnkId,
} from '../model/core.js';
import type { ClaimId, WorldState } from '../model/state.js';
import { newRelationship, type AssetProfile } from '../recruit/asset.js';
import { quoteFeed } from './feed.js';
import {
  FEED_MAX_ITEMS,
  FEED_WINDOW_DAYS,
  feedViewOf,
  isKnownEntity,
  resolveAlias,
  validateFeedItems,
  type FeedError,
  type FeedField,
  type FeedView,
} from './feed-validation.js';
import { IS_ALIAS_OF_PREDICATE } from './identify.js';
import type { ResolverContext } from './result.js';
import type { ComposedProposition, FeedAction, FeedItem } from './types.js';

// ---------------------------------------------------------------------------
// The core pack (the predicate registry the schema rule reads)
// ---------------------------------------------------------------------------

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'content',
  'packs',
  'core',
);

function loadCore(): ContentSet {
  const loaded = loadContent([CORE_DIR], ['core']);
  if (!loaded.ok) {
    throw new Error('core pack failed to load');
  }
  return loaded.value;
}

const content = loadCore();

// ---------------------------------------------------------------------------
// Hand-built Feed Views
// ---------------------------------------------------------------------------

const NOW: GameTime = { day: 4, phase: 1 };
const ALICE = 'npc:alice' as NpcId;
const BORIS = 'npc:boris' as NpcId;
const STRANGER = 'npc:stranger' as NpcId;
const CELL = 'org:cell' as OrgId;
const CAFE = 'loc:cafe' as LocId;
const DOCKS = 'loc:docks' as LocId;
const UNK = 'unk:1' as UnkId;
const UNK_UNRESOLVED = 'unk:2' as UnkId;
const COUNT_REASON = 'a feed must carry 1–3 items';

/** `IS_ALIAS_OF(unk:1, npc:alice)`, as a held Case File Claim asserts it. */
const ALIAS: Proposition = {
  id: 'prop:alias',
  predicate: IS_ALIAS_OF_PREDICATE,
  subject: UNK,
  object: ALICE,
};

/** A held, non-alias Claim the player can feed by id. */
const HELD: Proposition = {
  id: 'prop:held',
  predicate: 'MEMBER_OF',
  subject: BORIS,
  object: CELL,
};

/**
 * A Feed View from Player View data alone: the clock, a known set and the held
 * Claims. Building it from a two-field source (not a World State) is itself the
 * check that validity needs no Truth Store and no `Truth`-branded field
 * (Req 14.3).
 */
function view(
  opts: {
    entities?: readonly EntityId[];
    channels?: readonly ChannelId[];
    claims?: Record<ClaimId, Proposition>;
  } = {},
): FeedView {
  return feedViewOf(
    {
      time: NOW,
      player: {
        known: {
          entities: opts.entities ?? [ALICE, BORIS, CELL, CAFE],
          channels: opts.channels ?? [],
        },
      },
    },
    opts.claims ?? { 'claim:alias': ALIAS, 'claim:held': HELD },
  );
}

function composed(prop: ComposedProposition): FeedItem {
  return { from: 'composed', prop };
}

/** A valid `MEMBER_OF(subject, org:cell)` item (place none, window optional). */
function memberOf(subject: EntityId, org: EntityId = CELL): FeedItem {
  return composed({ predicate: 'MEMBER_OF', subject, object: org });
}

/** A `MEETS_AT(npc:alice, npc:boris)` item at the café with the given window. */
function meetsAt(window: { from: GameTime; to?: GameTime }): FeedItem {
  return composed({
    predicate: 'MEETS_AT',
    subject: ALICE,
    object: BORIS,
    place: CAFE,
    window,
  });
}

/** `n` phases after {@link NOW} (before it when `n` is negative). */
function later(n: number): GameTime {
  const abs = NOW.day * PHASES_PER_DAY + NOW.phase + n;
  return {
    day: Math.floor(abs / PHASES_PER_DAY),
    phase: (abs % PHASES_PER_DAY) as Phase,
  };
}

/** The errors of a failed validation (fails the test if it succeeded). */
function errorsOf(items: readonly FeedItem[], v: FeedView = view()): FeedError[] {
  const result = validateFeedItems(items, v, content);
  if (result.ok) {
    throw new Error('expected the feed to fail validation');
  }
  return result.error;
}

/** The resolved Propositions of a passed validation (fails the test if it failed). */
function propsOf(items: readonly FeedItem[], v: FeedView = view()): Proposition[] {
  const result = validateFeedItems(items, v, content);
  if (!result.ok) {
    throw new Error(`expected the feed to pass: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// The Feed View
// ---------------------------------------------------------------------------

describe('feedViewOf — the truth-free Feed View (Req 14.3)', () => {
  it('holds the clock, the known set, the held Claims and their IS_ALIAS_OF subset', () => {
    const v = view();
    expect(v.now).toEqual(NOW);
    expect(v.known).toEqual({ entities: [ALICE, BORIS, CELL, CAFE], channels: [] });
    expect(Object.keys(v.claims)).toEqual(['claim:alias', 'claim:held']);
    expect(v.aliases).toEqual([ALIAS]);
  });

  it('holds no Claims when none are given', () => {
    const v = feedViewOf({ time: NOW, player: { known: { entities: [], channels: [] } } });
    expect(v.claims).toEqual({});
    expect(v.aliases).toEqual([]);
  });

  it('checks a Channel id against the known Channels, anything else against the entities', () => {
    const chan = 'chan:radio' as ChannelId;
    expect(isKnownEntity({ entities: [], channels: [chan] }, chan)).toBe(true);
    expect(isKnownEntity({ entities: [chan], channels: [] }, chan)).toBe(false);
    expect(isKnownEntity({ entities: [ALICE], channels: [] }, ALICE)).toBe(true);
    expect(isKnownEntity({ entities: [], channels: [] }, ALICE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 1: the item count (Req 37.1)
// ---------------------------------------------------------------------------

describe('validateFeedItems — item count (Req 37.1)', () => {
  it('accepts one to three valid items, resolved in item order', () => {
    for (let n = 1; n <= FEED_MAX_ITEMS; n += 1) {
      const items = Array.from({ length: n }, () => memberOf(BORIS));
      expect(propsOf(items)).toHaveLength(n);
    }
  });

  it('reports an empty feed once, at index -1 on the items field', () => {
    expect(errorsOf([])).toEqual([{ index: -1, field: 'items', reason: COUNT_REASON }]);
  });

  it('reports four valid items as a count error only', () => {
    const items = [memberOf(BORIS), memberOf(BORIS), memberOf(BORIS), memberOf(BORIS)];
    expect(errorsOf(items)).toEqual([{ index: -1, field: 'items', reason: COUNT_REASON }]);
  });

  it('still checks every item of an over-long feed, after the count error', () => {
    const items = [memberOf(BORIS), memberOf(BORIS), memberOf(STRANGER), memberOf(BORIS)];
    expect(errorsOf(items)).toEqual([
      { index: -1, field: 'items', reason: COUNT_REASON },
      { index: 2, field: 'subject', reason: 'npc:stranger is not in your known set' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Rules 2 and 3: held Claims, the known set and unk: ids
// ---------------------------------------------------------------------------

describe('validateFeedItems — held Claims', () => {
  it('feeds a held Claim as the Proposition it asserts', () => {
    expect(propsOf([{ from: 'claim', claim: 'claim:held' }])).toEqual([HELD]);
  });

  it('rejects a Claim id the player does not hold', () => {
    expect(errorsOf([{ from: 'claim', claim: 'claim:missing' }])).toEqual([
      { index: 0, field: 'claim', reason: 'you hold no Case File Claim claim:missing' },
    ]);
  });

  it('does not treat an inherited object key as a held Claim', () => {
    expect(errorsOf([{ from: 'claim', claim: 'constructor' }])).toEqual([
      { index: 0, field: 'claim', reason: 'you hold no Case File Claim constructor' },
    ]);
  });
});

describe('validateFeedItems — known-set entities (Req 37.1, 37.2)', () => {
  it('rejects a subject outside the known set', () => {
    expect(errorsOf([memberOf(STRANGER)])).toEqual([
      { index: 0, field: 'subject', reason: 'npc:stranger is not in your known set' },
    ]);
  });

  it('rejects an entity object outside the known set', () => {
    const item = composed({ predicate: 'REPORTS_TO', subject: ALICE, object: STRANGER });
    expect(errorsOf([item])).toEqual([
      { index: 0, field: 'object', reason: 'npc:stranger is not in your known set' },
    ]);
  });

  it('rejects a place outside the known set', () => {
    const item = composed({
      predicate: 'MEETS_AT',
      subject: ALICE,
      object: BORIS,
      place: DOCKS,
      window: { from: NOW },
    });
    expect(errorsOf([item])).toEqual([
      { index: 0, field: 'place', reason: 'loc:docks is not in your known set' },
    ]);
  });
});

describe('validateFeedItems — unk: ids through held IS_ALIAS_OF Claims', () => {
  const UNRESOLVED = `no held IS_ALIAS_OF Claim resolves ${UNK_UNRESOLVED} to a known person`;

  it('rejects an unk: id no held alias resolves', () => {
    expect(errorsOf([memberOf(UNK_UNRESOLVED)])).toEqual([
      { index: 0, field: 'subject', reason: UNRESOLVED },
    ]);
  });

  it('accepts an alias-resolved unk: id and rewrites it to the NPC', () => {
    const [prop] = propsOf([memberOf(UNK)]);
    expect(prop.subject).toBe(ALICE);
    const item = composed({ predicate: 'REPORTS_TO', subject: BORIS, object: UNK });
    expect(propsOf([item])[0].object).toBe(ALICE);
  });

  it('accepts an alias written either way round', () => {
    const reversed: Proposition = { ...ALIAS, subject: ALICE, object: UNK };
    const v = view({ claims: { 'claim:alias': reversed } });
    expect(resolveAlias(UNK, v)).toBe(ALICE);
    expect(propsOf([memberOf(UNK)], v)[0].subject).toBe(ALICE);
  });

  it('rejects an alias to an NPC outside the known set', () => {
    const v = view({ entities: [BORIS, CELL] });
    expect(resolveAlias(UNK, v)).toBeUndefined();
    expect(errorsOf([memberOf(UNK)], v)[0]).toMatchObject({ index: 0, field: 'subject' });
  });

  it('resolves only through IS_ALIAS_OF Claims, even for a known unk: id', () => {
    const knows: Proposition = {
      id: 'prop:knows',
      predicate: 'KNOWS',
      subject: UNK,
      object: ALICE,
    };
    const v = view({ entities: [ALICE, CELL, UNK], claims: { 'claim:knows': knows } });
    expect(v.aliases).toEqual([]);
    expect(errorsOf([memberOf(UNK)], v)[0]).toMatchObject({ index: 0, field: 'subject' });
  });
});

// ---------------------------------------------------------------------------
// Rule 4: the derived per-predicate schema (Req 37.2)
// ---------------------------------------------------------------------------

describe('validateFeedItems — derived predicate schema (Req 37.2)', () => {
  it('rejects an unknown predicate', () => {
    const item = composed({ predicate: 'NO_SUCH_PREDICATE', subject: ALICE, object: BORIS });
    expect(errorsOf([item])).toEqual([
      { index: 0, field: 'predicate', reason: 'unknown predicate NO_SUCH_PREDICATE' },
    ]);
  });

  it('rejects a subject kind the predicate does not take', () => {
    expect(errorsOf([memberOf(CELL)])).toEqual([
      { index: 0, field: 'subject', reason: 'MEMBER_OF does not take a org subject' },
    ]);
  });

  it('rejects an entity object of the wrong kind', () => {
    expect(errorsOf([memberOf(ALICE, BORIS)])).toEqual([
      { index: 0, field: 'object', reason: 'MEMBER_OF does not take a npc object' },
    ]);
  });

  it('rejects a literal where the predicate takes an entity, and the reverse', () => {
    const literal = composed({
      predicate: 'MEMBER_OF',
      subject: ALICE,
      object: { kind: 'text', value: 'the cell' },
    });
    expect(errorsOf([literal])).toEqual([
      { index: 0, field: 'object', reason: 'MEMBER_OF takes an entity object, not a literal' },
    ]);
    const entity = composed({ predicate: 'PLANS', subject: ALICE, object: BORIS });
    expect(errorsOf([entity])).toEqual([
      { index: 0, field: 'object', reason: 'PLANS takes a text literal object, not an entity' },
    ]);
  });

  it('accepts a literal object of the declared kind', () => {
    const item = composed({
      predicate: 'PLANS',
      subject: ALICE,
      object: { kind: 'text', value: 'the operation' },
    });
    expect(propsOf([item])[0].object).toEqual({ kind: 'text', value: 'the operation' });
  });

  it('rejects a literal of the wrong kind', () => {
    const item = composed({
      predicate: 'PLANS',
      subject: ALICE,
      object: { kind: 'amount', value: 500 },
    });
    expect(errorsOf([item])).toEqual([
      { index: 0, field: 'object', reason: 'PLANS takes a text object, not amount' },
    ]);
  });

  it('rejects a missing required place and window', () => {
    const item = composed({ predicate: 'MEETS_AT', subject: ALICE, object: BORIS });
    expect(errorsOf([item])).toEqual([
      { index: 0, field: 'place', reason: 'MEETS_AT requires a place' },
      { index: 0, field: 'window', reason: 'MEETS_AT requires a time window' },
    ]);
  });

  it('rejects a place or a window the predicate takes none of', () => {
    const placed = composed({ predicate: 'MEMBER_OF', subject: ALICE, object: CELL, place: CAFE });
    expect(errorsOf([placed])).toEqual([
      { index: 0, field: 'place', reason: 'MEMBER_OF takes no place' },
    ]);
    const timed = composed({
      predicate: 'IS_ALIAS_OF',
      subject: ALICE,
      object: BORIS,
      window: { from: NOW },
    });
    expect(errorsOf([timed])).toEqual([
      { index: 0, field: 'window', reason: 'IS_ALIAS_OF takes no time window' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Rule 5: windows within the next 7 days
// ---------------------------------------------------------------------------

describe('validateFeedItems — windows within the next 7 days', () => {
  const SEVEN_DAYS = FEED_WINDOW_DAYS * PHASES_PER_DAY;

  it('accepts a window from now up to exactly 7 days ahead', () => {
    expect(propsOf([meetsAt({ from: NOW })])).toHaveLength(1);
    expect(propsOf([meetsAt({ from: later(2), to: later(SEVEN_DAYS) })])).toHaveLength(1);
  });

  it('rejects a window that starts in the past', () => {
    expect(errorsOf([meetsAt({ from: later(-1) })])).toEqual([
      { index: 0, field: 'window', reason: 'the window must not start in the past' },
    ]);
  });

  it('rejects a window that ends, or starts, more than 7 days ahead', () => {
    const beyond = {
      index: 0,
      field: 'window',
      reason: 'the window must be within the next 7 days',
    };
    expect(errorsOf([meetsAt({ from: NOW, to: later(SEVEN_DAYS + 1) })])).toEqual([beyond]);
    expect(errorsOf([meetsAt({ from: later(SEVEN_DAYS + 1) })])).toEqual([beyond]);
  });
});

// ---------------------------------------------------------------------------
// Every failure, in rule order (Req 14.2)
// ---------------------------------------------------------------------------

describe('validateFeedItems — every failure is reported (Req 14.2)', () => {
  it('reports each failing item under its own index, in item order', () => {
    const items = [
      memberOf(BORIS),
      memberOf(STRANGER),
      { from: 'claim', claim: 'claim:missing' } as const,
    ];
    expect(errorsOf(items)).toEqual([
      { index: 1, field: 'subject', reason: 'npc:stranger is not in your known set' },
      { index: 2, field: 'claim', reason: 'you hold no Case File Claim claim:missing' },
    ]);
  });

  it('reports known-set, schema and window failures of one item together', () => {
    const item = composed({
      predicate: 'MEETS_AT',
      subject: STRANGER,
      object: BORIS,
      window: { from: later(-2) },
    });
    expect(errorsOf([item])).toEqual([
      { index: 0, field: 'subject', reason: 'npc:stranger is not in your known set' },
      { index: 0, field: 'place', reason: 'MEETS_AT requires a place' },
      { index: 0, field: 'window', reason: 'the window must not start in the past' },
    ]);
  });

  it('reports a field that fails the known-set rule once, by that rule', () => {
    // MEMBER_OF takes only org objects, so an unk: object would also fail the
    // kind rule; it is reported once, as the unresolved alias.
    expect(errorsOf([memberOf(ALICE, UNK_UNRESOLVED)])).toEqual([
      {
        index: 0,
        field: 'object',
        reason: `no held IS_ALIAS_OF Claim resolves ${UNK_UNRESOLVED} to a known person`,
      },
    ]);
  });

  it('produces every FeedError field', () => {
    const inputs: (readonly FeedItem[])[] = [
      [],
      [{ from: 'claim', claim: 'claim:missing' }],
      [composed({ predicate: 'NO_SUCH_PREDICATE', subject: ALICE, object: BORIS })],
      [memberOf(STRANGER)],
      [memberOf(ALICE, UNK_UNRESOLVED)],
      [composed({ predicate: 'MEMBER_OF', subject: ALICE, object: CELL, place: DOCKS })],
      [meetsAt({ from: later(-1) })],
    ];
    const fields = new Set<FeedField>(
      inputs.flatMap((items) => errorsOf(items).map((e) => e.field)),
    );
    const all: FeedField[] = [
      'items',
      'claim',
      'predicate',
      'subject',
      'object',
      'place',
      'window',
    ];
    expect([...fields].sort()).toEqual([...all].sort());
  });
});

// ---------------------------------------------------------------------------
// Minted ids for composed items
// ---------------------------------------------------------------------------

describe('validateFeedItems — composed item ids', () => {
  it('mints prop:feed/<index>, scoped to the agent when one is given', () => {
    const items = [{ from: 'claim', claim: 'claim:held' } as const, memberOf(BORIS)];
    const plain = validateFeedItems(items, view(), content);
    const scoped = validateFeedItems(items, view(), content, { agent: ALICE });
    expect(plain.ok && plain.value.map((p) => p.id)).toEqual(['prop:held', 'prop:feed/1']);
    expect(scoped.ok && scoped.value.map((p) => p.id)).toEqual([
      'prop:held',
      `prop:feed/${ALICE}/1`,
    ]);
  });
});

// ---------------------------------------------------------------------------
// quoteFeed agrees with validateFeedItems (Req 14.4)
// ---------------------------------------------------------------------------

describe('quoteFeed — first error reason exactly when validation fails (Req 14.4)', () => {
  function preset(id: string): DifficultyPreset {
    for (const [key, value] of content.difficultyPresets) {
      if (key === id || key.endsWith(`/${id}`)) {
        return value;
      }
    }
    throw new Error(`no difficulty preset ${id}`);
  }

  function world(): WorldState {
    const cityData = loadCityData(CORE_DIR);
    const descriptors = loadDescriptorData(CORE_DIR);
    const publicTexts = loadPublicTexts(CORE_DIR);
    if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
      throw new Error('core pack side files failed to load');
    }
    const scenario = ScenarioConfigSchema.parse({
      difficulty: { preset: 'standard' },
      mole: false,
      recruitment: {
        pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
        firstContact: { a: 1, b: 1, c: 1, d: 1 },
        meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
        exposure: { k1: 1, k2: 1, k3: 1 },
        turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
      },
    });
    return generate('feed-validation', {
      content,
      preset: preset('standard'),
      scenario,
      cityData: cityData.value,
      descriptors: descriptors.value,
      publicTexts: publicTexts.value,
    });
  }

  const base = world();
  const npcs = Object.keys(base.npcs) as NpcId[];
  const [agent, subject, contact, stranger] = npcs;
  const org = Object.values(base.orgs).find((o) => o.kind === 'hostile')?.id as OrgId;
  const loc = Object.keys(base.city.locations)[0] as LocId;
  const unk = 'unk:7' as UnkId;
  const claims: Record<ClaimId, Proposition> = {
    'claim:alias': {
      id: 'prop:alias',
      predicate: IS_ALIAS_OF_PREDICATE,
      subject: unk,
      object: subject,
    },
    'claim:held': { id: 'prop:held', predicate: 'MEMBER_OF', subject: contact, object: org },
  };
  const ctx: ResolverContext = { content, claims };

  /** The world with `agent` turned (or not) and a Contact Channel to them. */
  function staged(turned: boolean): WorldState {
    const profile: AssetProfile = {
      access: asTruth({ locs: [], orgs: [], npcs: [agent] }),
      reliability: asTruth(0.6),
      turned: true,
      hostileControlled: asTruth(false),
    };
    return {
      ...base,
      relationships: {
        ...base.relationships,
        [agent]: turned
          ? { ...newRelationship(agent), recruited: true, asset: profile }
          : newRelationship(agent),
      },
      player: {
        ...base.player,
        contacts: [...new Set([...base.player.contacts, agent])],
        known: { ...base.player.known, entities: [agent, subject, contact, org, loc] },
      },
    };
  }

  const inRange = { from: base.time, to: { day: base.time.day + 2, phase: base.time.phase } };
  const tooFar = { from: base.time, to: { day: base.time.day + 30, phase: base.time.phase } };
  const meets = (window: { from: GameTime; to?: GameTime }): FeedItem =>
    composed({ predicate: 'MEETS_AT', subject, object: contact, place: loc, window });
  const valid = memberOf(subject, org);
  const cases: {
    readonly name: string;
    readonly items: readonly FeedItem[];
    readonly valid: boolean;
  }[] = [
    { name: 'one valid item', items: [valid], valid: true },
    {
      name: 'three valid items',
      items: [valid, { from: 'claim', claim: 'claim:held' }, meets(inRange)],
      valid: true,
    },
    { name: 'an alias-resolved unk: id', items: [memberOf(unk, org)], valid: true },
    { name: 'no items', items: [], valid: false },
    { name: 'four items', items: [valid, valid, valid, valid], valid: false },
    {
      name: 'an unheld Claim',
      items: [{ from: 'claim', claim: 'claim:missing' }],
      valid: false,
    },
    {
      name: 'an entity outside the known set',
      items: [memberOf(stranger, org)],
      valid: false,
    },
    {
      name: 'an unresolved unk: id',
      items: [memberOf('unk:8' as UnkId, org)],
      valid: false,
    },
    {
      name: 'a schema violation',
      items: [composed({ predicate: 'MEETS_AT', subject, object: contact })],
      valid: false,
    },
    { name: 'a window beyond 7 days', items: [meets(tooFar)], valid: false },
    {
      name: 'a valid item before an invalid one',
      items: [valid, memberOf(stranger, org)],
      valid: false,
    },
  ];

  for (const turned of [true, false]) {
    const state = staged(turned);
    for (const { name, items, valid: expected } of cases) {
      it(`${name}, ${turned ? 'to a turned agent' : 'to an agent who is not turned'}`, () => {
        const validation = validateFeedItems(items, feedViewOf(state, claims), content);
        expect(validation.ok).toBe(expected);
        const a: FeedAction = { kind: 'feed', asset: agent, items };
        const q = quoteFeed(state, a, ctx);
        if (!validation.ok) {
          expect(q).toEqual({
            allowed: false,
            reason: validation.error[0].reason,
            phases: 0,
            money: 0,
          });
        } else if (turned) {
          expect(q).toEqual({ allowed: true, phases: 0, money: 0 });
        } else {
          expect(q).toEqual({
            allowed: false,
            reason: 'you can only feed a double agent you have turned',
            phases: 0,
            money: 0,
          });
        }
      });
    }
  }
});
