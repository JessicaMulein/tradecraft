/**
 * Feature: slice-integration, Property 48: Feed validation agreement (task
 * 9.10).
 *
 * **Validates: Requirements 14.1, 14.2, 14.4**
 *
 * The design states (slice-integration design, "Property 48: Feed validation
 * agreement"):
 *
 * > For any reachable state and any feed item list, `validateFeed` returns ok if
 * > and only if `quote` for the matching `feed` action is not disallowed on
 * > feed-content grounds. When it fails, every Feed Error's index is −1 (count
 * > errors) or the index of an item that fails the engine feed rules on the
 * > named field, and every failing item has at least one error.
 *
 * Both surfaces are driven through the real facade: `validateFeed` through
 * {@link PlayerViewEngine.validateFeed} (task 9.8) and the engine `quote` for
 * the matching `feed` action through {@link PlayerViewEngine.quote}, which
 * forwards to the engine's pure `quote` (`engine-api.ts`). Both call the one
 * shared `validateFeedItems` (task 2.5), so the whole point of the property is
 * that the facade's two seams can never disagree about *feed content* (Req 14.4).
 *
 * ## Separating feed-content grounds from target grounds
 *
 * `quoteFeed` validates the items first and, only if they pass, checks the
 * target (a real NPC, a player-turned Asset, a Contact Channel). A disallowal
 * from that second group is *not* a feed-content disallowal, so to pin the clean
 * iff this spec drives two staged worlds built from the same generated base:
 *
 * - **a turned-agent world** — the `agent` is a player-turned Asset with a
 *   Contact Channel, so every target check passes. Here `quote.allowed` is true
 *   exactly when validation passes, so `validateFeed`'s ok flag and the quote's
 *   `allowed` flag must be equal item-for-item: the direct iff.
 *
 * - **an unturned-agent world** — the same `agent` is *not* a turned Asset. Now
 *   a feed that passes validation is still disallowed, but on *target* grounds
 *   (the fixed "you can only feed a double agent you have turned" reason), never
 *   on feed-content grounds. This is the control that proves the iff is about
 *   feed content: whenever `validateFeed` returns ok, the quote's disallowal (if
 *   any) is a target reason, and whenever `validateFeed` fails, the quote is
 *   disallowed with that first error's reason.
 *
 * The resolver context the facade's `quote` reads is built with the real
 * {@link projectResolverContext} over the same Case File `validateFeed` reads,
 * so `ctx.claims` and the Case File's held Claims are the one projection — the
 * same wiring the live Turn Pipeline uses — and the two Feed Views cannot drift.
 *
 * ## The feed item lists swept
 *
 * An arbitrary draws 0–4 items (so the 1–3 count rule both holds and fails),
 * each one of:
 *
 * - a **held-Claim** reference (to a Claim the Case File holds, or a missing one);
 * - a **composed** Proposition over a known or unknown predicate, a subject and
 *   object drawn from the known set / an `unk:` id with or without a resolving
 *   alias / a stranger outside the known set, with an optional place and an
 *   optional window that is in range, in the past, or beyond the 7-day horizon.
 *
 * That mix makes feeds that pass and feeds that fail on every rule (count, held
 * Claim, known set, alias resolution, the derived predicate schema, and the
 * window), so the iff is exercised on both sides across the input space.
 *
 * The core-pack fixture pattern mirrors `objective-evaluator.property.spec.ts`
 * and the engine's `feed-validation.spec.ts` "quoteFeed agrees" block.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type PublicText,
} from '@tradecraft/content';
import {
  asTruth,
  generateGame,
  newRelationship,
  ScenarioConfigSchema,
  type Action,
  type AssetProfile,
  type ComposedProposition,
  type EntityId,
  type FeedItem,
  type GameTime,
  type GenerateInputs,
  type LocId,
  type NpcId,
  type OrgId,
  type Proposition,
  type ResolverContext,
  type UnkId,
  type WorldState,
} from '@tradecraft/engine';

import { CaseFile, type ClaimSource } from '../casefile/casefile.js';
import { implicationRules, type BriefView } from '../casefile/evidence.js';
import { Journal } from '../journal/journal.js';
import { NotificationStore } from '../notify/store.js';
import { PlayerViewEngine } from './engine-api.js';
import { projectResolverContext } from './resolver-projection.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors objective-evaluator.property.spec.ts)
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

function loadCore(): {
  content: ContentSet;
  cityData: CityData;
  descriptors: DescriptorData;
  publicTexts: readonly PublicText[];
} {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) throw new Error('core pack failed to load');
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) throw new Error('city.yaml failed to load');
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) throw new Error('descriptors.yaml failed to load');
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) throw new Error('public texts failed to load');
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const { content, cityData, descriptors, publicTexts } = loadCore();

function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) return value;
  }
  throw new Error(`no difficulty preset ${id}`);
}

const STANDARD = preset('standard');

function inputs(): GenerateInputs {
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: true,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  return { content, preset: STANDARD, scenario, cityData, descriptors, publicTexts };
}

function game(seed: string): WorldState {
  return generateGame(seed, inputs()).world;
}

const BASE: WorldState = game('feed-agreement-alpha');

const NPC_IDS: readonly NpcId[] = (Object.keys(BASE.npcs) as NpcId[]).sort();
if (NPC_IDS.length < 4) {
  throw new Error('the generated world has fewer than four NPCs');
}

// A hostile org, the subject of the held `MEMBER_OF` Claim and a valid composed
// item (`MEMBER_OF` takes an entity object, no place, optional window).
const HOSTILE_ORG = (Object.values(BASE.orgs).find((o) => o.kind === 'hostile')?.id ??
  (Object.keys(BASE.orgs)[0] as OrgId)) as OrgId;

// A Location in the known set, for `MEETS_AT`'s required place.
const KNOWN_LOC = Object.keys(BASE.city.locations)[0] as LocId;

// The turned agent and the three NPCs the known set and the composed items name.
const AGENT: NpcId = NPC_IDS[0];
const SUBJECT: NpcId = NPC_IDS[1];
const CONTACT: NpcId = NPC_IDS[2];
// An NPC deliberately left *out* of the known set: naming it fails the known-set
// rule, so a composed item over it is content-invalid.
const STRANGER: NpcId = NPC_IDS[3];

// The `unk:` id a held `IS_ALIAS_OF` Claim resolves to `SUBJECT`, and one with
// no resolving alias (so it fails the known-set rule).
const UNK_RESOLVED: UnkId = 'unk:100';
const UNK_UNRESOLVED: UnkId = 'unk:999';

const T: GameTime = BASE.time;

// ---------------------------------------------------------------------------
// Held Case File Claims (the alias and a plain MEMBER_OF)
// ---------------------------------------------------------------------------

// A Claim id the Case File never mints, so a `{ from: 'claim' }` item naming it
// fails the held-Claim rule.
const CLAIM_MISSING = 'claim:missing';

/**
 * The Case File the facade reads: a held `IS_ALIAS_OF(UNK_RESOLVED, SUBJECT)`
 * Claim (so an `unk:` feed item resolves) and a held `MEMBER_OF(CONTACT,
 * HOSTILE_ORG)` Claim (a valid `{ from: 'claim' }` item). Nothing truth-bearing:
 * a Case File Claim carries only the Proposition it asserts.
 */
