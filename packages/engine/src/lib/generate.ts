/**
 * The world generator's top-level `generate()` entry point: step 9 of the
 * design's "World Generator" — the capstone that wires the already-implemented
 * core-stream steps (tasks 5.1–5.8) into one pure function that produces a
 * {@link WorldState} (design, "World Generator"; Requirements 1.2, 1.6).
 *
 * The design's signature is
 *
 * ```ts
 * generate(seed, content, preset, scenario): WorldState // pure
 * ```
 *
 * and `generate` here matches it, with one documented extension: the step
 * modules read three pieces of pack data that the merged {@link ContentSet}
 * does *not* carry — the city's `city.yaml` ({@link CityData}), its
 * `descriptors.yaml` ({@link DescriptorData}) and its public-text corpora
 * ({@link PublicText}[]). The core-stream specs
 * (`starting-brief.spec.ts`, `discovery.spec.ts`) load those three separately
 * from the pack directory, so `generate` takes them alongside the
 * {@link ContentSet} in a single {@link GenerateInputs} bundle. The design's
 * four arguments all appear on that bundle; the extra three are the data the
 * loaders expose per pack rather than on the Content Set.
 *
 * ## The core stream and the retry loop
 *
 * Generation runs the ten core-stream steps in order on the **core PRNG
 * stream**, seeded by the game seed. Steps 1–9 build the world; step 10 is the
 * discovery-path verifier (task 5.8), the acceptance gate: it checks that every
 * Plot Stage key fact and (when a mole is enabled) the mole's identity have two
 * node-disjoint human/signal discovery paths rooted at the Starting Brief
 * (Requirement 1.4). When the gate fails, the whole core stream is re-run on a
 * fresh seed `derive(seed, attempt)` for the next attempt (design, step 10;
 * `derive(seed, attempt)`), up to {@link MAX_GENERATION_ATTEMPTS} tries. If the
 * limit is exhausted without a verifiable world, a {@link GeneratorError} is
 * thrown that names the seed, the attempt count and the failing target reason
 * (Requirement 1.6).
 *
 * ## Determinism (Requirement 1.2)
 *
 * `generate` is a pure function of `(seed, content, preset, scenario)` (plus the
 * pack data): every random choice is drawn from the core PRNG stream in a fixed
 * order, exactly as the step modules do, and the discovery verifier makes no
 * draws. The only field that could vary — the display seed — is required of the
 * caller; {@link randomSeed} is a *separate*, impure sibling for callers that
 * need a fresh seed, kept out of the pure path. So the same inputs always
 * produce an identical {@link WorldState}, which is the determinism contract
 * save/replay rests on.
 *
 * ## PRNG stream registry (design, "PRNG streams")
 *
 * The design fixes a registry of PRNG streams, each a `derive(seed, offset)`
 * sub-stream so one subsystem's draws never shift another's:
 *
 * - **core** — seeded by `seed` directly; retry attempt *k* re-seeds the whole
 *   core stream with `derive(seed, k)`. Steps 1–9 all draw from it in order.
 * - **noise** — `derive(seed, 0x10000)` ({@link NOISE_STREAM_BASE}). The noise
 *   generator runs here *after* the core world is verified: its four steps
 *   (Background NPCs, Side Threads, Rumours, Noise Traffic) draw from this
 *   stream, a retry re-seeds the whole noise stream with `derive(noiseSeed, k)`,
 *   and the full world is re-verified (see "The noise stream" below).
 * - **daily** — `derive(seed, 0x20000 + day)`. Already owned by the city's
 *   weather draw ({@link DAILY_STREAM_BASE} in `./city/city.ts`); referenced,
 *   never duplicated.
 * - **brief** — `derive(seed, 0x62726966)`. Owned by the Starting Brief
 *   (`BRIEF_STREAM_INDEX` in `./city/starting-brief.ts`); the brief step draws
 *   on it so adding a brief draw does not shift the core stream.
 * - **carry** — `derive(derive(postingSeed, 0x60000), j)` for carry attempt *j*
 *   (block `0x60000`–`0x6FFFF`). Used only when a Posting Context is passed.
 *   Arc threads use `derive(derive(postingSeed, 0x61000), j)` inside that block.
 * - **setting** — `derive(seed, 0x30000 + j)` for setting attempt *j* (block
 *   `0x30000`–`0x30FFF`, {@link import('./setting/stream.js').SETTING_STREAM_BASE}).
 *   Owned by the content-expansion setting step (`./setting/`): the Start Date
 *   draw, the Instantiated City selection and, on the Core City Path, the
 *   slice's step 1 run on this stream instead of the core stream, so the core
 *   stream starts at step 2 for the Core City (content-expansion Req 9.10,
 *   9.11). The slice PRNG stream registry (`.kiro/specs/tradecraft/design.md`)
 *   allocates this block to content-expansion; task 3.8 wires the setting step
 *   into `generate` and moves the hostile doctrine draw (see
 *   {@link HOSTILE_STREAM_BASE}) off its current `0x30000` reuse so the two no
 *   longer overlap.
 */

import type {
  ContentSet,
  CityData,
  DescriptorData,
  PublicText,
  DifficultyPreset,
  PlotTemplate,
} from '@tradecraft/content';

import { createPrng, derive } from './prng/prng.js';
import type { PrngState } from './prng/prng.js';
import { asTruth, revealTruth } from './model/core.js';
import type {
  ChannelId,
  DeadDropId,
  DocId,
  EntityId,
  GameTime,
  LocId,
  NpcId,
  OrgId,
  PropId,
  Proposition,
  UnkId,
} from './model/core.js';
import type {
  WorldState,
  ScenarioConfig,
  ContentManifest,
} from './model/state.js';
import { generateCity } from './city/generate.js';
import { DAILY_STREAM_BASE } from './city/city.js';
import { generateOrgs, generatePrincipals } from './city/principals.js';
import { generatePlot } from './city/plot.js';
import { initAmbient } from './ambient/init.js';
import { anchorsOf, storedWitnesses, verifierResult } from './ambient/solvability.js';
import { graphFromWitnesses, registerRegionGraph } from './region/verify.js';
import type { BindCity } from './plotgen/bind.js';
import { SELECT_STREAM } from './plotgen/index.js';
import { bindCityFromView, buildLibrarySession, LibrarySelectionError, slicePlotOf } from './plotgen/library.js';
import { materialiseTwists, twistGroundTruth } from './plotgen/twists.js';
import { libraryPreset } from './plotgen/preset.js';
import { fillLookalikeShare, type LookalikeFill } from './plotgen/sidethread.js';
import type { TemplateHistory } from './plotgen/select.js';
import {
  fallbackSelect,
  selectPlot,
  type PostingPlotSelection,
} from './plot-select.js';
import { applyPostingCarry, serviceDisplayName } from './carry/apply.js';
import type { PostingContext } from './carry/types.js';
import {
  generateComms,
  withDeadDropSites,
  isInterceptableKind,
  type Channel,
} from './city/comms.js';
import { assignKnowledge } from './city/knowledge.js';
import type {
  GeneratedKnowledge,
  KnowledgeSlice,
  NpcKnowledge,
} from './city/knowledge.js';
import type { Npc } from './city/npc.js';
import {
  generateBackgroundNpcs,
  type GeneratedBackgroundNpcs,
} from './noise/background.js';
import {
  generateSideThreads,
  type GeneratedSideThreads,
} from './noise/side-threads.js';
import {
  generateRumours,
  generateNoiseTraffic,
  type GeneratedRumours,
  type GeneratedNoiseTraffic,
} from './noise/rumours.js';
import {
  generateStartingBrief,
  type StartingBrief,
} from './city/starting-brief.js';
import {
  verifyDiscoveryPaths,
  type DiscoveryResult,
  type FailedTarget,
} from './city/discovery.js';
import { seedWorldIntercepts } from './cipher/world-intercepts.js';
import { whereaboutsAt } from './clock/schedules.js';
import { settingStreamSeed } from './setting/stream.js';
import {
  drawSetting,
  yearFilter,
  SettingError,
  type SettingSelection,
} from './setting/setting.js';
import { isContentSetV2, type ContentSetV2 } from './setting/content-set-v2.js';
import { instantiateCity } from './setting/instantiate-city.js';
import { foldInstantiatedCity } from './setting/fold-city.js';
import { cityView, type CityView } from './setting/city-view.js';
import { NO_USAGE_SINK, type UsageSink } from './setting/usage-sink.js';
import { parseIsoDate } from '@tradecraft/content';
import { composePublicTexts } from './docs/public-text.js';
import { composeDossier } from './docs/dossier.js';
import type { ComposedDocument, Document } from './docs/document.js';
import type { NamerContext } from './docs/namer.js';
import { createLedger } from './station/ledger.js';
import { initialHostileServiceState } from './hostile/hostile.js';
import { TruthStore } from './truth/truth.js';
import type { Allegiance } from './truth/truth.js';
import type { DocumentTemplate } from '@tradecraft/content';

// ---------------------------------------------------------------------------
// PRNG stream registry constants
// ---------------------------------------------------------------------------

/**
 * The base offset of the **noise** PRNG stream (design, "PRNG stream
 * registry"): `derive(seed, 0x10000)`. The noise generator (task 6.x) draws
 * Background NPCs, Side Threads, Rumours and Noise Traffic from this stream so
 * its draws stay fully independent of the core world (Requirement 29.5).
 * `generate` seeds the first noise attempt with `derive(seed, NOISE_STREAM_BASE)`
 * and each retry with `derive(thatNoiseSeed, k)`.
 */
export const NOISE_STREAM_BASE = 0x10000;

/**
 * The base offset of the **hostile** PRNG stream: the Hostile Service's
 * generation-time doctrine draw (task 19.1; Requirement 12.1) rides this stream
 * so the three doctrine samples are deterministic from the seed and independent
 * of the core and noise streams — adding or changing a doctrine draw never
 * shifts a core/noise draw. The runtime hostile ticks draw from the saved
 * runtime PRNG (and the daily stream via the clock hook), not this
 * generation-time stream.
 *
 * The value spells `host`, following the brief stream's `brif` convention of a
 * mnemonic ASCII constant placed outside every allocated PRNG-stream block
 * (slice design, "PRNG stream registry"). It originally reused `0x30000`, but
 * content-expansion claims the block `0x30000`–`0x30FFF` for the **setting**
 * stream ({@link import('./setting/stream.js').SETTING_STREAM_BASE}), so the
 * hostile doctrine draw moves off `0x30000` here to keep the two streams
 * independent (content-expansion design, "PRNG streams"). Moving it changes the
 * doctrine samples for a given seed, which is covered by the shared
 * `generatorVersion` bump and the once-only golden-replay re-record this task
 * performs.
 */
export const HOSTILE_STREAM_BASE = 0x686f7374;

