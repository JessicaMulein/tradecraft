/**
 * Unit tests for the dialogue turn (slice-integration tasks 3.2 and 3.3;
 * Requirements 15.5, 15.6, 15.7, 15.8).
 *
 * These drive a generated {@link WorldState} from the real core pack through
 * `applyDialogueTurn`. Pitch outcomes are forced with extreme pitch weights and
 * seeds chosen by their first draw, so each test exercises one branch. They
 * check:
 *
 * - each of the twelve Intents moves the scene NPC's trust and suspicion by its
 *   `INTENT_DELTAS` entry; a pitch adds nothing more on acceptance and its
 *   outcome's `suspicionDelta` on a refusal (Req 15.5);
 * - the turn starts from a fresh Relationship when the NPC has none, with
 *   `channel` following the player's Contact Channels;
 * - a pitch is `resolvePitch` against the post-Intent Relationship, drawing
 *   exactly once on the passed PRNG; any other Intent never draws (Req 15.6);
 * - acceptance recruits the NPC with the profile `assetProfileFor` mints,
 *   keeping an existing profile (Req 15.6);
 * - a money pitch's offer is debited (`pay`, the NPC as `ref`) on acceptance and
 *   on both kinds of refusal, and scales the pitch; an offer on any other Intent
 *   moves no money and changes nothing (Req 15.7);
 * - a refusal adds `suspicionDelta`, and a reported one records the approach
 *   and raises Cover Suspicion by 0.1, both clamped at 1 (Req 15.8);
 * - the player's line joins `scene.recent`, capped at `RECENT_TURNS`, and the
 *   scene is written to `player.scene`;
 * - inputs are not mutated, and invalid offers and a missing scene NPC throw.
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
import { generate, type GenerateInputs } from '../generate.js';
import { asTruth, revealTruth, type NpcId } from '../model/core.js';
import {
  RECENT_TURNS,
  type TalkScene,
  type TalkSceneTurn,
  type WorldState,
} from '../model/state.js';
import { createPrng } from '../prng/prng.js';
import { balance } from '../station/ledger.js';
import {
  assetProfileFor,
  newRelationship,
  type AssetProfile,
  type MiceLever,
  type Relationship,
} from './asset.js';
import { applyIntent, INTENT_DELTAS, INTENTS, type Intent } from './intent.js';
import {
  PITCH_BAD_SUSPICION,
  PITCH_FAIL_SUSPICION,
  pitchProbability,
  resolvePitch,
  type PitchWeights,
} from './pitch.js';
import {
  appendRecentTurn,
  applyDialogueTurn,
  PITCH_REPORTED_COVER_SUSPICION,
  pitchLever,
  sceneRelationship,
  type DialogueTurnInput,
  type DialogueTurnResult,
} from './dialogue-turn.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors task.spec.ts)
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

function inputs(): GenerateInputs {
  const content = loadContent([CORE_DIR], ['core']);
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!content.ok || !cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core pack failed to load');
  }
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    recruitment: {
      pitch: { w1: 2.2, w2: 1.4, w3: 1.8, w4: 1.2 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: {
        trust: 1,
        riskAversion: 1,
        scheduleConflict: 1,
        agendaInterest: 1,
      },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  return {
    content: content.value,
    preset: standardPreset(content.value),
    scenario,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

function standardPreset(content: ContentSet): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === 'standard' || key.endsWith('/standard')) {
      return value;
    }
  }
  throw new Error('no standard difficulty preset');
}

/** One generated world, shared: each test stages its own copy on top of it. */
const BASE: WorldState = generate('dialogue-alpha', inputs());

/** A Starting-Brief contact: the player has a Contact Channel, no Relationship. */
const CONTACT: NpcId = BASE.player.contacts[0];
/** An NPC the player has no Contact Channel to. */
const STRANGER: NpcId = (Object.keys(BASE.npcs) as NpcId[])
  .sort()
  .find((id) => !BASE.player.contacts.includes(id)) as NpcId;

