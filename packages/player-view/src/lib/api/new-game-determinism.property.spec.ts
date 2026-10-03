/**
 * Property 51: New game determinism (slice-integration design, "Correctness
 * Properties"; task 9.2).
 *
 * **Validates: Requirements 12.4, 12.5.**
 *
 * > For any seed and preset, calling `newGame` twice with the same options
 * > produces deep-equal World States, Truth Stores and Case Files, and the Case
 * > File contains exactly the Starting Brief's lead Claims. (design, Property 51)
 *
 * `newGame` ({@link PlayerViewEngine.newGame}, slice-integration task 9.1) drives
 * a {@link GameFactory} — the facade's world-generation seam — then builds a
 * fresh Session and seeds its Case File with the Starting Brief's lead Claims.
 * The one non-deterministic read is the seed mint, and that only happens when
 * the caller gives no seed; given the *same* `(seed, preset, mole, narration)`
 * the whole game is a pure function of those options (Req 12.5). This spec pins:
 *
 *   - **Determinism (Req 12.5).** Two `newGame` calls with identical options
 *     produce deep-equal World States (`engine.state`) and deep-equal Case Files
 *     (`engine.caseFile.list()`), across both independent facades and a single
 *     facade restarted onto itself. The generated world carries its serialised
 *     PRNG state, so a divergent draw would surface in the deep-equal.
 *
 *   - **Lead seeding (Req 12.4).** The seeded Case File holds exactly the
 *     Starting Brief's lead Claims: one `document` Claim per Proposition the
 *     brief Cable asserts, sourced from that Cable, observed at the opening
 *     time — and nothing else. An independent oracle reads the brief Cable's
 *     asserted Propositions straight off the generated world and must match the
 *     facade's Case File one for one.
 *
 * The {@link GameFactory} built here mirrors the Composition Root's job
 * (slice-integration task 12.5): it is closed over the loaded Content Set and
 * the validated scenario, resolves the preset by id, overrides `mole` and
 * `narration` on the scenario, and runs the engine's `generateGame`. It is the
 * real factory contract, not a stub, so the determinism this pins is the
 * facade's own.
 *
 * The core-pack fixture pattern mirrors `resolver-projection.spec.ts` and
 * `turn-pipeline.spec.ts`; the fast-check shape mirrors the sibling
 * `*.property.spec.ts` files.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import fc from 'fast-check';
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
import {
  createPrng,
  generateGame,
  resolve,
  ScenarioConfigSchema,
  type DocId,
  type GenerateInputs,
  type NarrationMode,
  type Proposition,
  type ScenarioConfig,
  type WorldState,
} from '@tradecraft/engine';

import type { Claim } from '../casefile/casefile.js';
import { Journal } from '../journal/journal.js';
import { NotificationStore } from '../notify/store.js';
import { CaseFile } from '../casefile/casefile.js';
import { implicationRules, type BriefView } from '../casefile/evidence.js';
import { PlayerViewEngine } from './engine-api.js';
import type { GameFactory, NewGameOptions } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors resolver-projection.spec.ts)
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

function baseScenario(): ScenarioConfig {
  return ScenarioConfigSchema.parse({
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
}

// ---------------------------------------------------------------------------
// The GameFactory under test — the real Composition-Root contract.
//
// Closed over the loaded Content Set and the validated scenario, it resolves
// the preset by id, overrides `mole` and `narration` on the scenario, and runs
// the engine's `generateGame`. This is exactly what task 12.5's factory does;
// building the real one (not a stub) keeps the determinism this pins the
// facade's own.
// ---------------------------------------------------------------------------

function makeGameFactory(): GameFactory {
  return {
    generate(seed: string, opts: NewGameOptions) {
      // Resolve the preset by id; override `mole`/`narration` on the scenario.
      const resolvedPreset = preset(opts.preset);
      const scenario: ScenarioConfig = {
        ...baseScenario(),
        mole: opts.mole,
        narration: opts.narration,
      };
      const inputs: GenerateInputs = {
        content,
        preset: resolvedPreset,
        scenario,
        cityData,
        descriptors,
        publicTexts,
      };
      const { world, truth } = generateGame(seed, inputs);
      return { inputs, world, truth };
    },
  };
}

/**
 * A facade wired exactly as the Composition Root wires it for `newGame`: a
 * placeholder initial state and stores (`newGame` replaces every store in one
 * swap), the loaded content on the resolver context, and the real
 * {@link GameFactory}. The brief/rules the facade is constructed with are
 * stand-ins; `newGame` rebuilds them from the generated world.
 */
function makeEngine(): PlayerViewEngine {
  const seed = { world: generateGame('seed-init', {
    content,
    preset: STANDARD,
    scenario: baseScenario(),
    cityData,
    descriptors,
    publicTexts,
  }) };
  const EMPTY_BRIEF: BriefView = { hostileOrgs: [], hostileChannels: [], materiel: [] };
  return new PlayerViewEngine({
    state: seed.world.world,
    caseFile: new CaseFile(),
    journal: new Journal(),
    cityData,
    ctx: { content, truth: seed.world.truth },
    brief: EMPTY_BRIEF,
    rules: implicationRules([]),
    notifications: new NotificationStore(),
    truth: seed.world.truth,
    gameFactory: makeGameFactory(),
  });
}

// ---------------------------------------------------------------------------
// Oracle: the Starting Brief's lead Claims, read straight off the world.
//
// A newly generated world opens on exactly one Cable Document — the Starting
// Brief. Its asserted Propositions are the leads; each files as a `document`
// Claim sourced from that Cable, observed at the opening time. This mirrors
// `newGame`'s own seeding, derived independently so a match means both agree.
// ---------------------------------------------------------------------------

