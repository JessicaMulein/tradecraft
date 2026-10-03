/**
 * Property 21 — **noise independence and solvability** (design, "Properties",
 * Property 21; Requirements 29.2, 29.5, 29.6).
 *
 * This is the dedicated, formal (fast-check) version of the property task 6.4's
 * `generate.noise.spec.ts` covers by example. It asserts the two halves of
 * Property 21 against the *real* core pack and the production `generate()` path:
 *
 * - **Independence (Req 29.5):** the noise generator is independent of the core.
 *   Changing the preset's `noiseCounts`/`noiseTrafficRatio` (zero noise vs. a
 *   heavier mix) leaves the CORE world byte-identical — the Plot, the Principal
 *   NPCs, the core Channels/Dead Drops, the Station block (chief/staff/mole/
 *   knowledge) and the player's cover and brief-derived core known entities are
 *   the same with or without noise and across different noise amounts. Noise
 *   only ADDS entities/beliefs; the one permitted touch of a known-entity list
 *   (appending a Background NPC's acquaintances to its *own* list) lives on the
 *   `npc:bg-*` entries, which are not part of the core projection.
 *
 * - **Noise is additive (Req 29.5):** the heavier-noise world's `npcs` is a
 *   superset of the lighter one's (every non-bg id present with equal value, and
 *   more `npc:bg-*` ids); the *core* channels (non-`chan:thread/…` /
 *   non-`chan:noise/…`) are byte-identical across mixes. A world with
 *   `backgroundNpcs: 0` / `sideThreads: 0` carries no `npc:bg-*` and no
 *   `chan:thread/…` ids. (Noise-traffic volume is set by `noiseTrafficRatio ×
 *   plot-signal-channel count`, not by a count field, and the preset schema
 *   requires `ratio.noise ≥ 1`, so a `chan:noise/…` channel is present whenever
 *   the core Plot has an interceptable signal channel — the "zero" mix zeroes
 *   Background NPCs and Side Threads, not the ratio-driven noise traffic.)
 *
 * - **Solvability preserved (Req 29.6):** for every seed and both mole settings,
 *   `generate()` returns a world — it would throw a noise-phase
 *   {@link GeneratorError} if the full-world re-verification failed, so a
 *   returned world is itself proof the discovery paths still hold with noise
 *   folded in. We also structurally re-check that the full world still carries
 *   its Plot stages and that none of the noise ids clobbered a core node.
 *   (Rebuilding a full `DiscoveryInputs` from the public `WorldState` is not
 *   possible — the verifier wants the generator's intermediate
 *   `GeneratedKnowledge`/`GeneratedPrincipals`/`GeneratedComms`, which the
 *   WorldState does not expose — so, exactly as `generate.noise.spec.ts` does,
 *   the re-verification assertion is the no-throw contract plus a structural
 *   re-check.)
 *
 * - **Side Threads have no Cell participants (Req 29.2):** every Side Thread's
 *   participants exclude every Cell member and hostile officer — derived from
 *   the world by the NPC `role` field (`cell-*`, `hostile-*`) — so a Side Thread
 *   never threads a Plot/Cell actor through the noise, and thus adds no false
 *   path through the Plot.
 *
 * This file owns a distinct filename from `generate.spec.ts`,
 * `generate.determinism.spec.ts`, `generate.solvability.spec.ts` and
 * `generate.noise.spec.ts` (which other tasks own), and reuses their loader +
 * `GenerateInputs` + `ScenarioConfig` construction pattern. It is a test-only
 * task; it modifies no production code.
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
  ScenarioConfigSchema,
  type ScenarioConfig,
} from './config/scenario-config.js';
import { generate, type GenerateInputs } from './generate.js';
import { BACKGROUND_ID_PREFIX } from './noise/background.js';
import { CELL_ROLE_IDS, HOSTILE_ROLE_IDS } from './city/principals.js';
import type { WorldState } from './model/state.js';

// ---------------------------------------------------------------------------
// Core-pack loader (mirrors generate.noise.spec.ts / generate.determinism.spec.ts)
// ---------------------------------------------------------------------------

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
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
    throw new Error(
      `core pack failed to load:\n${content.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) {
    throw new Error('city.yaml failed to load');
  }
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) {
    throw new Error('descriptors.yaml failed to load');
  }
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) {
    throw new Error('public texts failed to load');
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

const STANDARD = preset('standard');

function scenario(mole: boolean): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole,
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
}

/**
 * Build a {@link GenerateInputs} bundle with the standard preset's noise counts
 * overridden. Passing a thin override object keeps every other preset field
 * (plot shape, budget, doctrine, …) intact, so the ONLY thing varied between two
 * such bundles is the noise mix — which is exactly what Property 21's
 * independence clause needs to isolate.
 */
