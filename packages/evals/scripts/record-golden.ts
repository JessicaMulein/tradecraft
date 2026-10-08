/**
 * Deterministically (re-)record the golden replay fixtures into
 * `packages/evals/replays/` (task 21.4; Req 17.4).
 *
 * Run this once to lay down the checked-in golden sessions, and again whenever
 * an intentional generator or core-pack change bumps `generatorVersion` or the
 * pack version — exactly as the design's Testing Strategy prescribes ("Any
 * intentional generator or core-pack change bumps `generatorVersion` or the
 * pack version and re-records."). It writes, for each fixture:
 *
 *   - `session.json`    — the seed, preset, plan and `models.yaml` config;
 *   - `recording.jsonl` — the recorded model calls (empty for the model-free
 *                         golden sessions here); and
 *   - `expected.json`   — the golden artifact a fresh replay must reproduce.
 *
 * Four fixtures are recorded:
 *
 *   - `01-wait-only`, `02-travel-and-wait`, `03-travel-countersurveillance` —
 *     short, static `wait`/`travel` plans on `standard` (slice task 19.1).
 *   - `04-full-game` — the win-by-arrest Scripted Full Game played to its
 *     `success` / `leader-arrested` ending on `easy` (slice task 19.2; Req
 *     23.6). Its plan is captured by *playing the script once* and freezing the
 *     concrete action log it produced, so CI needs only to replay those exact
 *     actions — not the decision-making script — through the ReplayGateway.
 *
 * Every session is model-free. The slice fixtures play only `wait`/`travel`; the
 * win-by-arrest game plays `read`/`surveil`/`intercept`/`decrypt`/`cable`/
 * `arrest`/`travel`/`wait`, none of which is a dialogue turn, so no seam (Fake
 * or Live) ever runs and `recording.jsonl` stays empty. Recording needs no live
 * endpoint: the seed and action log fully determine the result, and the recorder
 * replays each session once — through the Composition Root (slice task 17.3),
 * the same assembled game CI replays — and freezes its artifact.
 *
 * Usage: `pnpm --filter @tradecraft/evals exec tsx scripts/record-golden.ts`
 * (or any ESM TS runner). The script is not part of the build or CI.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ScriptedGame, WIN_BY_ARREST, playWinByArrest } from '@tradecraft/app';
import type { ModelsConfig } from '@tradecraft/llm';

import {
  REPLAYS_DIR,
  REPO_ROOT,
  buildInputs,
  loadSession,
  type SessionManifest,
} from '../src/lib/replays/fixtures.js';
import {
  replayGoldenSession,
  type PlanStep,
} from '../src/lib/replays/replay-runner.js';

/** The `models.yaml` config each golden session is recorded under. The golden */
/** sessions make no model calls, so only its shape matters for replay wiring. */
const MODELS_CONFIG: ModelsConfig = {
  endpoint: 'http://localhost:1234/v1',
  profiles: {
    base: {
      voice: { model: 'voice-model', temperature: 0.7, maxTokens: 200, timeoutMs: 8000, reasoning: 'off' },
      fast: { model: 'fast-model', temperature: 0.7, maxTokens: 200, timeoutMs: 8000, reasoning: 'off' },
      narrator: { model: 'fast-model', temperature: 0.7, maxTokens: 200, timeoutMs: 8000, reasoning: 'off' },
      bookkeeping: { model: 'fast-model', temperature: 0.7, maxTokens: 200, timeoutMs: 8000, reasoning: 'off' },
      judge: { model: 'voice-model', temperature: 0.7, maxTokens: 200, timeoutMs: 8000, reasoning: 'off' },
    },
  },
  active: 'base',
};

/**
 * The three slice golden sessions: distinct seeds and small, varied
 * `wait`/`travel` plans on the default `standard` preset (slice task 19.1). They
 * carry no `preset` field, so they default to `standard`, keeping the files as
 * task 19.1 recorded them.
 */
const SLICE_SESSIONS: ReadonlyArray<{ id: string; manifest: SessionManifest }> = [
  {
    id: '01-wait-only',
    manifest: {
      seed: 'vienna-golden-alpha',
      plan: [
        { kind: 'wait', phases: 1 },
        { kind: 'wait', phases: 2 },
        { kind: 'wait', phases: 1 },
      ],
      modelsConfig: MODELS_CONFIG,
    },
  },
  {
    id: '02-travel-and-wait',
    manifest: {
      seed: 'vienna-golden-bravo',
      plan: [
        { kind: 'wait', phases: 1 },
        { kind: 'travel', destIndex: 3, countersurveillance: true },
        { kind: 'wait', phases: 1 },
        { kind: 'travel', destIndex: 7, countersurveillance: false },
      ],
      modelsConfig: MODELS_CONFIG,
    },
  },
  {
    id: '03-travel-countersurveillance',
    manifest: {
      seed: 'vienna-golden-charlie',
      plan: [
        { kind: 'travel', destIndex: 1, countersurveillance: true },
        { kind: 'travel', destIndex: 5, countersurveillance: true },
        { kind: 'wait', phases: 4 },
      ],
      modelsConfig: MODELS_CONFIG,
    },
  },
];