/** The scenario's own pitch weights. */
const WEIGHTS: PitchWeights = BASE.meta.scenario.recruitment.pitch;

/**
 * Weights that force an acceptance: every pitch Intent raises suspicion, and a
 * large negative suspicion weight drives σ to exactly 1.
 */
const ACCEPT: PitchWeights = { w1: 0, w2: 0, w3: -1000, w4: 0 };

/** Weights that force a refusal: σ is driven to (all but) 0. */
const REFUSE: PitchWeights = { w1: 0, w2: 0, w3: 1000, w4: 0 };

/** A seed whose first draw satisfies `pred` (the pitch coin is the first draw). */
function seedWhere(pred: (draw: number) => boolean): string {
  for (let i = 0; i < 500; i += 1) {
    const seed = `dialogue-seed-${i}`;
    if (pred(createPrng(seed).next())) {
      return seed;
    }
  }
  throw new Error('no seed found');
}

/**
 * Under {@link REFUSE} (p ≈ 0) a refusal is reported when the draw clears half
 * the failing range, and quiet below that.
 */
const REPORTED_SEED = seedWhere((d) => d >= 0.6);
const QUIET_SEED = seedWhere((d) => d >= 0.05 && d < 0.4);

/** The four pitch Intents, in vocabulary order. */
const PITCH_INTENTS: readonly Intent[] = INTENTS.filter(
  (i) => pitchLever(i) !== undefined,
);
/** The eight Intents that are not a pitch. */
const TALK_INTENTS: readonly Intent[] = INTENTS.filter(
  (i) => pitchLever(i) === undefined,
);

function sceneWith(
  npc: NpcId,
  recent: readonly TalkSceneTurn[] = [],
): TalkScene {
  return { npc, kind: 'routine', openedAt: BASE.time, via: 'talk', recent };
}

/** The base world with an open scene and, optionally, a Relationship for the NPC. */
function staged(
  npc: NpcId,
  rel?: Relationship,
): { state: WorldState; scene: TalkScene } {
  const scene = sceneWith(npc);
  const relationships =
    rel === undefined
      ? BASE.relationships
      : { ...BASE.relationships, [npc]: rel };
  return {
    state: { ...BASE, relationships, player: { ...BASE.player, scene } },
    scene,
  };
}

function say(
  intent: Intent,
  offer?: number,
  line = 'A word, if I may.',
): DialogueTurnInput {
  return offer === undefined ? { line, intent } : { line, intent, offer };
}

/** The Relationship as the Intent alone leaves it (step 1 of the turn). */
function afterIntent(
  state: WorldState,
  npc: NpcId,
  intent: Intent,
): Relationship {
  return applyIntent(sceneRelationship(state, npc), intent);
}

// ---------------------------------------------------------------------------
// Each Intent's deltas (Req 15.5)
// ---------------------------------------------------------------------------

/**
 * A mid-range Relationship with the stranger. The player has no Contact
 * Channel to them, so a turn starts from it unchanged. No Intent delta or pitch
 * effect reaches a clamp from here, so each move shows in full.
 */
const START: Relationship = {
  ...newRelationship(STRANGER),
  trust: 0.5,
  suspicion: 0.4,
};

/**
 * The trust and suspicion {@link START} reaches after `intent`'s
 * `INTENT_DELTAS` entry plus `pitchSuspicion` more suspicion, as matchers to
 * 12 digits.
 */
function startMovedBy(
  intent: Intent,
  pitchSuspicion = 0,
): Pick<Relationship, 'trust' | 'suspicion'> {
  const delta = INTENT_DELTAS[intent];
  return {
    trust: expect.closeTo(START.trust + delta.trust, 12),
    suspicion: expect.closeTo(
      START.suspicion + delta.suspicion + pitchSuspicion,
      12,
    ),
  };
}

/** The scene NPC's trust and suspicion after a turn with {@link START}. */
function strangerScalars(out: DialogueTurnResult) {
  const rel = out.state.relationships[STRANGER];
  return { trust: rel?.trust, suspicion: rel?.suspicion };
}