function inputsWithNoise(
  mole: boolean,
  noise: {
    readonly backgroundNpcs: number;
    readonly sideThreads: number;
    readonly rumours: number;
    readonly ratio: { readonly noise: number; readonly plot: number };
  },
): GenerateInputs {
  const tunedPreset: DifficultyPreset = {
    ...STANDARD,
    noiseCounts: {
      backgroundNpcs: noise.backgroundNpcs,
      sideThreads: noise.sideThreads,
      rumours: noise.rumours,
    },
    noiseTrafficRatio: noise.ratio,
  };
  return {
    content,
    preset: tunedPreset,
    scenario: scenario(mole),
    cityData,
    descriptors,
    publicTexts,
  };
}

/**
 * The lightest noise mix the preset schema permits: no Background NPCs, no Side
 * Threads, no Rumours. The traffic ratio is still a positive integer (the schema
 * requires `noise ≥ 1`), so this mix still mints the ratio-driven
 * `chan:noise/…` traffic over the core Plot's signal channels — only the
 * count-driven noise (Background NPCs, Side Threads, Rumours) is zeroed. It is
 * used for the core-independence comparison, where only the *core* projection is
 * compared and the noise channels are excluded.
 */
const ZERO_NOISE = {
  backgroundNpcs: 0,
  sideThreads: 0,
  rumours: 0,
  ratio: { noise: 1, plot: 1 },
} as const;

/** The standard preset's own noise mix, in the override shape. */
const STANDARD_NOISE = {
  backgroundNpcs: STANDARD.noiseCounts.backgroundNpcs,
  sideThreads: STANDARD.noiseCounts.sideThreads,
  rumours: STANDARD.noiseCounts.rumours,
  ratio: STANDARD.noiseTrafficRatio,
} as const;

/** A handful of fixed, readable seeds. generate() runs the full stream, so the
 *  seed set is small and the property run counts are modest. */
const SEEDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo-123'] as const;

// ---------------------------------------------------------------------------
// Id predicates and the core projection
// ---------------------------------------------------------------------------

/** True for a Background-NPC id (`npc:bg-*`), minted by the noise step. */
function isBackgroundId(id: string): boolean {
  return id.startsWith(`npc:${BACKGROUND_ID_PREFIX}-`);
}

/** True for a Side-Thread channel id (`chan:thread/…`). */
function isThreadChannelId(id: string): boolean {
  return id.startsWith('chan:thread/');
}

/** True for a Noise-Traffic channel id (`chan:noise/…`). */
function isNoiseChannelId(id: string): boolean {
  return id.startsWith('chan:noise/');
}

/** True for a noise-minted channel id (thread or noise-traffic). */
function isNoiseChannelKind(id: string): boolean {
  return isThreadChannelId(id) || isNoiseChannelId(id);
}

/**
 * The **core projection** of a world: everything Property 21 says noise must
 * leave byte-identical. It is the world with every noise addition stripped out —
 *
 * - `plot` — the Plot stage DAG, untouched by noise;
 * - `npcs` — only the non-`npc:bg-*` entries (the Principal roster);
 * - `channels` — only the non-`chan:thread/…` / non-`chan:noise/…` entries (the
 *   core comms channels);
 * - `deadDrops` — the core Dead Drops (noise mints none);
 * - `station` — chief, staff, mole and knowledge (noise never touches the
 *   Station);
 * - `player` — the cover and the player's known entities with any Background-NPC
 *   ids filtered out (the brief-derived core known set; a Background NPC could
 *   only be *appended*, never remove a core entity).
 *
 * Two worlds generated from the same seed with different noise settings must
 * have deep-equal core projections.
 */