/**
 * The **daily** PRNG stream base, re-exported from the city module (design:
 * `derive(seed, 0x20000 + day)`). The daily weather draw already owns it; it is
 * surfaced here only so the whole stream registry reads from one place. It is
 * never re-derived by the generator.
 */
export { DAILY_STREAM_BASE };

/**
 * The **region** PRNG stream (multi-city design, stream table): `derive(seed,
 * 0x70000)`. The block `0x70000`–`0x7FFFF` is reserved on the game seed. Per-city
 * core, noise, daily, spine and ambient streams derive from that region seed.
 * `generate` does not draw it, so a slice world is unchanged and
 * `generatorVersion` stays put.
 */
export { REGION_STREAM_BASE } from './region/streams.js';

/**
 * The generator version string, part of the determinism key (Requirement 1.2:
 * "same (seed, generatorVersion, ContentManifest, DifficultyPreset) ⇒ identical
 * WorldState"). It is bumped whenever a change to the generator would produce a
 * different world from the same seed, so a save or replay produced under an old
 * version can be told apart from one produced under a new one. A date-tagged
 * `0.y.m.d` form is used while the engine is pre-1.0 and the generator is still
 * taking shape; it moves to semver at the first stable release.
 *
 * Bumped to `0.6.0` for the content-expansion setting step (slice step 1 moves
 * to the setting stream, also on the Core City Path, and the hostile doctrine
 * draw moves off the `0x30000` block the setting stream now owns). This is the
 * single bump shared with plot-library (content-expansion design, "Setting
 * selection, generator version"); plot-library declares no separate bump, and
 * the slice golden replays are re-recorded once under it.
 *
 * Bumped to `0.7.0` when plot and Side Thread trace `place` templates moved
 * from a hard-coded Location-Type id to a Tag Query (`place.query`): a trace
 * now binds its Location through the city's Effective Tags, so the same seed
 * can resolve a different (but still valid and surveillable) Location for a
 * stage's event. The golden replays are re-recorded once under this version.
 */
export const GENERATOR_VERSION = '0.7.0';

/**
 * The arrest authority the player starts a game with. The arrest gate needs
 * some left (slice design, "Arrest Evidence"), and only a wrongful arrest
 * spends it, by the preset's `arrest.wrongfulAuthorityPenalty` (slice Req
 * 19.2). Two is the entry-rank (Case Officer) figure in the campaign-career
 * Rank table, so on the hard preset one wrongful arrest uses it all up.
 */
export const STARTING_ARREST_AUTHORITY = 2;

/**
 * The maximum number of core-stream generation attempts before giving up
 * (Requirement 1.6). The design fixes the retry rule — on a failed
 * discovery-path check, re-run the core stream on `derive(seed, attempt)` — but
 * leaves the ceiling to the implementation. Eight is chosen to match the noise
 * generator's own retry ceiling (design, task 6.4: "retry with the next noise
 * seed", up to 8), so the two retry loops share one documented budget; it is
 * comfortably more attempts than the discovery verifier needs for a well-formed
 * content pack (which passes on the first attempt for every seed the core-pack
 * specs exercise), while still bounding generation so a pathological pack fails
 * loudly rather than looping forever.
 */
export const MAX_GENERATION_ATTEMPTS = 8;

/**
 * The maximum number of **noise-stream** attempts before giving up (design,
 * Noise Generator: "retries with the next noise seed, up to 8 attempts";
 * Requirement 29.6). The noise stream runs *after* a verified core world: the
 * four noise steps run on `derive(seed, 0x10000)` (first attempt) and
 * `derive(thatNoiseSeed, k)` (retry *k*), the full world is re-verified, and on
 * a failed re-verification the noise is regenerated from the next noise seed.
 * This is a separate budget from {@link MAX_GENERATION_ATTEMPTS} (the core loop)
 * so that changing the noise retry ceiling never perturbs the core stream; it is
 * set equal to it because the design fixes both at eight.
 */
export const MAX_NOISE_ATTEMPTS = 8;

/**
 * Ambient init retries (ambient-world Req 3.4). Attempt k draws
 * `derive(derive(seed, 0x50000), k)`. The slice graph is unchanged, so a
 * well-formed pack passes on the first attempt; the ceiling matches noise.
 */
export const MAX_AMBIENT_ATTEMPTS = 8;

/**
 * The maximum number of **setting** attempts before giving up (content-expansion
 * design, "City instantiation"; Req 9.9: "After 4 setting attempts it throws
 * `GeneratorError { seed, city }`"). The setting step runs *before* the core
 * stream: for setting attempt *j* it opens the setting stream
 * `derive(seed, 0x30000 + j)`, draws the Start Date and builds the city (the
 * Core City Path's `generateCity`, or `instantiateCity` for a City Pack). When
 * the core retry loop is exhausted for the city built at attempt *j* — or the
 * city instantiation stays `'infeasible'` — the generator advances to setting
 * attempt *j* + 1 with a fresh setting stream, and when the budget is exhausted
 * a {@link GeneratorError} naming the seed and the city is thrown.
 */
export const MAX_SETTING_ATTEMPTS = 4;

// ---------------------------------------------------------------------------
// GeneratorError
// ---------------------------------------------------------------------------

/**
 * Thrown when world generation cannot produce a world that passes the
 * discovery-path verifier within {@link MAX_GENERATION_ATTEMPTS} attempts
 * (Requirement 1.6). The message names the seed, the attempt count and the
 * failing target reason from the last {@link DiscoveryResult}, so a developer
 * can reproduce the failing seed and see which Plot Stage (or the mole) had no
 * viable pair of discovery paths. The structured fields are kept on the error
 * for programmatic handling (a start screen can surface the seed and offer to
 * reroll).
 */
export class GeneratorError extends Error {
  /** The game seed generation was attempted for. */
  readonly seed: string;
  /** How many attempts were made before giving up. */
  readonly attempts: number;
  /** The failing target from the last attempt's discovery result, if any. */
  readonly lastFailure?: FailedTarget;
  /**
   * Which generation phase exhausted its attempts: the `core` stream (steps
   * 1–10), the `noise` stream's re-verification (design, Noise Generator;
   * Requirement 29.6) or the `setting` step (content-expansion Req 9.9: a city
   * instantiation that stayed infeasible across every setting attempt, or a
   * core/setting retry budget exhausted). All three loops throw this one error
   * naming the seed, so a caller can tell the failures apart and reroll
   * accordingly.
   */
  readonly phase: 'core' | 'noise' | 'setting' | 'ambient' | 'carry' | 'region';
  /**
   * The city the game was placed in when generation failed (content-expansion
   * Req 9.9: `GeneratorError { seed, city }`). `'core'` for the Core City or a
   * loaded City id for a City Pack. Left undefined for a slice-era failure that
   * ran no setting step.
   */
  readonly city?: string;

