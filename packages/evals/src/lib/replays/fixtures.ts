/**
 * Loading golden replay fixtures from `packages/evals/replays/` (task 21.4).
 *
 * A golden fixture is a directory under `replays/` holding three files:
 *
 *   - `session.json`   — the manifest: the seed, the planned action log and the
 *                        `models.yaml` config the session was recorded under.
 *   - `recording.jsonl` — the recorded model calls the {@link ReplayGateway}
 *                        serves from (one {@link CallRecord} per line). It is
 *                        empty for the model-free golden sessions here — the
 *                        recording file still exists so the replay is wired
 *                        through a real {@link RecordSource} and the format is
 *                        exercised end to end.
 *   - `expected.json`  — the checked-in golden artifact: the reproduced final
 *                        WorldState, its stable hash and the reproduced action
 *                        log. CI asserts a fresh replay deep-equals this.
 *
 * This module discovers those directories, loads the core content pack once,
 * builds the engine {@link GenerateInputs} the world is regenerated from, and
 * reconstructs each {@link GoldenSession} with a file-backed {@link
 * RecordSource}. The fixtures are generated deterministically by
 * {@link buildExpectedArtifact} (see `scripts/record-golden.ts`), so a
 * regenerate reproduces identical files.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  type GenerateInputs,
} from '@tradecraft/engine';
import {
  FileRecordSource,
  parseRecords,
  type ModelsConfig,
} from '@tradecraft/llm';

import {
  replayGoldenSession,
  type GoldenSession,
  type PlanStep,
  type ReplayArtifact,
} from './replay-runner.js';

/** The absolute path of the checked-in `replays/` fixture root. */
export const REPLAYS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'replays',
);

/**
 * The repository root the scenario's pack directories resolve against when the
 * golden replay runner assembles a game through the Composition Root
 * (slice-integration task 17.3). `createGame` resolves `scenario.packs.dirs`
 * (default `packages/content/packs`) against this, so it must be the workspace
 * root: this file sits at `packages/evals/src/lib/replays/`, five levels down.
 */
export const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '..',
);

/**
 * The golden fixtures whose checked-in `expected.json` is waiting to be
 * re-recorded.
 *
 * slice-integration task 1.1 added World State fields that every generated
 * world now carries with their generation defaults (`whereabouts`, `told`,
 * `player.arrests`, `station.reportable`, `hostile.feedLog` and
 * `plot.materielSeized`), and task 4.6 moved the runtime stream, so a fresh
 * replay of the slice sessions no longer deep-equals the artifacts recorded
 * before the change. Each Golden Replay is re-recorded only once, against the
 * integrated Turn Pipeline (slice-integration Req 24.1). Task 19.1 re-recorded
 * `01-wait-only`, `02-travel-and-wait` and `03-travel-countersurveillance`
 * through `scripts/record-golden.ts` and emptied this list, so the golden spec
 * now compares every fixture against its checked-in `expected.json` again.
 */
export const PENDING_RERECORD: readonly string[] = [];

/** The core content pack directory (`packages/content/packs/core`). */
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

/** The manifest stored in each fixture's `session.json`. */
export interface SessionManifest {
  readonly seed: string;
  /**
   * The Difficulty Preset the session was recorded under. Optional for the
   * three slice fixtures recorded before the field existed (they default to
   * `standard`); `04-full-game` records on `easy` and sets it explicitly.
   */
  readonly preset?: DifficultyPresetId;
  readonly plan: readonly PlanStep[];
  readonly modelsConfig: ModelsConfig;
}

/** A loaded golden fixture: its id, the replayable session and the golden. */
export interface LoadedFixture {
  readonly id: string;
  readonly session: GoldenSession;
  readonly inputs: GenerateInputs;
  readonly expected: ReplayArtifact;
}

/** Load the core pack's content set and the three per-pack data bundles. */
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

/** The difficulty preset ids the core pack ships, as selected by `--preset`. */
export const DIFFICULTY_PRESET_IDS = ['easy', 'standard', 'hard'] as const;

/** A difficulty preset id (`easy` | `standard` | `hard`). */
export type DifficultyPresetId = (typeof DIFFICULTY_PRESET_IDS)[number];

/** Find a Difficulty Preset by its short id (e.g. `standard`). */
function presetOf(content: ContentSet, id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) return value;
  }
  throw new Error(`no difficulty preset ${id}`);
}

