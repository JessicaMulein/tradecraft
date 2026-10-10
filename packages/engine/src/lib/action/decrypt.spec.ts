/**
 * Tests for the decrypt action (slice-integration task 2.1; Requirements 8.1–8.6).
 *
 * These drive a World State generated from the real core pack, whose
 * Transmissions carry real ciphertext Intercepts (every cipher kind the
 * standard preset allows), through `quoteDecrypt`/`resolveDecrypt`, checking:
 *
 * - the quote is allowed at 1 phase and no money for a collected Intercept,
 *   wherever the player stands, and disallowed with a reason for one the player
 *   has not collected (Req 8.1, 8.2);
 * - the true key, or the true plaintext, breaks the Intercept: it is marked
 *   `broken`, and its plaintext Propositions come back as Observations sourced
 *   `intercept`, with nothing else in the state changed (Req 8.3, 8.4);
 * - a repeat decrypt of broken traffic adds nothing (Req 8.6);
 * - every wrong submission gets the identical fixed result and changes nothing
 *   (Req 8.5);
 * - the key material comes from `ctx.cipherKeys` when supplied, and otherwise
 *   from the world's own lookup;
 * - through the top-level `quote`/`resolve` dispatch (task 2.6): a collected
 *   Intercept is allowed at every Location in every phase, an uncollected one
 *   is refused with the state left as it was, and `resolve` routes to this
 *   resolver for a break, a repeat and a reject.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

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

import { createPrng } from '../prng/prng.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import {
  revealTruth,
  type ChannelId,
  type DocId,
  type InterceptId,
  type LocId,
  type NpcId,
  type Phase,
  type Proposition,
} from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { Channel } from '../city/comms.js';
import {
  decryptToFieldMessage,
  generateIntercepts,
  revealedSpec,
  type Intercept,
} from '../cipher/intercept.js';
import {
  resolveCipherSpec,
  type CipherKeyLookup,
  type KeySubmission,
} from '../cipher/spec.js';
import { verifySubmission } from '../cipher/verify.js';
import { worldCipherKeyLookup } from '../cipher/world-intercepts.js';
import { quote, renderFactLines, resolve } from './action.js';
import {
  quoteDecrypt,
  resolveDecrypt,
  DECRYPT_ALREADY_BROKEN_LINE,
  DECRYPT_NOT_COLLECTED_REASON,
  DECRYPT_PHASE_COST,
  DECRYPT_REJECTED_LINE,
} from './decrypt.js';
import type { Observation, ResolverContext } from './result.js';
import type { DecryptAction } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors intercept.spec.ts)
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
  if (!content.ok) {
    throw new Error('core pack failed to load');
  }
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core pack side files failed to load');
  }
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
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

function inputs(): GenerateInputs {
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
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
    content,
    preset: preset('standard'),
    scenario,
    cityData,
    descriptors,
    publicTexts,
  };
}

const SEED = 'decrypt-alpha';
const WORLD: WorldState = generate(SEED, inputs());

/** The world's seeded Intercepts (traffic that happened), in id order. */
const SEEDED: readonly Intercept[] = WORLD.transmissions
  .map((tx) => tx.intercept)
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** The Intercept most tests work: the first seeded one. */
const INTERCEPT: Intercept = SEEDED[0];

/** The lookup generation enciphered the seeded traffic with. */
function worldKeys(state: WorldState = WORLD): CipherKeyLookup {
  return worldCipherKeyLookup(state.meta.seed, state.documents);
}

/** A copy of the state in which the player has collected `intercept`. */
function collect(state: WorldState, intercept: Intercept): WorldState {
  return {
    ...state,
    intercepts: { ...state.intercepts, [intercept.id]: intercept },
  };
}

function decryptAction(
  intercept: InterceptId,
  submission: KeySubmission,
): DecryptAction {
  return { kind: 'decrypt', intercept, submission };
}