  constructor(
    seed: string,
    attempts: number,
    lastFailure?: FailedTarget,
    phase: 'core' | 'noise' | 'setting' | 'ambient' | 'carry' | 'region' = 'core',
    city?: string,
  ) {
    const reason =
      phase === 'setting' && lastFailure === undefined
        ? 'city instantiation stayed infeasible'
        : lastFailure === undefined
          ? 'no discovery result was produced'
          : lastFailure.reason;
    const where = city === undefined ? '' : ` (city "${city}")`;
    super(
      `world generation failed for seed "${seed}"${where} in the ${phase} stream ` +
        `after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${reason}`,
    );
    this.name = 'GeneratorError';
    this.seed = seed;
    this.attempts = attempts;
    this.phase = phase;
    if (lastFailure !== undefined) {
      this.lastFailure = lastFailure;
    }
    if (city !== undefined) {
      this.city = city;
    }
  }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Everything `generate` needs from the content layer. The design's four
 * `generate` arguments are `content`, `preset` and `scenario` (plus the `seed`,
 * which `generate` takes positionally); the remaining three fields are the pack
 * data the content loaders expose per pack directory rather than on the merged
 * {@link ContentSet} — exactly what the core-stream specs load separately.
 */
export interface GenerateInputs {
  /** The merged Content Set (registries, predicates, manifest). */
  readonly content: ContentSet;
  /** The resolved Difficulty Preset (the scenario loader's resolved preset). */
  readonly preset: DifficultyPreset;
  /** The resolved scenario config (its `mole` flag drives step 7). */
  readonly scenario: ScenarioConfig;
  /** The city's `city.yaml` data (districts, name pools, weather tables). */
  readonly cityData: CityData;
  /** The city's `descriptors.yaml` data (persona/descriptor pools). */
  readonly descriptors: DescriptorData;
  /** The pack's public-text corpora (book-cipher key material). */
  readonly publicTexts: readonly PublicText[];
}

/**
 * The injectable discovery gate, for testing the retry loop. Production uses the
 * real {@link verifyDiscoveryPaths}; a test can supply an always-failing verifier
 * to exercise the {@link GeneratorError} path without needing a pathological
 * content pack (Requirement 1.6). The function must be pure — it makes no draws —
 * so swapping it does not break determinism.
 */
export type DiscoveryVerifier = typeof verifyDiscoveryPaths;

/** Options that tune the generation loop. Not part of the design signature. */
export interface GenerateOptions {
  /**
   * The discovery gate (step 10). Defaults to {@link verifyDiscoveryPaths}; a
   * test overrides it to drive the core retry/{@link GeneratorError} path.
   */
  readonly verifier?: DiscoveryVerifier;
  /**
   * The maximum core-stream attempts before giving up. Defaults to
   * {@link MAX_GENERATION_ATTEMPTS}.
   */
  readonly maxAttempts?: number;
  /**
   * The discovery gate re-run on the full world *after* the noise stream is
   * folded in (design, Noise Generator; Requirement 29.6). Defaults to the same
   * {@link verifyDiscoveryPaths}; a test overrides it to force the noise
   * re-verification to fail and drive the noise retry/{@link GeneratorError}
   * path without needing a pathological pack. Like the core verifier it must be
   * pure (it makes no draws), so swapping it does not break determinism.
   */
  readonly noiseVerifier?: DiscoveryVerifier;
  /**
   * The maximum noise-stream attempts before giving up. Defaults to
   * {@link MAX_NOISE_ATTEMPTS}.
   */
  readonly maxNoiseAttempts?: number;
  /**
   * The discovery gate re-run after ambient init (ambient-world Req 3.4).
   * Defaults to {@link verifyDiscoveryPaths}. A test can fail it to drive the
   * ambient retry. It must be pure.
   */
  readonly ambientVerifier?: DiscoveryVerifier;
  /**
   * Ambient init attempts before {@link GeneratorError}. Defaults to
   * {@link MAX_AMBIENT_ATTEMPTS}.
   */
  readonly maxAmbientAttempts?: number;
  /**
   * The maximum setting-stream attempts before giving up (content-expansion
   * Req 9.9). Defaults to {@link MAX_SETTING_ATTEMPTS}.
   */
  readonly maxSettingAttempts?: number;
  /**
   * An optional **write-only** usage collector (content-expansion task 3.8;
   * design, "Coverage Report"). When supplied, the setting and naming steps
   * call `use(kind, id)` on it for each content item they draw (Culture Groups,
   * Descriptor Fragments, Locations, Cover Identities). The generator never
   * reads the sink, so the generated world is byte-identical with or without it
   * (design, Property 14). The Coverage Report (task 5.11) passes a collecting
   * sink; production passes none and the generator uses {@link NO_USAGE_SINK}.
   */
  readonly usage?: UsageSink;
  /**
   * Template History for plot selection. Read only after the setting step, and
   * only when `scenario.plotSelection.enabled`. Omitted, selection sees an
   * empty history. The setting step does not read it, so Districts, Locations
   * and Routes stay fixed across histories (plot-library Req 14.4).
   */
  readonly history?: TemplateHistory;
  /**
   * Set only for a posting. Step 4 then uses {@link selectPlot} instead of the
   * slice's uniform template draw. Omitted, step 4 is unchanged.
   */
  readonly posting?: PostingPlotSelection;
}

// ---------------------------------------------------------------------------
// Random display seed (impure sibling, kept out of the pure path)
// ---------------------------------------------------------------------------

/** The alphabet a fresh display seed is drawn from: unambiguous, lower-case. */
const SEED_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/** The length of a fresh display seed. */
const SEED_LENGTH = 8;

/**
 * Mint a fresh, short, human-readable display seed for a new game (design,
 * step 9: "seed generation and display").
 *
 * This is the **impure** sibling of {@link generate}: it reads a source of
 * entropy (`crypto.getRandomValues` when available, else `Math.random`), so it
 * is deliberately kept out of the pure generation path. A caller that has no
 * seed calls `randomSeed()` once, then hands the result to `generate`, which
 * stays a pure function of that seed (Requirement 1.2). The seed is a short
 * string a player can read off the start screen, write down and re-enter to
 * replay the same world.
 */
export function randomSeed(): string {
  const n = SEED_ALPHABET.length;
  const out: string[] = [];
  // Read a cryptographic entropy source when the runtime exposes one (Web Crypto
  // on Node 18+ and the browser), else fall back to Math.random. Typed loosely
  // so the engine's lib config needs no DOM lib for the `Crypto` global.
  const g = globalThis as {
    crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
  };
  const getRandomValues = g.crypto?.getRandomValues;
  if (typeof getRandomValues === 'function') {
    const bytes = getRandomValues.call(g.crypto, new Uint8Array(SEED_LENGTH));
    for (let i = 0; i < SEED_LENGTH; i += 1) {
      out.push(SEED_ALPHABET[bytes[i] % n]);
    }
  } else {
    for (let i = 0; i < SEED_LENGTH; i += 1) {
      out.push(SEED_ALPHABET[Math.floor(Math.random() * n)]);
    }
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** The brief Cable template id in the core pack (step 8). */
const CABLE_TEMPLATE_ID = 'cable-hq-directive';
/** The person-Dossier template id in the core pack (step 8). */
const DOSSIER_TEMPLATE_ID = 'dossier-hq-person';
/** The game's start time: day 0, first phase. */
const START: GameTime = { day: 0, phase: 0 };

/** Find a Document template by local id (unprefixed), else `undefined`. */
function findTemplate(
  content: ContentSet,
  local: string,
): DocumentTemplate | undefined {
  for (const [key, value] of content.documentTemplates) {
    if (key === local || key.endsWith(`/${local}`)) {
      return value;
    }
  }
  return undefined;
}

/** Require a Document template by local id; a missing one is a pack gap. */
function requireTemplate(content: ContentSet, local: string): DocumentTemplate {
  const template = findTemplate(content, local);
  if (template === undefined) {
    throw new Error(
      `generate(): the content set has no Document template "${local}"`,
    );
  }
  return template;
}

/**
 * The result of running the core stream once (steps 1–9), carrying everything
 * {@link verifyDiscoveryPaths} needs for step 10 and everything
 * {@link assembleWorld} needs to build the {@link WorldState}.
 */
interface CoreStreamResult {
  readonly worldSeed: string;
  readonly rngState: PrngState;
  readonly city: ReturnType<typeof generateCity>['city'];
  readonly knownLocations: readonly LocId[];
  readonly orgs: ReturnType<typeof generateOrgs>;
  readonly principals: ReturnType<typeof generatePrincipals>;
  readonly plot: ReturnType<typeof generatePlot>['plot'];
  readonly comms: ReturnType<typeof generateComms>;
  readonly knowledge: ReturnType<typeof assignKnowledge>;
  readonly brief: StartingBrief;
  readonly briefCable: ComposedDocument;
  readonly dossiers: readonly ComposedDocument[];
  readonly publicDocs: readonly Document[];
}

/**
 * The city the setting step built, handed to the core stream (content-expansion
 * task 3.8). The setting step runs *before* the core stream and owns slice step
 * 1 (the city), so the core stream receives the already-built city and starts
 * at step 2 (orgs and Principals). This carries the generated slice {@link City}
 * and the public-known Location set the brief folds in.
 */
interface SettingCity {
  readonly city: CoreStreamResult['city'];
  readonly knownLocations: readonly LocId[];
}

/**
 * Run the core stream once for `worldSeed` (steps 2–9). `displaySeed` is the
 * player-facing seed the brief and the dossiers date-stamp and the WorldState
 * records; `worldSeed` is the stream seed, which equals `displaySeed` on the
 * first attempt and `derive(displaySeed, attempt)` on a retry.
 *
 * `settingCity` is the city the setting step already built on the setting
 * stream (the Core City Path's `generateCity`, or the folded Instantiated City
 * for a City Pack). Slice step 1 therefore does **not** run on the core stream:
 * the core stream starts at step 2 (content-expansion Req 9.10, 9.11), so the
 * core stream state at the start of step 2 is the same as the core seed's
 * initial state.
 */
/**
 * The schema-1 template step 4 instantiates for a posting. Library selection
 * draws on the select stream. The slice fallback draws once on the core stream,
 * matching the uniform pick a game without a posting makes.
 */
function postingTemplate(
  prng: ReturnType<typeof createPrng>,
  content: GenerateInputs['content'],
  posting: PostingPlotSelection,
  worldSeed: string,
): PlotTemplate {
  const candidates = [...content.plotTemplates.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  if (candidates.length === 0) {
    throw new Error('generatePlot(): the content set defines no Plot templates');
  }
  const rng =
    posting.selection === null ? prng : createPrng(derive(worldSeed, SELECT_STREAM));
  const id = selectPlot(posting.history, posting.selection, candidates, rng);
  const found = candidates.find((template) => sameTemplate(template.id, id));
  if (found !== undefined) {
    return found;
  }
  const fallbackId = fallbackSelect(candidates, posting.history.templateHistory, prng);
  const fallback = candidates.find((template) => sameTemplate(template.id, fallbackId));
  if (fallback === undefined) {
    throw new Error('generatePlot(): the content set defines no Plot templates');
  }
  return fallback;
}

function sameTemplate(left: string, right: string): boolean {
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function runCoreStream(
  worldSeed: string,
  inputs: GenerateInputs,
  settingCity: SettingCity,
  posting?: PostingPlotSelection,
  ctx?: PostingContext,
): CoreStreamResult {
  const { content, preset, scenario, descriptors, publicTexts } = inputs;
  const prng = createPrng(worldSeed);

  // Step 1 ran on the setting stream (before the core stream); the city and
  // its public-known set come from the setting step.
  const { city, knownLocations } = settingCity;

  // Step 2 — organisations and Principal NPCs. A posting names the hostile
  // service from its Service Definition and still consumes the name draw.
  const hostileName =
    ctx === undefined ? undefined : serviceDisplayName(content.services, ctx.service);
  const orgs = generateOrgs(prng, hostileName);
  const principals = generatePrincipals(
    prng,
    content,
    descriptors,
    city,
    orgs,
    scenario.plotSelection?.enabled === true ? { cap: 22 } : undefined,
  );

  // Step 3/4 — the Plot (stage DAG). A posting selects from its history.
  // Without one, the slice draws a template on this same stream.
  const { plot } = generatePlot(
    prng,
    content,
    preset,
    city,
    orgs,
    principals,
    START,
    posting === undefined ? undefined : postingTemplate(prng, content, posting, worldSeed),
  );

  // Step 5 — Channels and Dead Drops, folded onto the city's Locations.
  const comms = generateComms(prng, content, city, orgs, principals, plot, START);
  const cityWithDrops = withDeadDropSites(city, comms);

  // Step 6/7 — knowledge assignment, including the mole when the scenario asks.
  const knowledge = assignKnowledge(
    prng,
    orgs,
    principals,
    plot,
    comms,
    cityWithDrops,
    { hqFalseBeliefRate: preset.hqFalseBeliefRate },
    { mole: scenario.mole },
  );

  // Step 8 — the Cover Identity and the Starting Brief, delivered as a Cable.
  const namerCtx: NamerContext = {
    city: cityWithDrops,
    npcs: principals.npcs,
    orgs: orgs.orgs,
  };
  const cableTemplate = requireTemplate(content, CABLE_TEMPLATE_ID);
  const briefResult = generateStartingBrief(
    worldSeed,
    content,
    cityWithDrops,
    principals,
    comms,
    knowledge.station,
    cableTemplate,
    namerCtx,
    { startingBudget: preset.startingBudget },
  );

  // Step 8 (continued) — Dossiers on the Station-slice subjects, so the brief
  // package carries HQ files on the entities HQ has leads about. Each Dossier
  // asserts the apparent facts the Station slice holds about its subject.
  const dossierTemplate = requireTemplate(content, DOSSIER_TEMPLATE_ID);
  const dossierSubjects = dossierSubjectIds(knowledge.station.known, knowledge.station.falseBeliefs, principals);
  const dossiers = dossierSubjects.map((id) =>
    composeDossier(dossierTemplate, principals.npcs[id], {
      ...namerCtx,
      stationSlice: knowledge.station,
    }),
  );
  const brief: StartingBrief = {
    ...briefResult.brief,
    dossiers: dossiers.map((d) => d.document.id),
  };

  // Step 9 — public texts for book ciphers, obtainable at reading Locations.
  const publicDocs = composePublicTexts(publicTexts, cityWithDrops);

  return {
    worldSeed,
    rngState: prng.state(),
    city: cityWithDrops,
    knownLocations,
    orgs,
    principals,
    plot,
    comms,
    knowledge,
    brief,
    briefCable: briefResult.cable,
    dossiers,
    publicDocs,
  };
}

// ---------------------------------------------------------------------------
// Setting step (content-expansion task 3.8; design, "Setting selection")
// ---------------------------------------------------------------------------

/**
 * The output of one setting attempt (content-expansion task 3.8): the Start
 * Date and Game Year selection, the city the core stream builds on, its
 * public-known Location set, the year-filtered Content Set the later steps
 * read, and the {@link CityView} projection. `infeasible` is set when a City
 * Pack's `instantiateCity` returned `'infeasible'` for this setting attempt, so
 * the generator can advance to the next setting attempt without running the
 * core stream (content-expansion Req 9.9).
 */
interface SettingStepResult {
  readonly selection: SettingSelection;
  readonly settingCity: SettingCity;
  readonly filteredSet: ContentSetV2;
  readonly view: CityView;
  readonly infeasible: boolean;
}

/** The 1-based calendar month of an ISO Start Date (falls back to January). */
function startMonthOf(startDate: string): number {
  const parsed = parseIsoDate(startDate);
  return parsed?.month ?? 1;
}

/**
 * Run the setting step for setting attempt `j` (content-expansion task 3.8;
 * design, "Setting selection", "City instantiation", "CityView").
 *
 * The setting step runs *before* the core stream and owns slice step 1
 * (content-expansion Req 9.10, 9.11). On the setting stream
 * `derive(seed, 0x30000 + j)` it:
 *
 * 1. draws the Start Date (`drawSetting`) within the city and era windows;
 * 2. year-filters the Content Set for the Game Year (`yearFilter`);
 * 3. builds the city on the **setting** stream — `generateCity` for the Core
 *    City Path (so step 1 moves off the core stream), or `instantiateCity`
 *    folded into a slice `City` for a City Pack; and
 * 4. builds the {@link CityView} from the generated city and the year-filtered
 *    Content Set, exposed to the later steps and follow-on binders (Req 17.6).
 *
 * The whole step is a pure function of the seed, the Content Set and the
 * setting selection (Req 9.11). When a Content Set carries no content-expansion
 * fields (a slice-era pack set), the Core City Path still runs: `drawSetting`
 * falls back to the fixed default Start Date and `yearFilter` is a no-op, so
 * the only observable change from the slice is that step 1 now draws from the
 * setting stream.
 */
function runSettingStep(
  seed: string,
  attempt: number,
  inputs: GenerateInputs,
  usage: UsageSink,
): SettingStepResult {
  const { content, cityData } = inputs;

  // A slice-era Content Set has no content-expansion fields; treat it as a
  // Core-City-only set with an empty city registry so `drawSetting`/`yearFilter`
  // read a well-formed ContentSetV2.
  const setV2: ContentSetV2 = isContentSetV2(content)
    ? content
    : asCoreOnlyContentSetV2(content);

  const prng = createPrng(settingStreamSeed(seed, attempt));

  // Step 1a — the Start Date (and Game Year) on the setting stream.
  const selection = drawSetting(setV2, inputs.scenario.setting, prng, attempt);

  // Step 1b — year-filter the Content Set for the Game Year.
  const filteredSet = yearFilter(setV2, selection.year, selection.city);

  const startMonth = startMonthOf(selection.startDate);

  // Step 1c — build the city on the setting stream.
  let settingCity: SettingCity;
  let infeasible = false;
  if (selection.city === 'core') {
    // Core City Path: run the slice's step 1 logic on the setting stream, so
    // the core stream starts at step 2 (content-expansion Req 9.10). The city's
    // content is unchanged — only its stream moves.
    const generated = generateCity(prng, content.locationTypes.values(), cityData, {
      startMonth,
    });
    settingCity = {
      city: generated.city,
      knownLocations: generated.knownLocations,
    };
  } else {
    const bundle = filteredSet.cities[selection.city];
    if (bundle === undefined) {
      // The config resolver rejects an unknown city; this is a defensive floor.
      throw new SettingError(
        selection.city,
        `no City Pack "${selection.city}" is loaded`,
      );
    }
    const instantiated = instantiateCity(
      bundle,
      selection.year,
      filteredSet.tagVocabulary,
      prng,
    );
    if (instantiated === 'infeasible') {
      // Signal the generator to advance to the next setting attempt (Req 9.9).
      // A placeholder city is returned so the type is total; it is never used
      // because `infeasible` short-circuits the core stream.
      settingCity = {
        city: {
          displayName: bundle.def.name,
          districts: {},
          locations: {},
          routes: [],
          crowdModels: {},
          startMonth,
        },
        knownLocations: [],
      };
      infeasible = true;
    } else {
      const folded = foldInstantiatedCity(instantiated, bundle, content, startMonth);
      settingCity = { city: folded.city, knownLocations: folded.knownLocations };
      // Record the drawn Locations and the city's Cover Identities for coverage.
      for (const locId of folded.knownLocations) {
        usage.use('loc', locId);
      }
      for (const cover of bundle.covers) {
        usage.use('cover-identity', cover.id);
      }
    }
  }

  // Step 1d — the CityView, from the generated city and the year-filtered set.
  const view = cityView(settingCity.city, filteredSet, selection);

  return { selection, settingCity, filteredSet, view, infeasible };
}

/**
 * Districts, Locations and Routes from one setting attempt (plot-library
 * Property 18). This is the setting step alone: template history is not an
 * argument, because selection runs afterwards. `undefined` when that attempt's
 * City Pack instantiation is infeasible.
 */
export interface SettingGeography {
  readonly city: string;
  readonly attempt: number;
  readonly year: number;
  readonly districts: SettingCity['city']['districts'];
  readonly locations: SettingCity['city']['locations'];
  readonly routes: SettingCity['city']['routes'];
  readonly bind: BindCity;
}

export function settingGeography(
  seed: string,
  inputs: GenerateInputs,
  attempt = 0,
): SettingGeography | undefined {
  const step = runSettingStep(seed, attempt, inputs, NO_USAGE_SINK);
  if (step.infeasible) {
    return undefined;
  }
  const city = step.settingCity.city;
  return {
    city: step.selection.city,
    attempt: step.selection.attempt,
    year: step.selection.year,
    districts: city.districts,
    locations: city.locations,
    routes: city.routes,
    bind: bindCityFromView(step.view),
  };
}

/**
 * Treat a slice-era {@link ContentSet} (one that carries none of the
 * content-expansion fields) as a Core-City-only {@link ContentSetV2}: an empty
 * city registry, no era (an unbounded Period Window), no Culture Groups or
 * Descriptor Fragments, and an empty Tag Vocabulary. The Core City Path reads
 * only `era` (undefined ⇒ unbounded) and the scenario's `setting.city` (`core`
 * by default), so this lets `generate` run unchanged for a slice pack set while
 * still routing step 1 through the setting stream.
 */
function asCoreOnlyContentSetV2(content: ContentSet): ContentSetV2 {
  const partial = content as Partial<ContentSetV2>;
  return {
    ...(content as ContentSetV2),
    cities: partial.cities ?? {},
    cultureGroups: partial.cultureGroups ?? {},
    descriptorFragments: partial.descriptorFragments ?? [],
    cityScopeOwner: partial.cityScopeOwner ?? {},
  } as ContentSetV2;
}

/**
 * The NPC subjects a Dossier is composed for: every Principal NPC the Station
 * slice holds at least one Proposition about (true lead or HQ false belief),
 * id-sorted so the composition order is deterministic.
 */
function dossierSubjectIds(
  known: ReturnType<typeof assignKnowledge>['station']['known'],
  falseBeliefs: ReturnType<typeof assignKnowledge>['station']['falseBeliefs'],
  principals: ReturnType<typeof generatePrincipals>,
): NpcId[] {
  const subjects = new Set<string>();
  for (const prop of [...known, ...falseBeliefs]) {
    subjects.add(prop.subject);
  }
  return (Object.keys(principals.npcs) as NpcId[])
    .filter((id) => subjects.has(id))
    .sort();
}

/**
 * Assemble the full {@link WorldState} from a verified core-stream result. The
 * fields the core-stream steps own are populated for real; the sub-structures
 * owned by later tasks (relationships, Side Threads, transmissions, intercepts,
 * meetings, the Hostile Service, pending cables, directives, the scene, …) are
 * seeded with empty/placeholder values consistent with their skeleton types and
 * commented with the task that fills them in.
 */
function assembleWorld(
  displaySeed: string,
  core: CoreStreamResult,
  inputs: GenerateInputs,
  setting: SettingSelection,
  history?: TemplateHistory,
): WorldState {
  const { content, preset, scenario } = inputs;

  // Documents: the brief Cable, the Dossiers and the public texts, keyed by id.
  // Each Document stores only the PropIds it asserts; the full Propositions a
  // composer threaded onto a Document (`ComposedDocument.propositions`) are kept
  // in `documentPropositions`, keyed by PropId, so the `read` action (task 9.2)
  // can turn each asserted PropId into a Case File Claim without a second
  // lookup. Public texts assert nothing, so they contribute no Propositions.
  const documents: Record<DocId, Document> = {};
  const documentPropositions: Record<PropId, Proposition> = {};
  const addDoc = (doc: Document): void => {
    documents[doc.id] = doc;
  };
  const addComposed = (composed: ComposedDocument): void => {
    addDoc(composed.document);
    for (const prop of composed.propositions) {
      documentPropositions[prop.id] = prop;
    }
  };
  addComposed(core.briefCable);
  for (const dossier of core.dossiers) {
    addComposed(dossier);
  }
  for (const doc of core.publicDocs) {
    addDoc(doc);
  }

  // The player starts at the Station Location when the city stamps one, else at
  // the first public Location (every city stamps at least one public place).
  const startLoc = startingLocation(core);

  // The mole, if enabled (design, step 7; Requirement 1.5). Generation applies
  // the MoleAssignment: it rewrites the designated staffer's *true* allegiance
  // to the Hostile Service while leaving its *apparent* allegiance as `station`
  // (that staffer presents as ordinary Station staff — the identity the player
  // must discover). `station.mole` is set from the same assignment below. The
  // ground-truth facts (its REPORTS_TO / MEMBER_OF the Hostile Service, and the
  // allegiance itself) are seeded into the Truth Store by `seedTruthStore`.
  // Deriving the apparent allegiance of *ordinary* NPCs is task 26.5's concern;
  // here only the mole's true allegiance is rewritten, and only when enabled.
  const npcs = applyMole(core.principals.npcs, core.knowledge.mole);

  // The player's starting known sets come straight from the Starting Brief.
  const knownChannels: readonly ChannelId[] = core.brief.channels;
  const knownDrops: readonly DeadDropId[] = core.brief.deadDrops;

  const stationOrg: OrgId = core.orgs.station.id;

  let library: ReturnType<typeof buildLibrarySession>;
  try {
    library =
      scenario.plotSelection?.enabled === true
        ? buildLibrarySession(
          {
            templates: [...(content.plotTemplatesV2?.values() ?? [])],
            sideThreads: [...(content.sideThreadTemplatesV2?.values() ?? [])],
            city: bindCityFromView(cityView(core.city, content, setting)),
            preset,
            year: setting.year,
            seed: displaySeed,
            ...(history === undefined ? {} : { history }),
            world: {
              hostileOrg: core.orgs.hostile.id,
              contacts: core.principals.contacts,
              stationStaff: core.principals.staff,
              ...(core.knowledge.mole === undefined
                ? {}
                : { mole: revealTruth(core.knowledge.mole.npc) }),
              orgsForQuery: () => [core.orgs.hostile.id],
              npcsForQuery: () => [
                ...core.principals.cell,
                ...core.principals.hostile,
                ...core.principals.staff,
                ...core.principals.contacts,
              ],
            },
          },
          createPrng(derive(displaySeed, SELECT_STREAM)),
        )
        : undefined;
  } catch (error) {
    if (error instanceof LibrarySelectionError) {
      throw new GeneratorError(displaySeed, 4, undefined, 'core');
    }
    throw error;
  }
  const primaryPlot = library?.plots[0];

  const world: WorldState = {
    meta: {
      seed: displaySeed,
      generatorVersion: GENERATOR_VERSION,
      // The real Content Manifest from the loaded Content Set (task 2.4 owns the
      // manifest shape in @tradecraft/content). `state.ts` still types this
      // field as the task-4.6 `Skeleton<'ContentManifest'>` placeholder (a
      // phantom, optional-only shape), so the concrete manifest shares no
      // properties with it and TS needs the cast; when task 2.4's manifest
      // replaces the skeleton alias in state.ts, the cast falls away.
      content: content.manifest as unknown as ContentManifest,
      preset,
      scenario,
      // The setting selection the setting step produced (content-expansion
      // task 3.8): the city, the Start Date (game day 0), the Game Year and the
      // setting attempt the stream was derived at. Stored so a save restores
      // the setting exactly (design, "Data Models"; Property 13).
      setting,
      ...(library === undefined ? {} : { selection: library.selection }),
    },
    time: START,
    // The core stream's serialised state after generation, so a save taken right
    // after generation resumes the exact core stream (Requirement 17.1/17.2).
    rng: core.rngState,

    city: core.city,
    orgs:
      library === undefined
        ? core.orgs.orgs
        : {
            ...core.orgs.orgs,
            ...Object.fromEntries(
              library.plots.flatMap((item) =>
                item.cells.map((cell) => [
                  cell.org,
                  { id: cell.org as OrgId, name: cell.spec, kind: 'cell' as const, allegiance: 'cell' as const },
                ]),
              ),
            ),
          },
    npcs,
    // Every NPC starts where its schedule puts it at the start time, or
    // `absent` when the schedule names no Location then. `foldNoise` recomputes
    // this once the Background NPCs join the roster.
    whereabouts: whereaboutsAt(npcs, START),
    // Relationships are owned by task 18; none exist at generation.
    relationships: {},
    // No NPC has told the player anything yet: every Told List starts empty.
    told: {},

    plot: primaryPlot === undefined ? core.plot : slicePlotOf(primaryPlot),
    ...(library === undefined ? {} : { plots: library.plots, libraryThreads: library.threads }),
    // Side Threads are owned by the noise generator (task 6.2).
    sideThreads: [],

    channels: core.comms.channels,
    deadDrops: core.comms.deadDrops,
    // Transmissions and Intercepts are owned by the Cipher Engine (task 8.3).
    transmissions: [],
    intercepts: {},
    documents,
    documentPropositions,
    // Newspapers are minted per day by task 9.1; none exist at generation.
    newspapers: {},
    // Meetings are owned by task 11.5.
    meetings: {},

    station: {
      org: stationOrg,
      chief: core.principals.chief,
      staff: core.principals.staff,
      ...(core.knowledge.mole === undefined
        ? {}
        : { mole: core.knowledge.mole.npc }),
      knowledge: core.knowledge.station,
      // Directives are owned by task 10.2; the brief carries none yet.
      directives: [],
      standing: 0,
      ledger: createLedger(preset.startingBudget),
      // Pending cables are owned by task 10.2.
      pendingCables: [],
      // The mole-report projection is written by the player view at each
      // commit; nothing is reportable before the first turn.
      reportable: [],
    },

    // The Hostile Service's running state (task 19.1; Requirements 12.1, 12.2):
    // the doctrine drawn from the preset's ranges on the dedicated hostile
    // stream (so the three samples are deterministic from the seed and never
    // shift a core/noise draw), plus an empty belief model. The runtime ticks
    // (detection, responses, adaptation) draw from the saved runtime/daily
    // streams, not this generation-time one. No feed has been ingested yet, so
    // the debrief-only feed log starts empty.
    hostile: {
      ...initialHostileServiceState(
        createPrng(derive(displaySeed, HOSTILE_STREAM_BASE)),
        preset.doctrine,
      ),
      feedLog: [],
    },

    player: {
      loc: startLoc,
      cover: core.brief.coverIdentity,
      // Cover Suspicion and tailing are hidden ground truth; they start at the
      // neutral value, written as branded truth. Task 11.3/19.3 drive them.
      coverSuspicion: asTruth(0),
      tailed: asTruth(false),
      known: {
        entities: core.brief.knownEntities,
        channels: knownChannels,
        drops: knownDrops,
      },
      contacts: core.brief.contacts,
      // The Station's standing arrest authority (see the constant). Nothing in
      // play grants more, so a zero start would make every arrest unreachable.
      arrestAuthority: STARTING_ARREST_AUTHORITY,
      // No arrest has been granted at generation. No Talk Scene is open either,
      // so `scene` is left absent.
      arrests: [],
      burned: false,
      // No Document has been read at generation (task 9.2; Requirement 30.4).
      readDocuments: [],
      // No Unidentified Subject has been observed at generation; the Action
      // Resolver's identification machinery fills this table in over play
      // (task 11.2; Requirement 21.7).
      unkIds: {},
    },

    // No future events are scheduled at generation; the clock (task 7.1) fills
    // the queue as it advances.
    scheduled: [],
  };

  return library === undefined ? world : materialiseTwists(world);
}

/**
 * Apply the {@link MoleAssignment} to the Principal NPC record (design, step 7;
 * Requirement 1.5). When a mole is designated, the one staffer it names has its
 * *true* allegiance rewritten to the Hostile Service — the ground truth a
 * Double Agent carries (Requirement 11.1) — while every other field, including
 * its view-safe `apparentAllegiance` (which stays `station`), is left
 * byte-identical. A fresh record is built rather than mutating the core NPCs, so
 * determinism and core independence hold (Requirement 1.2). With no mole, the
 * record is returned unchanged.
 */
function applyMole(
  npcs: Readonly<Record<NpcId, Npc>>,
  mole: GeneratedKnowledge['mole'],
): Record<NpcId, Npc> {
  if (mole === undefined) {
    return { ...npcs };
  }
  const moleId = mole.npc;
  const current = npcs[moleId];
  if (current === undefined) {
    // The designated staffer is always a generated Principal, so this is a
    // defensive floor; return the record unchanged rather than invent an NPC.
    return { ...npcs };
  }
  return {
    ...npcs,
    [moleId]: { ...current, trueAllegiance: mole.trueAllegiance },
  };
}

/**
 * The player's starting Location: the Station Location when the city stamps one
 * (its Type id is `station`), else the first public Location by id. Every
 * generated city stamps at least one public Location, so this is always a real
 * id.
 */
function startingLocation(core: CoreStreamResult): LocId {
  const locations = Object.values(core.city.locations);
  const station = locations
    .filter((loc) => loc.type === 'station')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  if (station !== undefined) {
    return station.id;
  }
  const firstPublic = locations
    .filter((loc) => loc.public)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  if (firstPublic !== undefined) {
    return firstPublic.id;
  }
  // No public Location at all would be a city-generation bug; fall back to the
  // first Location by id so the field is always a real place rather than throw.
  const first = locations.sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )[0];
  if (first === undefined) {
    throw new Error('generate(): the generated city has no Locations');
  }
  return first.id;
}

// ---------------------------------------------------------------------------
// Noise stream (design, "Noise Generator"; Requirements 29.1–29.6)
// ---------------------------------------------------------------------------

/**
 * The resolved noise counts and ratio a noise attempt draws with. Read from the
 * Difficulty Preset's `noiseCounts`/`noiseTrafficRatio` (Requirement 34.2);
 * every preset the content loader validates carries them, but each count falls
 * back to the noise modules' documented default when a (hand-built) preset omits
 * it, so a thin preset still produces a plausible noise mix rather than throwing.
 */
interface NoiseSettings {
  readonly backgroundNpcs: number;
  readonly sideThreads: number;
  readonly rumours: number;
  readonly ratio: { readonly noise: number; readonly plot: number };
}

/**
 * Resolve the noise settings from the preset. A loader-validated
 * {@link DifficultyPreset} always carries `noiseCounts`/`noiseTrafficRatio`
 * (the schema makes them required), so these are read directly. The noise
 * modules expose their own documented defaults (`DEFAULT_BACKGROUND_NPCS`,
 * `DEFAULT_SIDE_THREADS`) for callers that have no preset in hand; `generate`
 * always has a preset, so it uses the preset's authoritative values.
 */
function noiseSettings(preset: DifficultyPreset): NoiseSettings {
  const counts = preset.noiseCounts;
  return {
    backgroundNpcs: counts.backgroundNpcs,
    sideThreads: counts.sideThreads,
    rumours: counts.rumours,
    ratio: preset.noiseTrafficRatio,
  };
}

/**
 * The number of *interceptable* (radio/numbers) Plot/Cell signal Channels the
 * core comms made — the signal count the Noise Traffic ratio is applied against
 * (design, Noise Generator step 4; Requirement 29.4). Reads
 * {@link GeneratedComms.plotChannels} and keeps only the interceptable kinds, so
 * courier runs and dead-drop exchanges (which are not intercepted) do not count.
 */
function plotSignalChannelCount(comms: CoreStreamResult['comms']): number {
  let n = 0;
  for (const id of comms.plotChannels) {
    const channel = comms.channels[id];
    if (channel !== undefined && isInterceptableKind(channel.kind)) {
      n += 1;
    }
  }
  return n;
}

/** The four noise-step outputs produced by one noise attempt. */
interface NoiseStreamResult {
  readonly background: GeneratedBackgroundNpcs;
  readonly sideThreads: GeneratedSideThreads;
  readonly rumours: GeneratedRumours;
  readonly traffic: GeneratedNoiseTraffic;
  /** Lookalikes placed before the ordinary side-thread quota. Absent on the slice path. */
  readonly libraryThreads?: ReturnType<typeof fillLookalikeShare>;
}

/**
 * Gather the Plot's true Propositions — the source pool a Rumour may distort
 * (design, step 3) — from the Cell members' Knowledge Slices (the Plot truth
 * pool `assignKnowledge` built), de-duplicated by id in a stable order. This is
 * the same pool the discovery verifier reads the key operation facts from, so
 * Rumours drift from the facts that actually drive the Plot.
 */
function plotPropositions(core: CoreStreamResult): Proposition[] {
  const byId = new Map<string, Proposition>();
  for (const id of [...core.principals.cell].sort()) {
    const slice = core.knowledge.byNpc[id]?.knowledge;
    if (slice === undefined) {
      continue;
    }
    for (const prop of slice.known) {
      if (!byId.has(prop.id)) {
        byId.set(prop.id, prop);
      }
    }
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Run the four noise steps for one noise attempt on the given noise `prng`
 * (design, Noise Generator, steps 1–4; Requirements 29.1–29.4). The order is
 * fixed — Background NPCs, Side Threads, Rumours, Noise Traffic — so the draw
 * sequence, and therefore the result, is a pure function of the noise seed, the
 * core world and the resolved noise settings (Requirement 29.5).
 */
function runNoiseStream(
  prng: ReturnType<typeof createPrng>,
  core: CoreStreamResult,
  inputs: GenerateInputs,
  settings: NoiseSettings,
  lookalikes?: Omit<LookalikeFill, 'sideThreadCount'>,
): NoiseStreamResult {
  const { content, descriptors } = inputs;

  // Step 1 — Background NPCs (civilians with public schedules and local facts).
  // The Principal full names are passed through so a Background NPC never reuses
  // a Principal's full name, and the generator also keeps Background names unique
  // against one another — no two NPCs across the roster share a full name
  // (Requirements 1.7, 1.8). Principals are generated on the core stream before
  // this noise step, so the name set is fixed by the time noise runs.
  const principalNames = new Set<string>(
    Object.values(core.principals.npcs).map((npc) => npc.persona.name),
  );
  const background = generateBackgroundNpcs(
    prng,
    content,
    descriptors,
    core.city,
    core.orgs,
    settings.backgroundNpcs,
    principalNames,
  );

  // Step 2 — Lookalikes first, through the side-thread spawn, then the ordinary
  // side-thread quota. The slice path omits the lookalike request, so its draws
  // stay on the same noise stream as before.
  const libraryThreads =
    lookalikes === undefined
      ? undefined
      : fillLookalikeShare({ ...lookalikes, sideThreadCount: settings.sideThreads }, prng);
  const sideThreads = generateSideThreads(
    prng,
    content,
    core.city,
    core.principals,
    background.npcs,
    settings.sideThreads,
    START,
  );

  // Step 3 — Rumours (distorted false beliefs held by Background NPCs).
  const rumours = generateRumours(
    prng,
    content,
    plotPropositions(core),
    sideThreads,
    background,
    settings.rumours,
  );

  // Step 4 — Noise Traffic (decoy intercept channels at the preset ratio),
  // counted against the interceptable Plot signal channels.
  const traffic = generateNoiseTraffic(
    prng,
    plotSignalChannelCount(core.comms),
    settings.ratio,
    START,
  );

  return {
    background,
    sideThreads,
    rumours,
    traffic,
    ...(libraryThreads === undefined ? {} : { libraryThreads }),
  };
}

/**
 * The additive result of folding a noise attempt into the verified core world:
 * the full {@link WorldState} (noise included) and the augmented
 * {@link GeneratedKnowledge} the re-verification reads so the discovery graph
 * runs over the full world (design: "Re-verification runs on the full world").
 */
interface FoldedNoise {
  readonly world: WorldState;
  readonly knowledge: GeneratedKnowledge;
}

/**
 * Fold a noise attempt into the verified core world, *additively* (design, Noise
 * Generator; Requirement 29.5: "Noise only adds entities and beliefs. It never
 * mutates core entities except to append Background-NPC acquaintances to
 * known-entity lists"):
 *
 * - Background NPCs are merged into `world.npcs`, and their scheduled start
 *   positions into `world.whereabouts`;
 * - the Side Threads become `world.sideThreads`;
 * - the Side-Thread and Noise-Traffic Channels are merged into `world.channels`
 *   (their ids are namespaced `chan:thread/…` / `chan:noise/…`, so no core
 *   channel is overwritten);
 * - the Rumours are applied as each holder Background NPC's `falseBeliefs`;
 * - and — the one permitted touch of a known-entity list — a Background NPC's
 *   acquaintances (the other civilians its local slice names) are appended to
 *   its own `knownEntities`. No core NPC's slice is altered.
 *
 * The core entities' substantive fields are left byte-identical: the merges and
 * the Side-Thread assignment build fresh records/arrays rather than mutating the
 * core world, so determinism and core independence hold (Requirement 1.2, 29.5).
 *
 * The returned {@link GeneratedKnowledge} extends the core `knowledge.byNpc` with
 * one entry per Background NPC — its local-facts slice plus any Rumour false
 * beliefs and its appended acquaintances — so the discovery verifier, re-run on
 * this object, sees the full world's human sources. The Background NPCs are
 * civilians off every Plot/Cell path, so they can only *add* human/signal
 * sources, never remove a core one; re-verification therefore still holds for a
 * world the core already verified, and the retry loop exists only to defend the
 * invariant rather than because a Background NPC can plausibly break it.
 */
function foldNoise(
  coreWorld: WorldState,
  core: CoreStreamResult,
  noise: NoiseStreamResult,
): FoldedNoise {
  // Side-Thread + Noise-Traffic channels, merged onto the core channel record.
  const channels: Record<ChannelId, Channel> = { ...coreWorld.channels };
  for (const [id, channel] of Object.entries(noise.sideThreads.channels)) {
    channels[id as ChannelId] = channel;
  }
  for (const [id, channel] of Object.entries(noise.traffic.channels)) {
    channels[id as ChannelId] = channel;
  }

  // Background NPCs, merged onto the core NPC record (bg- ids never collide).
  const npcs: Record<NpcId, Npc> = { ...coreWorld.npcs };
  for (const [id, npc] of Object.entries(noise.background.npcs)) {
    npcs[id as NpcId] = npc;
  }

  const world: WorldState = {
    ...coreWorld,
    npcs,
    // The Background NPCs start where their schedules put them, like the core
    // NPCs; the core NPCs' positions are unchanged by the recompute.
    whereabouts: whereaboutsAt(npcs, coreWorld.time),
    sideThreads: [...coreWorld.sideThreads, ...noise.sideThreads.sideThreads],
    ...(noise.libraryThreads === undefined ? {} : { libraryThreads: noise.libraryThreads }),
    channels,
  };

  // Augment the per-NPC knowledge with each Background NPC's slice, folding in
  // its Rumour false beliefs and appending its acquaintances to knownEntities.
  const byNpc: Record<NpcId, NpcKnowledge> = { ...core.knowledge.byNpc };
  for (const bg of noise.background.background) {
    const rumourBeliefs = noise.rumours.falseBeliefsByHolder[bg.npc.id] ?? [];
    const falseBeliefs: readonly Proposition[] = [
      ...bg.knowledge.falseBeliefs,
      ...rumourBeliefs,
    ];
    // The one permitted mutation of a known-entity list: a Background NPC's
    // acquaintances (every entity its local slice already names, plus the
    // entities any Rumour it holds names) are appended to its own knownEntities.
    const acquaintances = new Set<EntityId>(bg.knowledge.knownEntities);
    for (const prop of [...bg.knowledge.known, ...falseBeliefs]) {
      acquaintances.add(prop.subject);
      if (typeof prop.object === 'string') {
        acquaintances.add(prop.object);
      }
      if (prop.place !== undefined) {
        acquaintances.add(prop.place);
      }
    }
    const slice: KnowledgeSlice = {
      known: bg.knowledge.known,
      falseBeliefs,
      knownEntities: [...acquaintances],
    };
    // A Background NPC carries no Cover Story or Agenda (it is a civilian, not a
    // recruitment target); give the discovery reader an empty, well-formed
    // NpcKnowledge so the slice is present without inventing recruitment state.
    byNpc[bg.npc.id] = {
      knowledge: slice,
      cover: { presents: [] },
      agenda: { conceal: [], promote: [], goals: [] },
    };
  }

  const knowledge: GeneratedKnowledge = {
    ...core.knowledge,
    byNpc,
  };

  return { world, knowledge };
}

/**
 * Run the noise stream over a verified core world until the full world passes
 * re-verification, then return the folded world (design, Noise Generator;
 * Requirements 29.5, 29.6).
 *
 * The noise stream is seeded independently of the core: the first attempt draws
 * from `derive(seed, NOISE_STREAM_BASE)` and retry *k* draws from
 * `derive(noiseSeed, k)`, a loop entirely separate from the core loop so
 * changing a noise setting (or the noise retry ceiling) never shifts a core
 * draw (Requirement 29.5). After each attempt the full world is re-verified; on
 * success the folded world is returned, on failure the next noise seed is tried,
 * and when the budget is exhausted a {@link GeneratorError} naming the seed and
 * the noise phase is thrown (Requirement 29.6).
 *
 * `displaySeed` is the caller's seed (recorded on `meta.seed`); `noiseSeed` is
 * the stream seed `derive(displaySeed, NOISE_STREAM_BASE)` — distinct values so
 * the noise draws stay independent while the world still reads back under the
 * player's seed.
 */
/** Lookalike request for a library world. The slice path has no `plots`, so it stays undefined. */
function lookalikeFill(
  world: WorldState,
  core: CoreStreamResult,
  inputs: GenerateInputs,
  setting: SettingSelection,
): Omit<LookalikeFill, 'sideThreadCount'> | undefined {
  if (world.plots === undefined) {
    return undefined;
  }
  const cellMembers = new Set<string>();
  for (const plot of world.plots) {
    for (const cell of plot.cells) {
      for (const npc of cell.members) {
        cellMembers.add(npc);
      }
    }
  }
  return {
    threads: [...(inputs.content.sideThreadTemplatesV2?.values() ?? [])],
    plots: [...(inputs.content.plotTemplatesV2?.values() ?? [])],
    city: bindCityFromView(cityView(core.city, inputs.content, setting)),
    preset: inputs.preset,
    share: libraryPreset(inputs.preset).lookalikeShare,
    cellMembers,
  };
}

function runNoiseLoop(
  displaySeed: string,
  noiseSeed: string,
  coreWorld: WorldState,
  core: CoreStreamResult,
  inputs: GenerateInputs,
  setting: SettingSelection,
  verify: DiscoveryVerifier,
  maxAttempts: number,
): FoldedNoise {
  const settings = noiseSettings(inputs.preset);

  let lastResult: DiscoveryResult | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // Attempt 0 uses the noise seed directly; a retry re-seeds the whole noise
    // stream with derive(noiseSeed, attempt), the design's "next noise seed".
    const streamSeed = attempt === 0 ? noiseSeed : derive(noiseSeed, attempt);
    const prng = createPrng(streamSeed);
    const noise = runNoiseStream(prng, core, inputs, settings, lookalikeFill(coreWorld, core, inputs, setting));
    const folded = foldNoise(coreWorld, core, noise);

    const result = verify({
      brief: core.brief,
      plot: core.plot,
      knowledge: folded.knowledge,
      // Re-verification runs on the full world: the merged channels and NPCs so
      // the noise additions are visible to the discovery graph.
      comms: { ...core.comms, channels: folded.world.channels },
      city: core.city,
      orgs: core.orgs,
      principals: { ...core.principals, npcs: folded.world.npcs },
    });
    lastResult = result;

    if (result.ok) {
      return folded;
    }
  }

  throw new GeneratorError(displaySeed, maxAttempts, lastResult?.failure, 'noise');
}

/**
 * Attach ambient state after the noise pass and re-verify. Attempt k uses
 * {@link initAmbient}'s derived seed. A failed gate discards that state and
 * tries the next seed, up to {@link MAX_AMBIENT_ATTEMPTS}.
 */
function runAmbientLoop(
  displaySeed: string,
  world: WorldState,
  core: CoreStreamResult,
  knowledge: GeneratedKnowledge,
  inputs: GenerateInputs,
  verify: DiscoveryVerifier,
  maxAttempts: number,
): WorldState {
  let lastResult: DiscoveryResult | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const ambient = initAmbient(
      world,
      inputs.content,
      inputs.preset,
      inputs.scenario,
      attempt,
    );
    const withAmbient = { ...world, ambient };
    const result = verify({
      brief: core.brief,
      plot: core.plot,
      knowledge,
      comms: { ...core.comms, channels: world.channels },
      city: core.city,
      orgs: core.orgs,
      principals: { ...core.principals, npcs: world.npcs },
    });
    lastResult = result;
    if (result.ok) {
      const verified = verifierResult(result);
      registerRegionGraph(
        displaySeed,
        graphFromWitnesses(verified.witnesses, Object.keys(core.city.locations)),
      );
      return {
        ...withAmbient,
        ambient: {
          ...ambient,
          gate: {
            solvable: [...verified.solvable].sort(),
            anchors: [...anchorsOf(verified, withAmbient)].sort(),
            slowRunsToday: 0,
            witnesses: storedWitnesses(verified.witnesses),
          },
        },
      };
    }
  }
  throw new GeneratorError(
    displaySeed,
    maxAttempts,
    lastResult?.failure,
    'ambient',
  );
}

/**
 * Generate a complete, verifiable {@link WorldState} from a seed (design,
 * "World Generator", step 9; Requirements 1.2, 1.6).
 *
 * The ten core-stream steps run in order on the core PRNG stream; step 10 (the
 * discovery-path verifier) is the acceptance gate. On a failed gate the whole
 * core stream re-runs on `derive(seed, attempt)` for the next attempt, up to
 * `maxAttempts` tries; when the limit is exhausted a {@link GeneratorError}
 * naming the seed, the attempt count and the failing target is thrown
 * (Requirement 1.6).
 *
 * ## The noise stream (design, Noise Generator; Requirements 29.5, 29.6)
 *
 * Once the core world passes the gate, the noise stream runs on its own
 * `derive(seed, NOISE_STREAM_BASE)` stream — fully separate from the core loop,
 * so changing a noise setting never shifts a core draw (Requirement 29.5). Its
 * four steps (Background NPCs → Side Threads → Rumours → Noise Traffic) run in a
 * fixed order and are folded *additively* into the verified core world: noise
 * only adds entities and beliefs, never mutating a core entity's substantive
 * fields (the one exception the design allows — appending a Background NPC's
 * acquaintances to its own known-entity list — is honoured in `foldNoise`). The
 * full world is then re-verified; on a failed re-verification the noise is
 * regenerated from the next noise seed `derive(noiseSeed, k)`, up to
 * {@link MAX_NOISE_ATTEMPTS}, and on exhaustion a {@link GeneratorError} naming
 * the seed and the `noise` phase is thrown (Requirement 29.6).
 *
 * `generate` is pure in `(seed, inputs)` (Requirement 1.2): the display seed
 * recorded on `meta.seed` is always the caller's `seed`, every core draw comes
 * from the core stream and every noise draw from the derived noise stream in a
 * fixed order, and the verifier makes no draws — so the same arguments always
 * yield an identical world, noise included.
 *
 * @param seed the game seed (the display seed; use {@link randomSeed} to mint one).
 * @param inputs the Content Set, preset, scenario and pack data (see {@link GenerateInputs}).
 * @param options the discovery gate and attempt ceiling (testing hooks).
 */
export function generate(
  seed: string,
  inputs: GenerateInputs,
  options: GenerateOptions = {},
  ctx?: PostingContext,
): WorldState {
  return generateGame(seed, inputs, options, ctx).world;
}

/**
 * The full output of {@link generateGame}: the ground-truth {@link WorldState}
 * and the seeded {@link TruthStore}. The design keeps the two side by side — the
 * World State is the mutable state every `resolve` threads through, while the
 * Truth Store answers `holds` and records allegiances/identities — and a save
 * snapshot persists them as siblings (design, "Save/Load": `world: WorldState;
 * truth: TruthStoreState`). `generate` returns only `.world` for the many
 * callers that need the state alone; a caller that needs truth queries from the
 * first turn uses `generateGame`.
 */
export interface GenerateResult {
  /** The ground-truth World State generation produced. */
  readonly world: WorldState;
  /**
   * The Truth Store, seeded with every core and noise ground-truth Proposition
   * (memberships, the mole's facts, Plot and Side-Thread facts) and the mole's
   * true allegiance, so `holds` answers from the first turn (design, World
   * Generator; Requirements 1.5, 2.1, 27.6).
   */
  readonly truth: TruthStore;
}

/**
 * Generate a complete, verifiable {@link WorldState} *and* its seeded
 * {@link TruthStore} from a seed (design, "World Generator", step 9; "When the
 * World State is assembled, the Truth Store is seeded with every core and noise
 * ground-truth Proposition"; Requirements 1.2, 1.5, 1.6, 2.1, 27.6).
 *
 * This is {@link generate}'s full form: it runs the identical core and noise
 * streams (so the World State is byte-identical to what `generate` returns) and
 * then seeds the Truth Store once the full world is assembled. The seeding reads
 * the ground-truth Proposition set `assignKnowledge` already collected
 * (`knowledge.truthFacts` — every true NPC/Station known fact, plus the mole's
 * REPORTS_TO/MEMBER_OF the Hostile Service) together with the Side Threads' true
 * Propositions folded in by the noise stream, and records the mole's true
 * allegiance. Seeding order is fixed and deterministic, so the Truth Store, like
 * the World State, is a pure function of `(seed, inputs)` (Requirement 1.2).
 *
 * @param seed the game seed (the display seed; use {@link randomSeed} to mint one).
 * @param inputs the Content Set, preset, scenario and pack data (see {@link GenerateInputs}).
 * @param options the discovery gate and attempt ceiling (testing hooks).
 */
export function generateGame(
  seed: string,
  inputs: GenerateInputs,
  options: GenerateOptions = {},
  ctx?: PostingContext,
): GenerateResult {
  const verify = options.verifier ?? verifyDiscoveryPaths;
  const maxAttempts = options.maxAttempts ?? MAX_GENERATION_ATTEMPTS;
  const noiseVerify = options.noiseVerifier ?? verifyDiscoveryPaths;
  const maxNoiseAttempts = options.maxNoiseAttempts ?? MAX_NOISE_ATTEMPTS;
  const ambientVerify = options.ambientVerifier ?? verifyDiscoveryPaths;
  const maxAmbientAttempts = options.maxAmbientAttempts ?? MAX_AMBIENT_ATTEMPTS;
  const maxSettingAttempts = options.maxSettingAttempts ?? MAX_SETTING_ATTEMPTS;
  const usage = options.usage ?? NO_USAGE_SINK;
  const posted = ctx === undefined ? inputs : withPostingOverrides(inputs, ctx);

  // The setting step runs *first*, before any Plot selection (content-expansion
  // Req 9.11), on its own stream `derive(seed, 0x30000 + j)` for setting attempt
  // j. It owns slice step 1 (the city), so the core stream below starts at step
  // 2. When the core retry loop is exhausted for the city built at setting
  // attempt j — or a City Pack's instantiation stays infeasible — the generator
  // advances to setting attempt j + 1 with a fresh setting stream (Req 9.9).
  let settingCity: CitySelectorValue = 'core';
  let lastResult: DiscoveryResult | undefined;
  for (
    let settingAttempt = 0;
    settingAttempt < maxSettingAttempts;
    settingAttempt += 1
  ) {
    const step = runSettingStep(seed, settingAttempt, posted, usage);
    settingCity = step.selection.city;

    if (step.infeasible) {
      // The City Pack could not be instantiated on this setting attempt; move
      // to the next one without running the core stream (Req 9.9).
      continue;
    }

    const posting =
      options.posting ??
      (ctx === undefined ? undefined : postingFromContext(ctx, posted, step.settingCity, step.selection));
    const coreLoop = runCoreLoop(
      seed,
      step.settingCity,
      posted,
      verify,
      maxAttempts,
      posting,
      ctx,
    );
    if (coreLoop.core === undefined) {
      // The core retry budget was exhausted for this setting attempt's city;
      // advance to the next setting attempt (Req 9.9). `lastResult` is kept so
      // the final GeneratorError can name the last failing target.
      lastResult = coreLoop.lastResult;
      continue;
    }
    const core = coreLoop.core;

    // The display seed stays the caller's seed, so the world reads back under
    // the seed the player entered; a core retry only changed the stream the
    // world was drawn from.
    const coreWorld = assembleWorld(seed, core, posted, step.selection, options.history);
    const carried =
      ctx === undefined
        ? coreWorld
        : carryWorld(seed, coreWorld, core, ctx, posted, verify);

    // The noise stream runs *after* the core world is verified, on its own
    // separate stream (derive(seed, NOISE_STREAM_BASE), then derive(thatSeed, k)
    // per retry), and the full world is re-verified (design, Noise Generator;
    // Requirements 29.5, 29.6). The display seed is unchanged by noise — noise
    // only adds entities and beliefs. A posting's carry step has already run,
    // on its own stream, and only adds entities.
    const noiseSeed = derive(seed, NOISE_STREAM_BASE);
    const noise = runNoiseLoop(
      seed,
      noiseSeed,
      carried,
      core,
      posted,
      step.selection,
      noiseVerify,
      maxNoiseAttempts,
    );
    const ambientWorld =
      posted.scenario.ambient?.enabled === true
        ? runAmbientLoop(
            seed,
            noise.world,
            core,
            noise.knowledge,
            posted,
            ambientVerify,
            maxAmbientAttempts,
          )
        : noise.world;

    // The Cipher Engine mints the real ciphertext Intercepts for every
    // interceptable firing the full world produces — Plot Stage transmission
    // traces, Side Thread transmission traces and Noise Traffic Channels — and
    // seeds them as `WorldState.transmissions` (task 26.3; design "Cipher
    // Engine"; Requirements 9.1, 25.3, 29.2, 29.4). `WorldState.intercepts`
    // stays empty: a Transmission is traffic that happened; an Intercept is
    // what the player has *captured*, which the intercept action delivers off
    // `transmissions` into `intercepts` (Property 18). Seeding runs on its own
    // cipher stream so it never perturbs a core or noise draw.
    const world = seedTransmissions(seed, ambientWorld, core, posted);

    // With the full world assembled, seed the Truth Store with every core and
    // noise ground-truth Proposition and the mole's allegiance, so `holds`
    // answers from the first turn (design, World Generator; Requirement 2.1).
    const truth = seedTruthStore(posted.content, core.knowledge, world);
    return { world, truth };
  }

  // Every setting attempt (and its core retries) was exhausted: raise the
  // GeneratorError naming the seed and the city (content-expansion Req 9.9).
  throw new GeneratorError(
    seed,
    maxSettingAttempts,
    lastResult?.failure,
    'setting',
    settingCity,
  );
}

/**
 * The city selector value stored on a {@link GeneratorError} and threaded
 * through the setting loop: `'core'` or a City id. A plain string alias so the
 * loop does not depend on the setting module's `CitySelector`.
 */
type CitySelectorValue = string;

/**
 * Run the core stream's retry loop for one setting attempt's city (steps 2–10;
 * Requirement 1.6). Returns the verified {@link CoreStreamResult}, or
 * `undefined` when the core retry budget is exhausted — which tells
 * {@link generateGame} to advance to the next setting attempt rather than throw
 * immediately (content-expansion Req 9.9: "Retry across core and setting
 * attempts").
 *
 * Attempt 0 uses the seed directly; a retry re-seeds the whole core stream with
 * `derive(seed, k)`, exactly as the design's step 10 specifies. The city built
 * by the setting step is passed into every attempt — slice step 1 does not run
 * on the core stream (content-expansion Req 9.10, 9.11).
 */
function withPostingOverrides(inputs: GenerateInputs, ctx: PostingContext): GenerateInputs {
  return {
    ...inputs,
    preset: mergeRecord(inputs.preset, ctx.presetOverrides),
    scenario: {
      ...inputs.scenario,
      recruitment: mergeRecord(inputs.scenario.recruitment, ctx.scenarioOverrides),
    },
  };
}

function mergeRecord<T>(base: T, overrides: Readonly<Record<string, unknown>>): T {
  if (!isPlainRecord(base)) {
    return base;
  }
  let changed = false;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      continue;
    }
    const current = base[key];
    const next =
      isPlainRecord(current) && isPlainRecord(value) ? mergeRecord(current, value) : value;
    if (next !== current) {
      out[key] = next;
      changed = true;
    }
  }
  return (changed ? out : base) as T;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function postingFromContext(
  ctx: PostingContext,
  inputs: GenerateInputs,
  settingCity: SettingCity,
  setting: SettingSelection,
): PostingPlotSelection {
  const context = {
    year: ctx.year,
    ...(ctx.tension === undefined ? {} : { tension: ctx.tension }),
    ...(ctx.epochFlags.length === 0 ? {} : { epochFlags: ctx.epochFlags }),
    ...(ctx.history.context.rank === undefined ? {} : { rank: ctx.history.context.rank }),
    ...(ctx.history.context.scaling === undefined ? {} : { scaling: ctx.history.context.scaling }),
  };
  const history = { templateHistory: ctx.history.templateHistory, context };
  const templates = [...(inputs.content.plotTemplatesV2?.values() ?? [])].filter(
    (template) => template.kind === 'plot',
  );
  if (templates.length === 0) {
    return { history, selection: null };
  }
  return {
    history,
    selection: {
      templates,
      city: bindCityFromView(cityView(settingCity.city, inputs.content, setting)),
      preset: inputs.preset,
      year: ctx.year,
      excluded: [],
    },
  };
}

function carryWorld(
  seed: string,
  world: WorldState,
  core: CoreStreamResult,
  ctx: PostingContext,
  inputs: GenerateInputs,
  verify: DiscoveryVerifier,
): WorldState {
  const applied = applyPostingCarry(
    world,
    core,
    ctx,
    inputs.content,
    inputs.preset.coverSuspicionBurnThreshold,
    verify,
  );
  if (!applied.ok) {
    throw new GeneratorError(seed, applied.error.attempts, applied.error.failure, 'carry');
  }
  return applied.world;
}

function runCoreLoop(
  seed: string,
  settingCity: SettingCity,
  inputs: GenerateInputs,
  verify: DiscoveryVerifier,
  maxAttempts: number,
  posting?: PostingPlotSelection,
  ctx?: PostingContext,
): { core?: CoreStreamResult; lastResult?: DiscoveryResult } {
  let lastResult: DiscoveryResult | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const worldSeed = attempt === 0 ? seed : derive(seed, attempt);
    const core = runCoreStream(worldSeed, inputs, settingCity, posting, ctx);

    const result = verify({
      brief: core.brief,
      plot: core.plot,
      knowledge: core.knowledge,
      comms: core.comms,
      city: core.city,
      orgs: core.orgs,
      principals: core.principals,
    });
    lastResult = result;

    if (result.ok) {
      return { core };
    }
  }
  return { lastResult };
}

/**
 * Seed `WorldState.transmissions` with the real ciphertext Intercepts the Cipher
 * Engine mints for the full world's interceptable firings (task 26.3; design,
 * "Cipher Engine"; Requirements 9.1, 9.5, 25.3, 29.2, 29.4).
 *
 * The producers are the Plot Stage transmission traces (carrying the Plot's
 * operation Propositions as plaintext, Req 9.1), the Side Thread transmission
 * traces (carrying each thread's own true Propositions, Req 29.2) and the Noise
 * Traffic Channels (minting a decoy Intercept on each schedule firing, Req
 * 29.4). `seedWorldIntercepts` runs the engine on its own cipher stream, so the
 * Transmissions are a pure function of `(seed, world)` and perturb no core or
 * noise draw. `WorldState.intercepts` is left `{}` — a Transmission is traffic
 * that happened, an Intercept is what the player has captured; the intercept
 * action copies a Transmission's Intercept into `intercepts` when it is
 * collected inside the retention window (Property 18, task 11.10).
 */
function seedTransmissions(
  seed: string,
  world: WorldState,
  core: CoreStreamResult,
  inputs: GenerateInputs,
): WorldState {
  const seeded = seedWorldIntercepts({
    seed,
    plot: world.plot,
    sideThreads: world.sideThreads,
    channels: world.channels,
    documents: world.documents,
    preset: inputs.preset,
    fieldCodes: inputs.content.predicates.fieldCodes,
    plotPropositions: plotPropositions(core),
    start: START,
  });
  return { ...world, transmissions: [...seeded.transmissions] };
}

/**
 * Seed the ground-truth {@link TruthStore} for an assembled world (design,
 * "World Generator": "When the World State is assembled, the Truth Store is
 * seeded with every core and noise ground-truth Proposition (memberships, the
 * mole's facts, Plot and Side Thread facts), so `holds` answers from the first
 * turn"; Requirements 1.5, 2.1, 27.6).
 *
 * The seed set is the union of two already-computed ground-truth pools, taken in
 * a fixed order so the store is deterministic (Requirement 1.2):
 *
 * 1. `knowledge.truthFacts` — every true `known` Proposition across the NPC and
 *    Station Knowledge Slices (Cell membership, the operation's shape, the
 *    Station roster — the Plot's key facts the discovery verifier keys off),
 *    *plus* the mole's `REPORTS_TO` the hostile resident and `MEMBER_OF` the
 *    Hostile Service. `assignKnowledge` deduped these by id.
 * 2. The Side Threads' true `propositions` — the noise ground truth — read off
 *    the assembled `world.sideThreads` in generation order.
 *
 * Rumours and HQ false beliefs are deliberately *absent*: a false belief is
 * detectably false precisely because the Truth Store does not hold it. The
 * mole's true allegiance (the Hostile Service) is recorded via
 * {@link TruthStore.setAllegiance} so an engine module can read it back as
 * ground truth. The whole store is built with {@link TruthStore.from} in one
 * construction, dispatching `holds` on the Content Set's compiled predicate
 * evaluators (`content.predicates.evaluators`, exactly the id → evaluator-kind
 * lookup the store needs).
 */
export function seedTruthStore(
  content: ContentSet,
  knowledge: GeneratedKnowledge,
  world: WorldState,
): TruthStore {
  // Core + mole ground truth (already deduped by id), then the Side Threads'
  // true Propositions in generation order — a fixed, deterministic sequence.
  const facts: Proposition[] = [...knowledge.truthFacts];
  for (const thread of world.sideThreads) {
    facts.push(...thread.propositions);
  }
  const twist = twistGroundTruth(world);
  facts.push(...twist.facts);

  // The mole's true allegiance is ground truth too; record it so an engine
  // module can read it back. Keyed by the mole NPC id. No mole ⇒ no allegiance.
  const allegiances = new Map<NpcId, Allegiance>();
  if (knowledge.mole !== undefined) {
    allegiances.set(knowledge.mole.npc, knowledge.mole.trueAllegiance);
  }
  for (const entry of twist.allegiances) {
    allegiances.set(entry.npc, entry.allegiance);
  }

  const itemOrigins = new Map<string, EntityId>();
  for (const plot of world.plots ?? []) {
    for (const [item, origin] of Object.entries(plot.itemOrigins ?? {})) {
      itemOrigins.set(item, origin as EntityId);
    }
  }

  const identities = new Map<UnkId, NpcId>();
  const carry = world.carry === undefined ? undefined : revealTruth(world.carry);
  if (carry !== undefined) {
    for (const entry of Object.values(carry.unk)) {
      identities.set(entry.unk, entry.npc);
    }
  }

  return TruthStore.from(content.predicates.evaluators, {
    facts,
    allegiances,
    identities,
    claimTruths: [],
    ...(itemOrigins.size === 0 ? {} : { itemOrigins }),
  });
}