describe("applyDialogueTurn: each Intent's deltas (Req 15.5)", () => {
  it('names the lever of each of the four pitch Intents, and of no other', () => {
    expect(PITCH_INTENTS).toEqual([
      'pitch-money',
      'pitch-ideology',
      'pitch-coercion',
      'pitch-ego',
    ]);
    expect(PITCH_INTENTS.map((i) => pitchLever(i))).toEqual([
      'money',
      'ideology',
      'coercion',
      'ego',
    ]);
  });

  it.each(TALK_INTENTS)(
    '%s moves trust and suspicion by its delta, with no pitch and no draw',
    (intent) => {
      const { state, scene } = staged(STRANGER, START);
      const rng = createPrng('talk');
      const before = rng.state();
      const out = applyDialogueTurn(state, scene, say(intent), rng, WEIGHTS);
      expect(out.state.relationships[STRANGER]).toEqual({
        ...START,
        ...startMovedBy(intent),
      });
      expect(out.pitch).toBeUndefined();
      expect(out.events).toEqual([]);
      expect(rng.state()).toEqual(before);
    },
  );

  it.each(PITCH_INTENTS)(
    '%s moves trust and suspicion by its delta, plus the pitch outcome',
    (intent) => {
      const turn = (weights: PitchWeights, seed: string) => {
        const { state, scene } = staged(STRANGER, START);
        return applyDialogueTurn(
          state,
          scene,
          say(intent),
          createPrng(seed),
          weights,
        );
      };

      // An acceptance adds nothing to the Intent's move.
      const accepted = turn(ACCEPT, 'accept');
      expect(accepted.pitch).toMatchObject({
        accepted: true,
        suspicionDelta: 0,
      });
      expect(strangerScalars(accepted)).toEqual(startMovedBy(intent));

      // A refusal adds its outcome's suspicionDelta: the soft rise when quiet,
      // the bad one when reported.
      const quiet = turn(REFUSE, QUIET_SEED);
      expect(quiet.pitch).toMatchObject({
        accepted: false,
        reported: false,
        suspicionDelta: PITCH_FAIL_SUSPICION,
      });
      expect(strangerScalars(quiet)).toEqual(
        startMovedBy(intent, PITCH_FAIL_SUSPICION),
      );

      const reported = turn(REFUSE, REPORTED_SEED);
      expect(reported.pitch).toMatchObject({
        accepted: false,
        reported: true,
        suspicionDelta: PITCH_BAD_SUSPICION,
      });
      expect(strangerScalars(reported)).toEqual(
        startMovedBy(intent, PITCH_BAD_SUSPICION),
      );
    },
  );

  it('starts from a fresh Relationship when the NPC has none, its channel following the Contact Channels', () => {
    expect(BASE.relationships[CONTACT]).toBeUndefined();
    expect(BASE.relationships[STRANGER]).toBeUndefined();
    for (const [npc, channel] of [
      [CONTACT, true],
      [STRANGER, false],
    ] as const) {
      const { state, scene } = staged(npc);
      const out = applyDialogueTurn(
        state,
        scene,
        say('small-talk'),
        createPrng('fresh'),
        WEIGHTS,
      );
      expect(out.state.relationships[npc]).toEqual(
        applyIntent({ ...newRelationship(npc), channel }, 'small-talk'),
      );
    }
  });

  it('brings an existing channel flag in line with a Contact Channel, and never clears one', () => {
    const stale = staged(CONTACT, newRelationship(CONTACT));
    const out = applyDialogueTurn(
      stale.state,
      stale.scene,
      say('ask'),
      createPrng('x'),
      WEIGHTS,
    );
    expect(out.state.relationships[CONTACT]?.channel).toBe(true);

    const introduced = staged(STRANGER, {
      ...newRelationship(STRANGER),
      channel: true,
    });
    const kept = applyDialogueTurn(
      introduced.state,
      introduced.scene,
      say('ask'),
      createPrng('x'),
      WEIGHTS,
    );
    expect(kept.state.relationships[STRANGER]?.channel).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The pitch coin (Req 15.6)
// ---------------------------------------------------------------------------

describe('applyDialogueTurn: the pitch coin (Req 15.6)', () => {
  it.each(PITCH_INTENTS)(
    '%s is resolvePitch against the post-Intent Relationship, one draw on the passed PRNG',
    (intent) => {
      const { state, scene } = staged(CONTACT);
      const rng = createPrng('one-coin');
      const out = applyDialogueTurn(state, scene, say(intent), rng, WEIGHTS);
      const probe = createPrng('one-coin');
      expect(out.pitch).toEqual(
        resolvePitch(
          BASE.npcs[CONTACT],
          afterIntent(state, CONTACT, intent),
          pitchLever(intent) as MiceLever,
          0,
          WEIGHTS,
          probe,
        ),
      );
      expect(rng.state()).toEqual(probe.state());
    },
  );
});

// ---------------------------------------------------------------------------
// Acceptance (Req 15.6)
// ---------------------------------------------------------------------------

describe('applyDialogueTurn: acceptance makes the NPC an Asset (Req 15.6)', () => {
  it.each(PITCH_INTENTS)(
    '%s accepted sets recruited and mints the profile with assetProfileFor',
    (intent) => {
      const { state, scene } = staged(CONTACT);
      const out = applyDialogueTurn(
        state,
        scene,
        say(intent),
        createPrng('accept'),
        ACCEPT,
      );
      expect(out.pitch?.accepted).toBe(true);
      expect(out.state.relationships[CONTACT]).toEqual({
        ...afterIntent(state, CONTACT, intent),
        recruited: true,
        asset: assetProfileFor(BASE.npcs[CONTACT], BASE.npcs),
      });
      // An acceptance reports nothing.
      expect(out.state.hostile).toBe(BASE.hostile);
      expect(out.state.player.coverSuspicion).toBe(BASE.player.coverSuspicion);
    },
  );

  it('keeps an existing Asset profile when a running Asset accepts again', () => {
    const turned: AssetProfile = {
      access: asTruth({ locs: [], orgs: [], npcs: [CONTACT] }),
      reliability: asTruth(0.6),
      turned: true,
      hostileControlled: asTruth(true),
    };
    const asset: Relationship = {
      ...newRelationship(CONTACT),
      recruited: true,
      channel: true,
      asset: turned,
    };
    const { state, scene } = staged(CONTACT, asset);
    const out = applyDialogueTurn(
      state,
      scene,
      say('pitch-ideology'),
      createPrng('again'),
      ACCEPT,
    );
    expect(out.state.relationships[CONTACT]?.recruited).toBe(true);
    expect(out.state.relationships[CONTACT]?.asset).toBe(turned);
  });

  it('opens a Contact Channel to a stranger recruited in a scene', () => {
    const { state, scene } = staged(STRANGER);
    const out = applyDialogueTurn(
      state,
      scene,
      say('pitch-ego'),
      createPrng('accept'),
      ACCEPT,
    );
    // Recruiting someone includes agreeing how to reach them, so the new Asset
    // can be tasked straight away.
    expect(out.state.relationships[STRANGER]?.recruited).toBe(true);
    expect(out.state.relationships[STRANGER]?.channel).toBe(true);
    expect(out.state.player.contacts).toContain(STRANGER);
    expect(out.state.player.known.entities).toContain(STRANGER);
  });
});

// ---------------------------------------------------------------------------
// The money offer (Req 15.7)
// ---------------------------------------------------------------------------

describe('applyDialogueTurn: the money offer (Req 15.7)', () => {
  const OFFER = 40;

  it.each([
    {
      outcome: 'accepted',
      weights: ACCEPT,
      seed: 'accept',
      accepted: true,
      reported: false,
    },
    {
      outcome: 'refused quietly',
      weights: REFUSE,
      seed: QUIET_SEED,
      accepted: false,
      reported: false,
    },
    {
      outcome: 'refused and reported',
      weights: REFUSE,
      seed: REPORTED_SEED,
      accepted: false,
      reported: true,
    },
  ])(
    'debits the offer, tagged pay with the NPC as ref, when the pitch is $outcome',
    ({ weights, seed, accepted, reported }) => {
      const { state, scene } = staged(CONTACT);
      const out = applyDialogueTurn(
        state,
        scene,
        say('pitch-money', OFFER),
        createPrng(seed),
        weights,
      );
      expect(out.pitch).toMatchObject({ accepted, reported });
      const ledger = out.state.station.ledger;
      expect(ledger.entries).toEqual([
        ...BASE.station.ledger.entries,
        { at: BASE.time, amount: -OFFER, reason: 'pay', ref: CONTACT },
      ]);
      expect(balance(ledger)).toBe(balance(BASE.station.ledger) - OFFER);
    },
  );

  it('debits an offer the Budget exactly covers, leaving it at zero', () => {
    const all = balance(BASE.station.ledger);
    const { state, scene } = staged(CONTACT);
    const out = applyDialogueTurn(
      state,
      scene,
      say('pitch-money', all),
      createPrng('all-in'),
      WEIGHTS,
    );
    expect(balance(out.state.station.ledger)).toBe(0);
  });

  it('scales the money pitch by the offer', () => {
    const offer = 75;
    const { state, scene } = staged(CONTACT);
    const out = applyDialogueTurn(
      state,
      scene,
      say('pitch-money', offer),
      createPrng('scale'),
      WEIGHTS,
    );
    const npc = BASE.npcs[CONTACT];
    const rel = afterIntent(state, CONTACT, 'pitch-money');
    expect(out.pitch?.probability).toBe(
      pitchProbability(npc, rel, 'money', offer, WEIGHTS),
    );
    // The contact is moved by money and needs more than the offer, so the
    // offer counts: it beats the same pitch made with nothing on the table.
    expect(out.pitch?.probability).toBeGreaterThan(
      pitchProbability(npc, rel, 'money', 0, WEIGHTS),
    );
  });

  it('moves no money for a money pitch without an offer', () => {
    for (const offer of [undefined, 0]) {
      const { state, scene } = staged(CONTACT);
      const out = applyDialogueTurn(
        state,
        scene,
        say('pitch-money', offer),
        createPrng('free'),
        WEIGHTS,
      );
      expect(out.pitch).toBeDefined();
      expect(out.state.station.ledger).toBe(BASE.station.ledger);
    }
  });

  // Req 15.7 and the design's step 2 tie the debit (and the scaling) to a
  // money pitch, and the turn follows them. Property 55's wording ("any Intent
  // and any money offer the Budget covers ... the committed Budget equals the
  // pre-turn Budget minus the offer") would debit an offer attached to any
  // Intent. The two conflict; these cases pin the requirement's rule, not the
  // property's wording.
  it.each(INTENTS.filter((i) => i !== 'pitch-money'))(
    'moves no money and changes nothing for an offer on %s',
    (intent) => {
      const { state, scene } = staged(CONTACT);
      const offered = applyDialogueTurn(
        state,
        scene,
        say(intent, OFFER),
        createPrng('other'),
        WEIGHTS,
      );
      const plain = applyDialogueTurn(
        state,
        scene,
        say(intent),
        createPrng('other'),
        WEIGHTS,
      );
      expect(offered.state.station.ledger).toBe(BASE.station.ledger);
      expect(offered).toEqual(plain);
    },
  );
});

// ---------------------------------------------------------------------------
// A refusal and the report (Req 15.8)
// ---------------------------------------------------------------------------

describe('applyDialogueTurn: a refusal and the report (Req 15.8)', () => {
  it('a quiet refusal adds suspicionDelta and reports nothing', () => {
    const { state, scene } = staged(CONTACT);
    const out = applyDialogueTurn(
      state,
      scene,
      say('pitch-coercion'),
      createPrng(QUIET_SEED),
      REFUSE,
    );
    const rel = afterIntent(state, CONTACT, 'pitch-coercion');
    expect(out.pitch).toMatchObject({
      accepted: false,
      reported: false,
      suspicionDelta: PITCH_FAIL_SUSPICION,
    });
    expect(out.state.relationships[CONTACT]).toEqual({
      ...rel,
      suspicion: expect.closeTo(rel.suspicion + PITCH_FAIL_SUSPICION, 12),
    });
    expect(out.state.hostile).toBe(BASE.hostile);
    expect(out.state.player.coverSuspicion).toBe(BASE.player.coverSuspicion);
  });

  it('a reported refusal adds suspicionDelta, records the approach and raises Cover Suspicion by 0.1', () => {
    expect(PITCH_REPORTED_COVER_SUSPICION).toBe(0.1);
    const { state, scene } = staged(CONTACT);
    const out = applyDialogueTurn(
      state,
      scene,
      say('pitch-coercion'),
      createPrng(REPORTED_SEED),
      REFUSE,
    );
    const rel = afterIntent(state, CONTACT, 'pitch-coercion');
    expect(out.pitch).toMatchObject({
      accepted: false,
      reported: true,
      suspicionDelta: PITCH_BAD_SUSPICION,
    });
    expect(out.state.relationships[CONTACT]).toEqual({
      ...rel,
      suspicion: expect.closeTo(rel.suspicion + PITCH_BAD_SUSPICION, 12),
    });
    // The report changes nothing else in the Hostile Service.
    expect(out.state.hostile).toEqual({
      ...BASE.hostile,
      beliefs: { ...BASE.hostile.beliefs, suspectedApproaches: [CONTACT] },
    });
    expect(revealTruth(out.state.player.coverSuspicion)).toBeCloseTo(
      revealTruth(BASE.player.coverSuspicion) + PITCH_REPORTED_COVER_SUSPICION,
      12,
    );

    // A second report by the same NPC raises Cover Suspicion again but lists them once.
    const again = applyDialogueTurn(
      out.state,
      out.state.player.scene as TalkScene,
      say('pitch-coercion'),
      createPrng(REPORTED_SEED),
      REFUSE,
    );
    expect(again.state.hostile.beliefs.suspectedApproaches).toEqual([CONTACT]);
    expect(revealTruth(again.state.player.coverSuspicion)).toBeCloseTo(
      revealTruth(BASE.player.coverSuspicion) +
        2 * PITCH_REPORTED_COVER_SUSPICION,
      12,
    );
  });

  it('adds a reporter after the approaches already on file', () => {
    const staging = staged(CONTACT);
    const beliefs = {
      ...BASE.hostile.beliefs,
      suspectedApproaches: [STRANGER],
    };
    const state: WorldState = {
      ...staging.state,
      hostile: { ...BASE.hostile, beliefs },
    };
    const out = applyDialogueTurn(
      state,
      staging.scene,
      say('pitch-coercion'),
      createPrng(REPORTED_SEED),
      REFUSE,
    );
    expect(out.state.hostile.beliefs.suspectedApproaches).toEqual([
      STRANGER,
      CONTACT,
    ]);
  });

  it("clamps the NPC's suspicion and the Cover Suspicion at 1", () => {
    // pitch-ego takes suspicion to 0.85; the bad refusal's rise would pass 1.
    const wary: Relationship = {
      ...newRelationship(CONTACT),
      channel: true,
      suspicion: 0.8,
    };
    const staging = staged(CONTACT, wary);
    const state: WorldState = {
      ...staging.state,
      player: { ...staging.state.player, coverSuspicion: asTruth(0.95) },
    };
    const out = applyDialogueTurn(
      state,
      staging.scene,
      say('pitch-ego'),
      createPrng(REPORTED_SEED),
      REFUSE,
    );
    expect(out.pitch?.reported).toBe(true);
    expect(out.state.relationships[CONTACT]?.suspicion).toBe(1);
    expect(revealTruth(out.state.player.coverSuspicion)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Recent turns
// ---------------------------------------------------------------------------

describe('applyDialogueTurn: recent turns', () => {
  it.each(['ask', 'pitch-ideology'] as const)(
    "appends the player's line after the scene's turns and writes the scene to player.scene (%s)",
    (intent) => {
      const greeting: TalkSceneTurn = { speaker: 'npc', text: 'Good evening.' };
      const scene = sceneWith(CONTACT, [greeting]);
      const state: WorldState = { ...BASE, player: { ...BASE.player, scene } };
      const out = applyDialogueTurn(
        state,
        scene,
        say(intent, undefined, 'Where were you on Tuesday?'),
        createPrng('r'),
        WEIGHTS,
      );
      expect(out.state.player.scene).toEqual({
        ...scene,
        recent: [
          greeting,
          { speaker: 'player', text: 'Where were you on Tuesday?' },
        ],
      });
    },
  );

  it('keeps only the last RECENT_TURNS (6) turns, dropping the oldest', () => {
    expect(RECENT_TURNS).toBe(6);
    const full: TalkSceneTurn[] = Array.from(
      { length: RECENT_TURNS },
      (_, i) => ({
        speaker: i % 2 === 0 ? 'player' : 'npc',
        text: `turn ${i}`,
      }),
    );
    const scene = sceneWith(CONTACT, full);
    const state: WorldState = { ...BASE, player: { ...BASE.player, scene } };
    const out = applyDialogueTurn(
      state,
      scene,
      say('ask', undefined, 'newest'),
      createPrng('r'),
      WEIGHTS,
    );
    expect(out.state.player.scene?.recent).toEqual([
      ...full.slice(1),
      { speaker: 'player', text: 'newest' },
    ]);
    expect(appendRecentTurn([], { speaker: 'npc', text: 'x' })).toEqual([
      { speaker: 'npc', text: 'x' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

describe('applyDialogueTurn: contract', () => {
  it('does not mutate its inputs', () => {
    const { state, scene } = staged(CONTACT);
    const snapshot = JSON.stringify(state);
    applyDialogueTurn(
      state,
      scene,
      say('pitch-money', 10),
      createPrng(REPORTED_SEED),
      REFUSE,
    );
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('throws on an invalid offer or a money offer the Budget cannot cover', () => {
    const { state, scene } = staged(CONTACT);
    for (const offer of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        applyDialogueTurn(
          state,
          scene,
          say('pitch-money', offer),
          createPrng('o'),
          WEIGHTS,
        ),
      ).toThrow(RangeError);
    }
    const tooMuch = balance(BASE.station.ledger) + 1;
    expect(() =>
      applyDialogueTurn(
        state,
        scene,
        say('pitch-money', tooMuch),
        createPrng('o'),
        WEIGHTS,
      ),
    ).toThrow(RangeError);
  });

  it('throws when the scene NPC does not exist', () => {
    const scene = sceneWith('npc:nobody' as NpcId);
    expect(() =>
      applyDialogueTurn(BASE, scene, say('ask'), createPrng('n'), WEIGHTS),
    ).toThrow(/does not exist/);
  });
});

// ---------------------------------------------------------------------------
// assetProfileFor (Req 10.3, 10.6)
// ---------------------------------------------------------------------------

describe('assetProfileFor', () => {
  it('reads access from the schedule and the side the NPC serves, not from acquaintances', () => {
    const npc = BASE.npcs[CONTACT];
    const profile = assetProfileFor(npc, BASE.npcs);
    const access = revealTruth(profile.access);

    expect(access.locs).toEqual(
      [...new Set(npc.schedule.entries.map((e) => e.loc))].sort(),
    );
    expect(access.orgs).toEqual([revealTruth(npc.trueAllegiance).org]);
    // An Asset knows themself; people they merely share a café with are seen
    // through the events the Asset witnesses, not known from the inside.
    expect(access.npcs).toEqual([npc.id]);
    expect(profile.reliability).toBe(npc.reliability);
    expect(profile.turned).toBe(false);
    expect(revealTruth(profile.hostileControlled)).toBe(false);
  });
});