/** The true key: the Intercept's own ground-truth spec. */
function trueKey(intercept: Intercept): KeySubmission {
  return { kind: 'key', spec: revealedSpec(intercept) };
}

/** The true recovered field message (any fixed-header crib stripped). */
function truePlaintext(
  intercept: Intercept,
  keys: CipherKeyLookup = worldKeys(),
): string {
  return decryptToFieldMessage(
    intercept,
    resolveCipherSpec(revealedSpec(intercept), keys),
  );
}

/** The Fact Line renderer the action framework hands every resolver. */
function render(
  state: WorldState,
  observations: readonly Observation[],
): string[] {
  return renderFactLines(content, state, observations);
}

/** A Resolver Context with no `cipherKeys`, so the world's own lookup is used. */
const CTX: ResolverContext = { content };

// ---------------------------------------------------------------------------
// Fixture sanity
// ---------------------------------------------------------------------------

describe('decrypt fixtures', () => {
  it('generates a world with seeded traffic and nothing collected yet', () => {
    expect(SEEDED.length).toBeGreaterThan(0);
    expect(Object.keys(WORLD.intercepts)).toEqual([]);
    // The traffic includes the ciphers that need key material, so the
    // world-lookup fallback is exercised for book texts and pads.
    const kinds = new Set(
      SEEDED.map((intercept) => revealedSpec(intercept).kind),
    );
    expect(kinds).toContain('book');
    expect(kinds).toContain('otp');
  });
});

// ---------------------------------------------------------------------------
// Quote (Req 8.1, 8.2)
// ---------------------------------------------------------------------------

