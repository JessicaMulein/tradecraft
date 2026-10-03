/**
 * Building the preview world (`content-tools/preview/world`).
 *
 * The Preview CLI (content-expansion task 5.9; design, "Preview CLI") renders a
 * generated world through the `player-view` projections. This module owns the
 * step the renderers depend on: given an already-loaded Content Set and the
 * per-pack side-file data, it builds the engine's {@link GenerateInputs} for the
 * chosen city/preset/seed and runs the pure `generateGame` to produce the
 * ground-truth {@link WorldState} (and its seeded {@link TruthStore}).
 *
 * It mirrors the Composition Root's generation (`app/composition-root.ts`), but
 * without the LLM Gateway or the Turn Pipeline: a preview only needs the pure
 * generator and the pure projections, and the design is explicit that the
 * Preview CLI "has no `llm` import path" (Req 14.4). The one engine dependency
 * beyond `generate` is the world-advancing clock: two preview kinds —
 * `newspaper` and `fact-lines` — read material the day boundary produces, which
 * a freshly generated world has none of (the generator mints no newspapers and
 * seeds no past Sim events). So {@link buildPreviewWorld} optionally advances
 * the world a fixed, deterministic number of phases through the production
 * Day-Boundary Hooks so those kinds have real content to show, exactly as a
 * played game would after the same days.
 *
 * Everything here stays deterministic in `(content, city, preset, seed)`:
 * `generateGame` is pure, and the advance runs on a fixed runtime seed derived
 * from the game seed with no clock, file or model access. The CLI shell
 * ({@link import('./index.js').runPreview}) does the loading and hands the
 * already-loaded content here, so this module touches no filesystem.
 */

import {
  advanceWorld,
  buildWorldHooks,
  createPrng,
  generateGame,
  ScenarioConfigSchema,
  worldCipherKeyLookup,
  type AdvanceWorldDeps,
  type DifficultyPreset,
  type GenerateInputs,
  type ScenarioConfig,
  type TruthStore,
  type WorldState,
} from '@tradecraft/engine';
import type {
  CityData,
  ContentSet,
  DescriptorData,
  PublicText,
} from '@tradecraft/content';

/** Unit recruitment weights, so generation is deterministic and balanced for a
 * preview (the same shape the offline harnesses use). The preview never runs
 * recruitment, so the exact values do not matter; they only have to validate. */
const UNIT_RECRUITMENT = {
  pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
  firstContact: { a: 1, b: 1, c: 1, d: 1 },
  meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
  exposure: { k1: 1, k2: 1, k3: 1 },
  turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
} as const;

/** How many days the preview advances for the day-boundary kinds. The design's
 * `fact-lines` samples "the first 3 days", and `newspaper` wants a published
 * edition; four phases per day means 3 full days is 12 phases. */
export const PREVIEW_DAYS = 3;
/** Phases per game day (the four-phase daily timeline). */
const PHASES_PER_DAY = 4;

/** A failure building the preview world: an unknown city/preset or an
 * infeasible generation. The CLI reports the message and exits non-zero
 * (Req 14.5). */
export class PreviewWorldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreviewWorldError';
  }
}

/** The already-loaded pack data a preview is generated from: the merged Content
 * Set and the three per-pack side files the generator reads for its types (and,
 * on the Core City Path, its geometry). The CLI loads these from disk. */
export interface PreviewContent {
  readonly content: ContentSet;
  readonly cityData: CityData;
  readonly descriptors: DescriptorData;
  readonly publicTexts: readonly PublicText[];
}

/** What {@link buildPreviewWorld} needs beyond the loaded content: the selection
 * the CLI parsed. */
export interface PreviewWorldRequest {
  /** The city the game is placed in (`setting.city`); `'core'` by default. */
  readonly city: string;
  /** The Difficulty Preset id (bare or namespaced). */
  readonly preset: string;
  /** The game seed. */
  readonly seed: string;
  /** Whether to roll the clock forward so the day-boundary kinds have content. */
  readonly advanceDays: boolean;
}