function buildCaseFile(): CaseFile {
  const caseFile = new CaseFile();
  const aliasSource: ClaimSource = { kind: 'npc', npc: SUBJECT };
  const aliasProp: Proposition = {
    id: 'prop:alias',
    subject: UNK_RESOLVED,
    predicate: 'IS_ALIAS_OF',
    object: SUBJECT,
  };
  caseFile.add({ source: aliasSource, prop: aliasProp, observedAt: T });

  const heldSource: ClaimSource = { kind: 'npc', npc: CONTACT };
  const heldProp: Proposition = {
    id: 'prop:held',
    subject: CONTACT,
    predicate: 'MEMBER_OF',
    object: HOSTILE_ORG,
  };
  caseFile.add({ source: heldSource, prop: heldProp, observedAt: T });
  return caseFile;
}

// The Claim ids the Case File actually assigns, so the held-Claim arbitrary can
// name a real held id (the Case File mints its own ids, not the prop ids above).
const HELD_CLAIM_IDS: readonly string[] = buildCaseFile()
  .list()
  .map((c) => c.id);

// ---------------------------------------------------------------------------
// Staging the two worlds (turned agent vs unturned agent)
// ---------------------------------------------------------------------------

const KNOWN_ENTITIES: readonly EntityId[] = [
  AGENT,
  SUBJECT,
  CONTACT,
  HOSTILE_ORG,
  KNOWN_LOC,
];