function coreProjection(world: WorldState): {
  plot: WorldState['plot'];
  coreNpcs: Record<string, WorldState['npcs'][keyof WorldState['npcs']]>;
  coreChannels: Record<string, WorldState['channels'][keyof WorldState['channels']]>;
  deadDrops: WorldState['deadDrops'];
  station: {
    org: WorldState['station']['org'];
    chief: WorldState['station']['chief'];
    staff: WorldState['station']['staff'];
    mole: WorldState['station']['mole'];
    knowledge: WorldState['station']['knowledge'];
  };
  cover: WorldState['player']['cover'];
  coreKnownEntities: readonly string[];
} {
  const coreNpcs: Record<string, WorldState['npcs'][keyof WorldState['npcs']]> = {};
  for (const [id, npc] of Object.entries(world.npcs)) {
    if (!isBackgroundId(id)) {
      coreNpcs[id] = npc;
    }
  }
  const coreChannels: Record<
    string,
    WorldState['channels'][keyof WorldState['channels']]
  > = {};
  for (const [id, channel] of Object.entries(world.channels)) {
    if (!isNoiseChannelKind(id)) {
      coreChannels[id] = channel;
    }
  }
  return {
    plot: world.plot,
    coreNpcs,
    coreChannels,
    deadDrops: world.deadDrops,
    station: {
      org: world.station.org,
      chief: world.station.chief,
      staff: world.station.staff,
      mole: world.station.mole,
      knowledge: world.station.knowledge,
    },
    cover: world.player.cover,
    // A Background NPC can only be appended to a known-entity list (never a core
    // NPC's — only its own), so the player's brief-derived core known entities
    // are those that are not background ids.
    coreKnownEntities: world.player.known.entities
      .filter((id) => !isBackgroundId(id))
      .slice()
      .sort(),
  };
}

/**
 * The Cell members and hostile officers of a world, derived from each NPC's
 * `role` and `archetype`. A generated NPC carries the *archetype's* role in its
 * `role` field — the Cell/hostile archetypes group under the roles `'cell'` and
 * `'hostile-officer'` — while its `archetype` id is the specific local id
 * (`cell-leader`, `hostile-resident`, …). We match either, exactly as the Side
 * Thread generator's own `isSideThreadEligible` does, so the roster we exclude
 * is the authoritative Plot/Cell roster Req 29.2 names regardless of which field
 * carries the signal.
 */
const FORBIDDEN_ROLES: ReadonlySet<string> = new Set(['cell', 'hostile-officer']);
const FORBIDDEN_ARCHETYPES: ReadonlySet<string> = new Set<string>([
  ...CELL_ROLE_IDS,
  ...HOSTILE_ROLE_IDS,
]);

/** The bare local id of a (possibly namespaced `<pack>/<name>`) archetype id. */
function localArchetypeId(archetype: string): string {
  const slash = archetype.lastIndexOf('/');
  return slash === -1 ? archetype : archetype.slice(slash + 1);
}

function cellAndHostileIds(world: WorldState): Set<string> {
  const out = new Set<string>();
  for (const [id, npc] of Object.entries(world.npcs)) {
    if (
      FORBIDDEN_ROLES.has(npc.role) ||
      FORBIDDEN_ARCHETYPES.has(localArchetypeId(npc.archetype))
    ) {
      out.add(id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Property 21a — core independence under varying noise (Req 29.5)
// ---------------------------------------------------------------------------

describe('Property 21: the core world is independent of the noise settings (Req 29.5)', () => {
  // A bounded, well-formed noise mix: modest counts (generate() runs the full
  // stream per draw) and a positive integer traffic ratio.
  const noiseArb = fc.record({
    backgroundNpcs: fc.integer({ min: 1, max: 12 }),
    sideThreads: fc.integer({ min: 1, max: 3 }),
    rumours: fc.integer({ min: 0, max: 8 }),
    ratio: fc.record({
      noise: fc.integer({ min: 1, max: 4 }),
      plot: fc.integer({ min: 1, max: 2 }),
    }),
  });

  it(
    'zero noise and a heavier noise mix produce byte-identical core projections',
    () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...SEEDS),
          fc.boolean(),
          noiseArb,
          (seed, mole, heavy) => {
            const zero = generate(seed, inputsWithNoise(mole, ZERO_NOISE));
            const noisy = generate(seed, inputsWithNoise(mole, heavy));

            const zeroCore = coreProjection(zero);
            const noisyCore = coreProjection(noisy);

            // The heart of Property 21 independence: every core field is
            // byte-identical with or without noise, and across noise amounts.
            expect(noisyCore.plot).toEqual(zeroCore.plot);
            expect(noisyCore.coreNpcs).toEqual(zeroCore.coreNpcs);
            expect(noisyCore.coreChannels).toEqual(zeroCore.coreChannels);
            expect(noisyCore.deadDrops).toEqual(zeroCore.deadDrops);
            expect(noisyCore.station).toEqual(zeroCore.station);
            expect(noisyCore.cover).toEqual(zeroCore.cover);
            expect(noisyCore.coreKnownEntities).toEqual(zeroCore.coreKnownEntities);
          },
        ),
        { numRuns: 24 },
      );
    },
    120_000,
  );

  it(
    'two different non-zero noise mixes still share the same core projection',
    () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...SEEDS),
          fc.boolean(),
          noiseArb,
          noiseArb,
          (seed, mole, a, b) => {
            const worldA = generate(seed, inputsWithNoise(mole, a));
            const worldB = generate(seed, inputsWithNoise(mole, b));
            const coreA = coreProjection(worldA);
            const coreB = coreProjection(worldB);
            expect(coreB).toEqual(coreA);
          },
        ),
        { numRuns: 20 },
      );
    },
    120_000,
  );
});