describe('quoteDecrypt', () => {
  it('allows a collected Intercept at one phase and no money (Req 8.1)', () => {
    const state = collect(WORLD, INTERCEPT);
    expect(DECRYPT_PHASE_COST).toBe(1);
    expect(
      quoteDecrypt(state, decryptAction(INTERCEPT.id, trueKey(INTERCEPT))),
    ).toEqual({
      allowed: true,
      phases: 1,
      money: 0,
    });
    // The quote does not depend on the submission.
    const wrong = decryptAction(INTERCEPT.id, { kind: 'plaintext', text: '' });
    expect(quoteDecrypt(state, wrong)).toEqual({
      allowed: true,
      phases: 1,
      money: 0,
    });
  });

  it('disallows an Intercept the player has not collected (Req 8.2)', () => {
    const notCollected: readonly { state: WorldState; id: InterceptId }[] = [
      // Traffic that happened but was never intercepted.
      { state: WORLD, id: INTERCEPT.id },
      // An id that names no Intercept at all.
      {
        state: collect(WORLD, INTERCEPT),
        id: 'int:nothing-here' as InterceptId,
      },
      // An id that names an Object.prototype member, not a capture.
      {
        state: collect(WORLD, INTERCEPT),
        id: 'constructor' as unknown as InterceptId,
      },
    ];
    for (const { state, id } of notCollected) {
      expect(
        quoteDecrypt(state, decryptAction(id, trueKey(INTERCEPT))),
      ).toEqual({
        allowed: false,
        reason: DECRYPT_NOT_COLLECTED_REASON,
        phases: 0,
        money: 0,
      });
    }
  });

  it('allows Workbench work at every Location, and on broken traffic', () => {
    const state = collect(WORLD, INTERCEPT);
    const a = decryptAction(INTERCEPT.id, trueKey(INTERCEPT));
    for (const loc of Object.keys(state.city.locations) as LocId[]) {
      const there: WorldState = { ...state, player: { ...state.player, loc } };
      expect(quoteDecrypt(there, a).allowed).toBe(true);
    }
    const broken = collect(WORLD, { ...INTERCEPT, broken: true });
    expect(quoteDecrypt(broken, a)).toEqual({
      allowed: true,
      phases: 1,
      money: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Resolve: a correct break (Req 8.3, 8.4)
// ---------------------------------------------------------------------------

describe('resolveDecrypt: a correct submission', () => {
  it('breaks the Intercept and reports its plaintext as intercept Observations', () => {
    const state = collect(WORLD, INTERCEPT);
    const submission = trueKey(INTERCEPT);
    const { next, result } = resolveDecrypt(
      state,
      decryptAction(INTERCEPT.id, submission),
      CTX,
      render,
    );

    // The Intercept is marked broken, and nothing else in the state changed.
    expect(next.intercepts[INTERCEPT.id]).toEqual({
      ...INTERCEPT,
      broken: true,
    });
    expect({ ...next, intercepts: state.intercepts }).toEqual(state);

    // One Proposition Observation per recovered Proposition, stamped now and
    // sourced to the Intercept (Req 8.4).
    const expected = verifySubmission(
      INTERCEPT,
      submission,
      worldKeys(),
      content.predicates,
    );
    if (!expected.ok) {
      throw new Error('the true key must verify');
    }
    expect(result.observations).toEqual(
      expected.propositions.map((prop) => ({
        kind: 'proposition',
        prop,
        at: state.time,
        source: { kind: 'intercept', id: INTERCEPT.id, channel: INTERCEPT.channel },
      })),
    );
    // Exactly the Intercept's plaintext Propositions, by their true ids.
    const ids = expected.propositions.map((p: Proposition) => p.id);
    expect(ids).toEqual([...revealTruth(INTERCEPT.plaintextProps)]);
    expect(result.claimsAdded).toEqual(ids);

    // Fact Lines are the Observations rendered against the next state.
    expect(result.factLines).toEqual(render(next, result.observations));
    expect(result.factLines).toHaveLength(result.observations.length);
    expect(result.events).toEqual([]);
    expect(result.scene.loc).toBe(state.player.loc);
  });

  it('breaks the Intercept on the correct plaintext too', () => {
    const state = collect(WORLD, INTERCEPT);
    const { next, result } = resolveDecrypt(
      state,
      decryptAction(INTERCEPT.id, {
        kind: 'plaintext',
        text: truePlaintext(INTERCEPT),
      }),
      CTX,
      render,
    );
    expect(next.intercepts[INTERCEPT.id]?.broken).toBe(true);
    expect(result.claimsAdded).toEqual([
      ...revealTruth(INTERCEPT.plaintextProps),
    ]);
  });

  it('breaks every seeded Intercept with its true key, through the world lookup', () => {
    for (const intercept of SEEDED) {
      const state = collect(WORLD, intercept);
      const { next, result } = resolveDecrypt(
        state,
        decryptAction(intercept.id, trueKey(intercept)),
        CTX,
        render,
      );
      expect(next.intercepts[intercept.id]?.broken).toBe(true);
      expect(result.claimsAdded).toEqual([
        ...revealTruth(intercept.plaintextProps),
      ]);
    }
  });
});

// ---------------------------------------------------------------------------
// Resolve: broken traffic (Req 8.6)
// ---------------------------------------------------------------------------

describe('resolveDecrypt: already broken traffic', () => {
  it('adds nothing on a repeat decrypt, even with the true key', () => {
    const state = collect(WORLD, INTERCEPT);
    const a = decryptAction(INTERCEPT.id, trueKey(INTERCEPT));
    const first = resolveDecrypt(state, a, CTX, render);
    const again = resolveDecrypt(first.next, a, CTX, render);

    expect(again.next).toBe(first.next);
    expect(again.result.observations).toEqual([]);
    expect(again.result.claimsAdded).toEqual([]);
    expect(again.result.events).toEqual([]);
    expect(again.result.factLines).toEqual([DECRYPT_ALREADY_BROKEN_LINE]);
  });
});

// ---------------------------------------------------------------------------
// Resolve: wrong submissions (Req 8.5)
// ---------------------------------------------------------------------------

describe('resolveDecrypt: a wrong submission', () => {
  it('plays the fixed line, adds nothing, and is identical for every wrong submission', () => {
    const state = collect(WORLD, INTERCEPT);
    const spec = revealedSpec(INTERCEPT);
    const wrongShift = spec.kind === 'caesar' ? (spec.shift + 13) % 26 : 13;
    const wrong: KeySubmission[] = [
      { kind: 'key', spec: { kind: 'caesar', shift: wrongShift } },
      { kind: 'key', spec: { kind: 'otp', padId: 'pad:none' } },
      {
        kind: 'key',
        spec: {
          kind: 'book',
          textId: 'doc:none' as DocId,
          scheme: 'page-line-word',
        },
      },
      { kind: 'plaintext', text: '' },
      { kind: 'plaintext', text: `${truePlaintext(INTERCEPT)}X` },
    ];

    const results = wrong.map((submission) =>
      resolveDecrypt(
        state,
        decryptAction(INTERCEPT.id, submission),
        CTX,
        render,
      ),
    );
    for (const { next, result } of results) {
      expect(next).toBe(state);
      expect(result.factLines).toEqual([DECRYPT_REJECTED_LINE]);
      expect(result.observations).toEqual([]);
      expect(result.claimsAdded).toEqual([]);
      expect(result.events).toEqual([]);
      expect(result).toEqual(results[0].result);
    }
  });
});

// ---------------------------------------------------------------------------
// Key material
// ---------------------------------------------------------------------------

describe('resolveDecrypt: key material', () => {
  it('gives the same result with the world lookup supplied or left to the fallback', () => {
    const state = collect(WORLD, INTERCEPT);
    const a = decryptAction(INTERCEPT.id, trueKey(INTERCEPT));
    const fallback = resolveDecrypt(state, a, CTX, render);
    const supplied = resolveDecrypt(
      state,
      a,
      { content, cipherKeys: worldKeys() },
      render,
    );
    expect(supplied).toEqual(fallback);
  });

  it('verifies against ctx.cipherKeys when the caller supplies it', () => {
    // A book-cipher Intercept keyed to a text the world does not hold, so only
    // the supplied lookup can resolve its key.
    const bookDoc = 'doc:test-key-book' as DocId;
    const bookText = 'THEQUICKBROWNFOXJUMPSOVERTHELAZYDOG'.repeat(40);
    const keys: CipherKeyLookup = {
      publicText: (id) => (id === bookDoc ? bookText : undefined),
      pad: () => undefined,
    };
    expect(WORLD.documents[bookDoc]).toBeUndefined();

    const [first, second] = Object.keys(WORLD.npcs).sort() as NpcId[];
    const channel: Channel = {
      id: 'chan:test/book' as ChannelId,
      kind: 'radio',
      owner: WORLD.station.org,
      schedule: { period: 1, start: { day: 0, phase: 0 }, phase: 0 },
    };
    const prop: Proposition = {
      id: 'p:test:0',
      subject: first,
      predicate: 'MEETS_AT',
      object: second,
    };
    const { intercepts, order } = generateIntercepts(
      createPrng('decrypt-book'),
      [
        {
          id: 'tx:test-book',
          channel: channel.id,
          at: WORLD.time,
          ownerKind: 'hostile',
          origin: 'plot',
          propositions: [prop],
        },
      ],
      {
        channels: { [channel.id]: channel },
        fieldCodes: content.predicates,
        allowedCiphers: ['book'],
        tradecraftErrorProbability: 0,
        publicTextIds: [bookDoc],
        padIds: [],
        keyLookup: keys,
      },
    );
    const intercept = intercepts[order[0]];
    expect(revealedSpec(intercept).kind).toBe('book');

    const state = collect(WORLD, intercept);
    const { next, result } = resolveDecrypt(
      state,
      decryptAction(intercept.id, trueKey(intercept)),
      { content, cipherKeys: keys },
      render,
    );
    expect(next.intercepts[intercept.id]?.broken).toBe(true);
    expect(result.claimsAdded).toEqual(['p:test:0']);
    expect(result.observations).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Through the top-level quote/resolve dispatch (Req 8.1, 8.2; task 2.6)
// ---------------------------------------------------------------------------

describe('decrypt through the top-level quote and resolve', () => {
  const PHASES: readonly Phase[] = [0, 1, 2, 3];

  it('allows a collected Intercept at every Location and phase, for 1 phase and no money (Req 8.1)', () => {
    const state = collect(WORLD, INTERCEPT);
    const a = decryptAction(INTERCEPT.id, trueKey(INTERCEPT));
    // Workbench work has no Location, so neither a Location Type's allowed
    // actions nor its opening hours can refuse it.
    for (const loc of Object.keys(state.city.locations) as LocId[]) {
      for (const phase of PHASES) {
        const there: WorldState = {
          ...state,
          time: { ...state.time, phase },
          player: { ...state.player, loc },
        };
        expect(quote(there, a, CTX), `${loc} in phase ${phase}`).toEqual({
          allowed: true,
          phases: DECRYPT_PHASE_COST,
          money: 0,
        });
      }
    }
  });

  it('refuses an Intercept the player has not collected, and resolve leaves the state as it was (Req 8.2)', () => {
    const notCollected: readonly (readonly [WorldState, InterceptId])[] = [
      // Traffic that happened but was never intercepted.
      [WORLD, INTERCEPT.id],
      // An id that names no Intercept at all.
      [collect(WORLD, INTERCEPT), 'int:nothing-here' as InterceptId],
    ];
    for (const [state, id] of notCollected) {
      const a = decryptAction(id, trueKey(INTERCEPT));
      expect(quote(state, a, CTX)).toEqual({
        allowed: false,
        reason: DECRYPT_NOT_COLLECTED_REASON,
        phases: 0,
        money: 0,
      });
      const out = resolve(state, a, createPrng('decrypt-refused'), CTX);
      expect(out.next).toBe(state);
      expect(out.result.observations).toEqual([]);
      expect(out.result.factLines).toEqual([]);
      expect(out.result.claimsAdded).toEqual([]);
      expect(out.ended).toBeUndefined();
    }
  });

  it('routes resolve to the decrypt resolver for a break, a repeat and a reject', () => {
    const state = collect(WORLD, INTERCEPT);
    const right = decryptAction(INTERCEPT.id, trueKey(INTERCEPT));
    const wrong = decryptAction(INTERCEPT.id, { kind: 'plaintext', text: '' });

    // A correct break is exactly the decrypt resolver's result, with the Fact
    // Lines rendered through the core pack's templates (Req 8.3, 8.4).
    const broken = resolve(state, right, createPrng('decrypt-right'), CTX);
    expect(broken).toEqual(resolveDecrypt(state, right, CTX, render));
    expect(broken.next.intercepts[INTERCEPT.id]?.broken).toBe(true);
    expect(broken.result.claimsAdded).toEqual([
      ...revealTruth(INTERCEPT.plaintextProps),
    ]);
    // No money moves, and the clock is left to the Turn Pipeline.
    expect(broken.next.station.ledger).toBe(state.station.ledger);
    expect(broken.next.time).toEqual(state.time);
    expect(broken.ended).toBeUndefined();

    // Broken traffic still quotes allowed; a repeat adds nothing (Req 8.6).
    expect(quote(broken.next, right, CTX).allowed).toBe(true);
    const again = resolve(broken.next, right, createPrng('decrypt-again'), CTX);
    expect(again.next).toBe(broken.next);
    expect(again.result.observations).toEqual([]);
    expect(again.result.factLines).toEqual([DECRYPT_ALREADY_BROKEN_LINE]);

    // A wrong submission changes nothing and plays the fixed line (Req 8.5).
    const rejected = resolve(state, wrong, createPrng('decrypt-wrong'), CTX);
    expect(rejected.next).toBe(state);
    expect(rejected.result.observations).toEqual([]);
    expect(rejected.result.factLines).toEqual([DECRYPT_REJECTED_LINE]);
  });
});