/**
 * The base world with `AGENT` a player-turned Asset (when `turned`) or a plain,
 * unrecruited relationship (when not), a Contact Channel to them, and the known
 * set set so the composed items can name their entities. Mirrors the engine
 * feed-validation spec's `staged` helper. Only relationship/contact/known fields
 * change; no truth is touched.
 */
function staged(turned: boolean): WorldState {
  const profile: AssetProfile = {
    access: asTruth({ locs: [], orgs: [], npcs: [AGENT] }),
    reliability: asTruth(0.6),
    turned: true,
    hostileControlled: asTruth(false),
  };
  return {
    ...BASE,
    relationships: {
      ...BASE.relationships,
      [AGENT]: turned
        ? { ...newRelationship(AGENT), recruited: true, asset: profile }
        : newRelationship(AGENT),
    },
    player: {
      ...BASE.player,
      contacts: [...new Set([...BASE.player.contacts, AGENT])],
      known: { ...BASE.player.known, entities: [...KNOWN_ENTITIES] },
    },
  };
}

const EMPTY_BRIEF: BriefView = { hostileOrgs: [], hostileChannels: [], materiel: [] };
const NO_RULES = implicationRules([]);

/**
 * A facade over `state` and the shared Case File. `ctx` is built with the real
 * {@link projectResolverContext} so the engine `quote` the facade forwards to
 * reads the *same* held Claims `validateFeed` reads (no Truth draft is needed —
 * feed validity reads none). No turnDriver, model seams or stores beyond the
 * minimum: only `validateFeed` and `quote` are exercised.
 */
function makeEngine(state: WorldState, caseFile: CaseFile): PlayerViewEngine {
  const ctx: ResolverContext = projectResolverContext(
    { state, caseFile, content, brief: EMPTY_BRIEF, rules: NO_RULES },
    // Feed validity never reads truth; a resolver that would is not reached here.
    undefined as unknown as Parameters<typeof projectResolverContext>[1],
  );
  return new PlayerViewEngine({
    state,
    caseFile,
    journal: new Journal(),
    cityData,
    ctx,
    brief: EMPTY_BRIEF,
    rules: NO_RULES,
    notifications: new NotificationStore(),
  });
}

// ---------------------------------------------------------------------------
// Arbitraries for the feed item lists
// ---------------------------------------------------------------------------

/** A predicate name: a real core-pack predicate, or an unknown one. */
const predicateArb: fc.Arbitrary<string> = fc.constantFrom(
  'MEMBER_OF',
  'REPORTS_TO',
  'KNOWS',
  'MEETS_AT',
  'PLANS',
  'NO_SUCH_PREDICATE',
);

/** An entity id for a composed subject/object: known, aliased, unresolved or a stranger. */
const entityArb: fc.Arbitrary<EntityId> = fc.constantFrom<EntityId>(
  SUBJECT,
  CONTACT,
  HOSTILE_ORG,
  UNK_RESOLVED,
  UNK_UNRESOLVED,
  STRANGER,
);

/** A composed object: an entity, or a literal of varying kind. */
const objectArb: fc.Arbitrary<ComposedProposition['object']> = fc.oneof(
  entityArb,
  fc.constant<ComposedProposition['object']>({ kind: 'text', value: 'the operation' }),
  fc.constant<ComposedProposition['object']>({ kind: 'amount', value: 500 }),
);

/** An optional place: none, the known Location, or a stranger Location id. */
const placeArb: fc.Arbitrary<LocId | undefined> = fc.oneof(
  fc.constant<LocId | undefined>(undefined),
  fc.constant<LocId | undefined>(KNOWN_LOC),
  fc.constant<LocId | undefined>('loc:nowhere' as LocId),
);

/** An optional window: none, in range, in the past, or beyond the 7-day horizon. */
const windowArb: fc.Arbitrary<ComposedProposition['window']> = fc.oneof(
  fc.constant<ComposedProposition['window']>(undefined),
  fc.constant<ComposedProposition['window']>({
    from: T,
    to: { day: T.day + 2, phase: T.phase },
  }),
  fc.constant<ComposedProposition['window']>({
    from: { day: Math.max(0, T.day - 1), phase: T.phase },
  }),
  fc.constant<ComposedProposition['window']>({
    from: T,
    to: { day: T.day + 30, phase: T.phase },
  }),
);