// ---------------------------------------------------------------------------
// Property 21b — noise is purely additive (Req 29.5)
// ---------------------------------------------------------------------------

describe('Property 21: noise is additive — it only adds entities and channels (Req 29.5)', () => {
  const heavyArb = fc.record({
    backgroundNpcs: fc.integer({ min: 4, max: 12 }),
    sideThreads: fc.integer({ min: 1, max: 3 }),
    rumours: fc.integer({ min: 0, max: 8 }),
    ratio: fc.record({
      noise: fc.integer({ min: 1, max: 4 }),
      plot: fc.integer({ min: 1, max: 2 }),
    }),
  });

  it(
    'the heavier-noise world adds entities and channels over the lightest mix',
    () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...SEEDS),
          fc.boolean(),
          heavyArb,
          (seed, mole, heavy) => {
            const light = generate(seed, inputsWithNoise(mole, ZERO_NOISE));
            const noisy = generate(seed, inputsWithNoise(mole, heavy));

            // The lightest mix has NO count-driven noise: no Background NPCs,
            // no Side Threads, hence no chan:thread/… channels.
            expect(Object.keys(light.npcs).some(isBackgroundId)).toBe(false);
            expect(Object.keys(light.channels).some(isThreadChannelId)).toBe(false);
            expect(light.sideThreads.length).toBe(0);

            // NPCs: every lightest-mix id appears in the heavier world with an
            // equal value (the non-bg ids are the core roster — the lightest mix
            // has only those), and the heavier world adds background ids on top.
            for (const [id, npc] of Object.entries(light.npcs)) {
              expect(noisy.npcs[id as keyof typeof noisy.npcs]).toEqual(npc);
            }
            const noisyBg = Object.keys(noisy.npcs).filter(isBackgroundId);
            expect(noisyBg.length).toBe(heavy.backgroundNpcs);
            // The lightest mix's npcs are exactly the heavier world's non-bg set.
            const lightIds = Object.keys(light.npcs).sort();
            const noisyCoreIds = Object.keys(noisy.npcs)
              .filter((id) => !isBackgroundId(id))
              .sort();
            expect(noisyCoreIds).toEqual(lightIds);

            // Channels: every CORE channel id (non-noise) is byte-identical
            // across the two mixes — the noise merge never clobbered a core one.
            for (const [id, channel] of Object.entries(light.channels)) {
              if (!isNoiseChannelKind(id)) {
                expect(noisy.channels[id as keyof typeof noisy.channels]).toEqual(
                  channel,
                );
              }
            }
            // The heavier world mints Side-Thread channels the lightest mix lacks.
            const noisyThreadChannels = Object.keys(noisy.channels).filter(
              isThreadChannelId,
            );
            expect(noisyThreadChannels.length).toBeGreaterThan(0);

            // Side Threads: the heavier world grew them from none.
            expect(noisy.sideThreads.length).toBe(heavy.sideThreads);
          },
        ),
        { numRuns: 20 },
      );
    },
    120_000,
  );
});