/**
 * Build the engine {@link GenerateInputs} the golden sessions regenerate from:
 * the core pack with the given difficulty `preset` (default `standard`) and a
 * fixed, fully-specified {@link ScenarioConfig}. Deterministic — no randomness,
 * no fs beyond the pack load — so every replay regenerates the same world.
 *
 * The optional `preset` argument backs the debug `world`/`sim` CLIs' `--preset`
 * flag (`easy` | `standard` | `hard`); the golden-replay callers pass nothing
 * and keep the `standard` preset they recorded under.
 */
export function buildInputs(preset: DifficultyPresetId = 'standard'): GenerateInputs {
  const { content, cityData, descriptors, publicTexts } = loadCore();
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset },
    mole: true,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  return {
    content,
    preset: presetOf(content, preset),
    scenario,
    cityData,
    descriptors,
    publicTexts,
  };
}

/** A fixture directory is one that holds a `session.json` manifest. */
function isFixtureDir(path: string): boolean {
  try {
    return statSync(join(path, 'session.json')).isFile();
  } catch {
    return false;
  }
}

/** List the fixture ids under `replays/`, sorted for a stable CI order. */
export function listFixtureIds(root: string = REPLAYS_DIR): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  return entries
    .filter((name) => isFixtureDir(join(root, name)))
    .sort();
}

/** Read and parse a fixture's `session.json` manifest. */
function readManifest(dir: string): SessionManifest {
  return JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8')) as SessionManifest;
}

/**
 * Reconstruct a fixture's replayable {@link GoldenSession} from its manifest and
 * recording, without reading the golden `expected.json`. The recorder uses this
 * to replay a session before the golden exists; the full {@link loadFixture}
 * adds the golden on top for the CI gate. The recording file is parsed eagerly
 * so a corrupt or missing recording fails at load with a clear location.
 */
export function loadSession(id: string, root: string = REPLAYS_DIR): GoldenSession {
  const dir = join(root, id);
  const manifest = readManifest(dir);
  const recordingPath = join(dir, 'recording.jsonl');
  // Validate the recording parses now (names file:line on a corrupt record).
  parseRecords(readFileSync(recordingPath, 'utf8'), recordingPath);
  return {
    seed: manifest.seed,
    preset: manifest.preset ?? 'standard',
    plan: manifest.plan,
    modelsConfig: manifest.modelsConfig,
    recording: new FileRecordSource(recordingPath),
  };
}

/** The Difficulty Preset a fixture was recorded under (default `standard`). */
export function fixturePreset(
  id: string,
  root: string = REPLAYS_DIR,
): DifficultyPresetId {
  return readManifest(join(root, id)).preset ?? 'standard';
}

/**
 * Load one golden fixture by id: its manifest, a file-backed recording source,
 * the shared engine inputs and the checked-in golden artifact. The golden
 * `expected.json` is read here, so this is used by the CI gate once the fixture
 * is recorded (the recorder uses {@link loadSession} before the golden exists).
 */
export function loadFixture(
  id: string,
  inputs: GenerateInputs,
  root: string = REPLAYS_DIR,
): LoadedFixture {
  const dir = join(root, id);
  const session = loadSession(id, root);
  const expected = JSON.parse(
    readFileSync(join(dir, 'expected.json'), 'utf8'),
  ) as ReplayArtifact;
  return { id, session, inputs, expected };
}

/**
 * Load every golden fixture under `replays/`. Each fixture carries the preset it
 * was recorded under (`04-full-game` on `easy`, the slice fixtures on
 * `standard`), so the inputs the world is regenerated from are built per fixture
 * from that preset rather than one shared bundle.
 */
export function loadAllFixtures(root: string = REPLAYS_DIR): LoadedFixture[] {
  return listFixtureIds(root).map((id) =>
    loadFixture(id, buildInputs(fixturePreset(id, root)), root),
  );
}

/**
 * Replay a fixture and build the artifact a golden `expected.json` pins. Used by
 * both the CI spec (compare against the checked-in golden) and the recorder
 * script (write the golden). The replay now runs through the Composition Root
 * (slice-integration task 17.3), so it is async: it assembles a game, starts a
 * new game and drives the plan through the public `EngineApi`. JSON round-tripped
 * so the artifact compares equal to a file-read golden regardless of in-memory
 * `undefined`/class instances.
 */
export async function buildExpectedArtifact(
  fixture: LoadedFixture,
): Promise<ReplayArtifact> {
  const artifact = await replayGoldenSession(
    fixture.session,
    fixture.inputs,
    REPO_ROOT,
  );
  return JSON.parse(JSON.stringify(artifact)) as ReplayArtifact;
}