const composedItemArb: fc.Arbitrary<FeedItem> = fc
  .record({
    predicate: predicateArb,
    subject: entityArb,
    object: objectArb,
    place: placeArb,
    window: windowArb,
  })
  .map(({ predicate, subject, object, place, window }) => ({
    from: 'composed' as const,
    prop: {
      predicate: predicate as ComposedProposition['predicate'],
      subject,
      object,
      ...(place === undefined ? {} : { place }),
      ...(window === undefined ? {} : { window }),
    },
  }));

const claimItemArb: fc.Arbitrary<FeedItem> = fc
  .constantFrom(...HELD_CLAIM_IDS, CLAIM_MISSING)
  .map((claim) => ({ from: 'claim' as const, claim }));

const itemArb: fc.Arbitrary<FeedItem> = fc.oneof(composedItemArb, claimItemArb);

// 0–4 items, so the 1–3 count rule both holds and fails.
const itemsArb: fc.Arbitrary<readonly FeedItem[]> = fc.array(itemArb, {
  minLength: 0,
  maxLength: 4,
});

const RUNS = 300;

// ---------------------------------------------------------------------------
// Property 48 (Req 14.1, 14.2, 14.4)
// ---------------------------------------------------------------------------

describe('Property 48: Feed validation agreement (Req 14.1, 14.2, 14.4)', () => {
  const turnedEngine = makeEngine(staged(true), buildCaseFile());
  const unturnedEngine = makeEngine(staged(false), buildCaseFile());

  const feed = (items: readonly FeedItem[]): Action => ({
    kind: 'feed',
    asset: AGENT,
    items,
  });

  // The fixed target-ground disallowal reasons `quoteFeed` gives *after*
  // validation passes — never a feed-content reason.
  const TARGET_REASONS = new Set<string>([
    'you can only feed a double agent you have turned',
    'you have no contact channel to this agent',
    `no such person ${AGENT}`,
  ]);

  it('validateFeed is ok exactly when the quote to a turned agent is allowed (Req 14.4)', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const validateOk = turnedEngine.validateFeed(items).ok;
        const quote = turnedEngine.quote(feed(items));
        // With every target check passing, allowed holds exactly when the feed
        // content validates: the clean iff.
        expect(quote.allowed).toBe(validateOk);
      }),
      { numRuns: RUNS },
    );
  });

  it('an unturned agent is never disallowed on feed-content grounds when the feed is ok (Req 14.4)', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const result = unturnedEngine.validateFeed(items);
        const quote = unturnedEngine.quote(feed(items));
        if (result.ok) {
          // A valid feed to an unturned agent is disallowed only on target
          // grounds — the fixed "not a turned agent" reason — never on content.
          expect(quote.allowed).toBe(false);
          expect(quote.allowed || TARGET_REASONS.has(quote.reason ?? '')).toBe(true);
        } else {
          // A content-invalid feed is disallowed with the first error's reason,
          // whoever the target is (the content check runs before the target one).
          expect(quote.allowed).toBe(false);
          expect(quote.reason).toBe(result.error[0].reason);
          expect(TARGET_REASONS.has(quote.reason ?? '')).toBe(false);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('every Feed Error names a real failure: index −1 or a valid item index (Req 14.2)', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const result = turnedEngine.validateFeed(items);
        if (result.ok) return;
        for (const error of result.error) {
          // Index is the count sentinel or a real item position.
          expect(error.index >= -1 && error.index < items.length).toBe(true);
          // The count sentinel is reported on the `items` field, and only there.
          if (error.index === -1) {
            expect(error.field).toBe('items');
          } else {
            expect(error.field).not.toBe('items');
          }
          // Every error carries a non-empty, player-facing reason.
          expect(typeof error.reason).toBe('string');
          expect(error.reason.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('a failed validation reports the count error exactly when the item count is out of range (Req 14.1, 14.2)', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const result = turnedEngine.validateFeed(items);
        const countBad = items.length < 1 || items.length > 3;
        const hasCountError =
          !result.ok && result.error.some((e) => e.index === -1 && e.field === 'items');
        // The count error appears in the error list exactly when the count is
        // out of the 1–3 range (an in-range feed may still fail on other rules).
        expect(hasCountError).toBe(countBad);
        // An out-of-range feed is never ok.
        if (countBad) expect(result.ok).toBe(false);
      }),
      { numRuns: RUNS },
    );
  });
});