function expectedLeadClaims(world: WorldState): Array<{
  readonly source: { readonly kind: 'document'; readonly id: DocId };
  readonly prop: Proposition;
}> {
  const cable = Object.values(world.documents).find((d) => d.kind === 'cable');
  if (cable === undefined) return [];
  const props: Proposition[] = [];
  for (const propId of cable.asserts) {
    const prop = world.documentPropositions[propId];
    if (prop !== undefined) props.push(prop);
  }
  const id: DocId = cable.id;
  return props.map((prop) => ({ source: { kind: 'document', id }, prop }));
}

/** A compact, order-insensitive key for a seeded `document` lead Claim. */
function leadKey(c: {
  readonly source: Claim['source'];
  readonly prop: Proposition;
}): string {
  const src = c.source.kind === 'document' ? c.source.id : `?${c.source.kind}`;
  const { subject, predicate, object } = c.prop;
  return `${src}|${subject}|${predicate}|${object}`;
}

// ---------------------------------------------------------------------------
// Arbitraries: a seed string, a preset id, the mole flag and a narration mode.
// ---------------------------------------------------------------------------

const seedArb = fc.string({ minLength: 1, maxLength: 12 });
const narrationArb = fc.constantFrom<NarrationMode>('full', 'brief', 'off');
const optionsArb: fc.Arbitrary<NewGameOptions> = fc.record({
  seed: seedArb,
  preset: fc.constant('standard'),
  mole: fc.boolean(),
  narration: narrationArb,
});

// ---------------------------------------------------------------------------
// Property 51
// ---------------------------------------------------------------------------

describe('Property 51: New game determinism', () => {
  it('produces deep-equal World States for the same options across two facades (Req 12.5)', async () => {
    await fc.assert(
      fc.asyncProperty(optionsArb, async (opts) => {
        const a = makeEngine();
        const b = makeEngine();
        await a.newGame(opts);
        await b.newGame(opts);
        expect(a.state).toStrictEqual(b.state);
      }),
      { numRuns: 20 },
    );
  });

  it('produces deep-equal Case Files for the same options across two facades (Req 12.4, 12.5)', async () => {
    await fc.assert(
      fc.asyncProperty(optionsArb, async (opts) => {
        const a = makeEngine();
        const b = makeEngine();
        await a.newGame(opts);
        await b.newGame(opts);
        expect(a.caseFile.list()).toStrictEqual(b.caseFile.list());
      }),
      { numRuns: 20 },
    );
  });

  it('is deterministic when one facade is restarted onto itself (Req 12.5)', async () => {
    await fc.assert(
      fc.asyncProperty(optionsArb, async (opts) => {
        const engine = makeEngine();
        await engine.newGame(opts);
        const firstState = structuredClone(engine.state);
        const firstClaims = structuredClone(engine.caseFile.list());
        await engine.newGame(opts);
        expect(engine.state).toStrictEqual(firstState);
        expect(engine.caseFile.list()).toStrictEqual(firstClaims);
      }),
      { numRuns: 20 },
    );
  });

  it('seeds the Case File with exactly the Starting Brief lead Claims (Req 12.4)', async () => {
    await fc.assert(
      fc.asyncProperty(optionsArb, async (opts) => {
        const engine = makeEngine();
        await engine.newGame(opts);

        const claims = engine.caseFile.list();
        const expected = expectedLeadClaims(engine.state);

        // There is at least one lead to seed in a generated world.
        expect(expected.length).toBeGreaterThan(0);
        // Exactly the leads: same count, and every seeded Claim is a `document`
        // Claim sourced from the brief Cable with no extras.
        expect(claims.length).toBe(expected.length);

        const got = claims.map(leadKey).sort();
        const want = expected.map(leadKey).sort();
        expect(got).toStrictEqual(want);

        // Every seeded Claim is a `document` source observed at the opening
        // time, with no player grade or links — a plain filed lead.
        for (const claim of claims) {
          expect(claim.source.kind).toBe('document');
          expect(claim.observedAt).toStrictEqual(engine.state.time);
        }
      }),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// The seeded brief counts as read (found by the Scripted Full Games, task 18.1)
// ---------------------------------------------------------------------------

describe('newGame files the Starting Brief as read (Req 12.4; slice Req 30.4)', () => {
  it('marks the brief Cable read, so reading it again files no second copy of the leads', async () => {
    const engine = makeEngine();
    await engine.newGame({
      seed: 'brief-read',
      preset: 'standard',
      mole: false,
      narration: 'off',
    });

    const cable = Object.values(engine.state.documents).find(
      (d) => d.kind === 'cable',
    );
    expect(cable).toBeDefined();
    if (cable === undefined) return;

    // Seeding the leads was the Cable's first read.
    expect(engine.state.player.readDocuments).toEqual([cable.id]);
    expect(engine.views.document(cable.id)?.read).toBe(true);

    // A read of the brief is now a repeat read: it observes no Proposition, so
    // the leads are not filed again from the same source. (Before the fix each
    // lead was filed twice and every lead corroborated itself.)
    const { next, result } = resolve(
      engine.state,
      { kind: 'read', doc: cable.id },
      createPrng('brief-read'),
      { content },
    );
    expect(result.claimsAdded).toEqual([]);
    expect(result.observations.some((o) => o.kind === 'proposition')).toBe(
      false,
    );
    expect(next.player.readDocuments).toEqual([cable.id]);
  });
});