// ---------------------------------------------------------------------------
// Property 21c — solvability is preserved with noise folded in (Req 29.6)
// ---------------------------------------------------------------------------

describe('Property 21: the full world (core + noise) stays solvable (Req 29.6)', () => {
  it(
    'generate() returns a verified world for every seed and both mole settings',
    () => {
      fc.assert(
        fc.property(fc.constantFrom(...SEEDS), fc.boolean(), (seed, mole) => {
          // generate() runs the real discovery verifier on the FULL world and
          // throws a noise-phase GeneratorError if re-verification fails, so a
          // returned world is proof the discovery paths still hold with noise.
          const world = generate(seed, inputsWithNoise(mole, STANDARD_NOISE));

          // Structural re-check: the full world still carries its Plot stages
          // (noise never removes a core target), and noise ids never clobbered a
          // core node — the core channels remain byte-identical to the zero-noise
          // world's, so no discovery path through a core node was broken.
          expect(world.plot.stages.length).toBeGreaterThan(0);

          const light = generate(seed, inputsWithNoise(mole, ZERO_NOISE));
          // The CORE channels (non-noise ids) are byte-identical to the
          // lightest mix's: no discovery path through a core node was broken.
          for (const [id, channel] of Object.entries(light.channels)) {
            if (!isNoiseChannelKind(id)) {
              expect(world.channels[id as keyof typeof world.channels]).toEqual(
                channel,
              );
            }
          }
          // Every core (non-bg) NPC is present and byte-identical.
          for (const [id, npc] of Object.entries(light.npcs)) {
            expect(world.npcs[id as keyof typeof world.npcs]).toEqual(npc);
          }
        }),
        { numRuns: 20 },
      );
    },
    120_000,
  );

  it(
    'a heavier noise mix never breaks solvability either',
    () => {
      const heavyArb = fc.record({
        backgroundNpcs: fc.integer({ min: 4, max: 12 }),
        sideThreads: fc.integer({ min: 1, max: 3 }),
        rumours: fc.integer({ min: 0, max: 8 }),
        ratio: fc.record({
          noise: fc.integer({ min: 1, max: 4 }),
          plot: fc.integer({ min: 1, max: 2 }),
        }),
      });
      fc.assert(
        fc.property(
          fc.constantFrom(...SEEDS),
          fc.boolean(),
          heavyArb,
          (seed, mole, heavy) => {
            // No throw ⇒ the full-world re-verification held for the heavier mix.
            expect(() =>
              generate(seed, inputsWithNoise(mole, heavy)),
            ).not.toThrow();
          },
        ),
        { numRuns: 20 },
      );
    },
    120_000,
  );
});

// ---------------------------------------------------------------------------
// Property 21d — Side Threads have no Cell participants (Req 29.2)
// ---------------------------------------------------------------------------

describe('Property 21: Side Threads seat no Cell member or hostile officer (Req 29.2)', () => {
  it(
    'every Side Thread participant is outside the Cell/hostile roster',
    () => {
      const heavyArb = fc.record({
        backgroundNpcs: fc.integer({ min: 4, max: 12 }),
        sideThreads: fc.integer({ min: 1, max: 3 }),
        rumours: fc.integer({ min: 0, max: 8 }),
        ratio: fc.record({
          noise: fc.integer({ min: 1, max: 4 }),
          plot: fc.integer({ min: 1, max: 2 }),
        }),
      });
      fc.assert(
        fc.property(
          fc.constantFrom(...SEEDS),
          fc.boolean(),
          heavyArb,
          (seed, mole, heavy) => {
            const world = generate(seed, inputsWithNoise(mole, heavy));
            const forbidden = cellAndHostileIds(world);
            // There really is a Cell/hostile roster to exclude (sanity).
            expect(forbidden.size).toBeGreaterThan(0);
            expect(world.sideThreads.length).toBe(heavy.sideThreads);
            for (const thread of world.sideThreads) {
              for (const participant of thread.participants) {
                expect(forbidden.has(participant)).toBe(false);
              }
            }
          },
        ),
        { numRuns: 20 },
      );
    },
    120_000,
  );
});