/** The generated (and optionally advanced) preview world plus the content it
 * was built from, for the renderers to read. */
export interface PreviewWorld {
  readonly world: WorldState;
  readonly truth: TruthStore;
  readonly content: ContentSet;
}

/**
 * Generate the world for the request's city/preset/seed from the already-loaded
 * content, and — when `advanceDays` is set — roll the clock forward
 * {@link PREVIEW_DAYS} days through the production Day-Boundary Hooks so the
 * `newspaper` and `fact-lines` kinds have real content. Throws a
 * {@link PreviewWorldError} on an unknown preset or a generation failure.
 */
export function buildPreviewWorld(
  loaded: PreviewContent,
  request: PreviewWorldRequest,
): PreviewWorld {
  const scenario = buildScenario(loaded.content, request);
  const preset = resolvePreset(loaded.content, request.preset);

  const inputs: GenerateInputs = {
    content: loaded.content,
    preset,
    scenario,
    cityData: loaded.cityData,
    descriptors: loaded.descriptors,
    publicTexts: loaded.publicTexts,
  };

  let world: WorldState;
  let truth: TruthStore;
  try {
    const generated = generateGame(request.seed, inputs);
    world = generated.world;
    truth = generated.truth;
  } catch (err) {
    throw new PreviewWorldError(
      `generation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (request.advanceDays) {
    world = advancePreview(world, truth, loaded, request.seed);
  }

  return { world, truth, content: loaded.content };
}

// ---------------------------------------------------------------------------
// Scenario + preset
// ---------------------------------------------------------------------------

/**
 * Build the resolved {@link ScenarioConfig} for the request. A preview places
 * the game in `request.city` (the `setting.city` the design's `--city` maps to)
 * with a mole enabled (so Dossiers and the mole's traffic are present) and the
 * schema defaults otherwise. An unknown city is left for `generate` to reject,
 * which {@link buildPreviewWorld} surfaces as a {@link PreviewWorldError}.
 */
function buildScenario(content: ContentSet, request: PreviewWorldRequest): ScenarioConfig {
  void content;
  return ScenarioConfigSchema.parse({
    difficulty: { preset: request.preset },
    setting: { city: request.city },
    mole: true,
    recruitment: UNIT_RECRUITMENT,
  });
}

/**
 * Resolve a Difficulty Preset by id (bare or namespaced), as the Composition
 * Root does. Throws a {@link PreviewWorldError} on an unknown id so a bad
 * `--preset` fails loudly rather than generating under the wrong difficulty.
 */
function resolvePreset(content: ContentSet, id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new PreviewWorldError(`no difficulty preset "${id}" in the loaded Content Packs`);
}

// ---------------------------------------------------------------------------
// Advancing the clock (newspaper / fact-lines)
// ---------------------------------------------------------------------------

/**
 * Roll the generated world forward {@link PREVIEW_DAYS} days through the
 * production Day-Boundary Hooks, so the `newspaper` and `fact-lines` kinds have
 * the material a played game would have after the same days. The advance runs
 * on a fixed runtime stream derived from the game seed, with a stub Objective
 * Evaluator (the preview tracks no Directives) and the world's own cipher key
 * material; it is a pure function of the generated world and the seed.
 */
function advancePreview(
  world: WorldState,
  truth: TruthStore,
  loaded: PreviewContent,
  seed: string,
): WorldState {
  const deps: AdvanceWorldDeps = {
    content: loaded.content,
    cityData: loaded.cityData,
    hooks: buildWorldHooks(),
    // The preview evaluates no Directive objectives; a constant `false` keeps
    // the Directive check from marking anything met and stays deterministic.
    objectives: () => () => false,
    cipherKeys: worldCipherKeyLookup(world.meta.seed, world.documents),
    truth,
  };
  const rng = createPrng(`${seed}|preview-runtime`);
  const result = advanceWorld(world, PREVIEW_DAYS * PHASES_PER_DAY, rng, deps);
  return result.state;
}