/** The id of the full-game Golden Replay (slice task 19.2). */
const FULL_GAME_ID = '04-full-game';

/**
 * Build the `04-full-game` session by playing the win-by-arrest Scripted Full
 * Game once and freezing the concrete action log it produced.
 *
 * The script makes its decisions by reading the Player View, which a static
 * `wait`/`travel` plan cannot express. So the recorder plays it through the real
 * Composition Root with the Fake Seams (the same way `scripted-games.spec.ts`
 * does), reads back the exact {@link Action} every turn played off
 * `game.turns`, and wraps each as an `action` plan step. The game is model-free
 * — none of its turns is a dialogue turn — so no seam ever runs and the plan,
 * replayed through the ReplayGateway with an empty recording, reproduces the
 * same ending deterministically. The seed and preset mirror {@link WIN_BY_ARREST}.
 */
async function buildFullGameSession(): Promise<{
  id: string;
  manifest: SessionManifest;
}> {
  const game = await ScriptedGame.start(WIN_BY_ARREST);
  try {
    const run = await playWinByArrest(game);
    if (!game.over) {
      throw new Error('the win-by-arrest script did not reach an ending');
    }
    const plan: PlanStep[] = game.turns.map((turn) => ({
      kind: 'action',
      action: turn.action,
    }));
    console.log(
      `played win-by-arrest (${plan.length} turns, arrested ${run.suspect})`,
    );
    return {
      id: FULL_GAME_ID,
      manifest: {
        seed: WIN_BY_ARREST.seed,
        preset: WIN_BY_ARREST.preset,
        plan,
        modelsConfig: MODELS_CONFIG,
      },
    };
  } finally {
    await game.close();
  }
}

/** Record one session: write its manifest and empty recording, replay, freeze. */
async function recordSession(id: string, manifest: SessionManifest): Promise<void> {
  const dir = join(REPLAYS_DIR, id);
  mkdirSync(dir, { recursive: true });

  // Write the manifest and an (empty) recording first, so loadSession can
  // build a real FileRecordSource over the on-disk fixture.
  writeFileSync(join(dir, 'session.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(join(dir, 'recording.jsonl'), '', 'utf8');

  // Replay once through the Composition Root, under the preset the session was
  // recorded under, and freeze the reproduced artifact as the golden expectation.
  const session = loadSession(id);
  const inputs = buildInputs(manifest.preset ?? 'standard', manifest.ambient);
  const artifact = JSON.parse(
    JSON.stringify(await replayGoldenSession(session, inputs, REPO_ROOT)),
  ) as Awaited<ReturnType<typeof replayGoldenSession>>;
  writeFileSync(join(dir, 'expected.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  console.log(`recorded golden fixture ${id} (stateHash ${artifact.stateHash})`);
}

const AMBIENT_WEEK: { id: string; manifest: SessionManifest } = {
  id: '05-ambient-week',
  manifest: {
    seed: 'ambient-golden-seven',
    preset: 'standard',
    ambient: { enabled: true, density: 'standard' },
    plan: [
      { kind: 'wait', phases: 4 },
      { kind: 'wait', phases: 4 },
      { kind: 'wait', phases: 4 },
      { kind: 'wait', phases: 4 },
      { kind: 'wait', phases: 4 },
      { kind: 'wait', phases: 4 },
      { kind: 'wait', phases: 4 },
    ],
    modelsConfig: MODELS_CONFIG,
  },
};

async function main(): Promise<void> {
  const only = process.argv.slice(2);
  const wanted = (id: string) => only.length === 0 || only.includes(id);
  for (const { id, manifest } of SLICE_SESSIONS) {
    if (wanted(id)) {
      await recordSession(id, manifest);
    }
  }
  if (wanted(AMBIENT_WEEK.id)) {
    await recordSession(AMBIENT_WEEK.id, AMBIENT_WEEK.manifest);
  }
  if (wanted(FULL_GAME_ID)) {
    const fullGame = await buildFullGameSession();
    await recordSession(fullGame.id, fullGame.manifest);
  }
}

void main();
