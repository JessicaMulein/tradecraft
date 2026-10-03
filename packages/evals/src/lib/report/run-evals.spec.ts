/**
 * Offline unit tests for the `pnpm evals` orchestration (slice-integration
 * task 17.2 / 17.4; Req 25.1, 25.2, 25.3).
 *
 * These drive {@link runEvals} entirely through its injected {@link RunEvalsIo}
 * seams — fake connect/startServer actions, fake Model Manager functions that
 * record the load/unload order, a fake gateway factory, a scripted scene player
 * and a canned judge scorer, and an in-memory report writer — so no live model,
 * no endpoint and no fs are ever touched. They assert the three things the task
 * names:
 *
 *   1. **unload-before-load when switching profiles** (Req 25.3): running every
 *      profile starts the Model Manager for the first and, for each later
 *      profile, calls `unloadProfile(prev)` then `loadProfile(next)`;
 *   2. **the judge identity in the report** (Req 25.2): each profile's report
 *      block names the model that judged it;
 *   3. **the judge-equals-voice warning** (Req 25.2): a profile whose judge
 *      model equals its voice model is flagged, in the report and on stderr.
 */

import { describe, expect, it } from 'vitest';

import type {
  Gateway,
  LmStudioClient,
  LoadProfileResult,
  ModelsConfig,
  NarrationStream,
  Profile,
  RoleConfig,
  StartupResult,
} from '@tradecraft/llm';
import type { ScenarioConfig } from '@tradecraft/engine';

import {
  REPORT_CSV,
  REPORT_MARKDOWN,
  runEvals,
  type RunEvalsIo,
} from './run-evals.js';
import { DIALOGUE_RUBRIC, NARRATION_RUBRIC } from '../judge/rubric.js';
import type { JudgeScorer, JudgeVerdict } from '../judge/judge.js';
import type { ScenePlayer } from './harness.js';
import type { ScenarioJudgeScore } from './report.js';
import { scoreWithJudge } from '../judge/judge.js';

// ---------------------------------------------------------------------------
// Stub config (two profiles) and fakes
// ---------------------------------------------------------------------------

function roleWith(model: string): RoleConfig {
  return { model, temperature: 0, maxTokens: 300, timeoutMs: 30000, reasoning: 'off' };
}

function entryFor(id: string): ModelsConfig['models'][string] {
  return {
    family: 'gemma',
    sources: [
      { format: 'mlx', get: `org/${id}-mlx`, key: `${id}-mlx` },
      { format: 'gguf', get: `org/${id}-gguf`, key: `${id}-gguf` },
    ],
  };
}

function modelsFor(...ids: readonly string[]): ModelsConfig['models'] {
  return Object.fromEntries([...new Set(ids)].map((id) => [id, entryFor(id)]));
}

/** A profile with distinct voice and judge models. */
function distinctProfile(prefix: string): Profile {
  const other = roleWith(`${prefix}-other`);
  return {
    voice: roleWith(`${prefix}-voice`),
    fast: other,
    narrator: other,
    bookkeeping: other,
    judge: roleWith(`${prefix}-judge`),
  };
}

/** A profile where the judge model equals the voice model. */
function sameVoiceJudgeProfile(prefix: string): Profile {
  const other = roleWith(`${prefix}-other`);
  const shared = roleWith(`${prefix}-shared`);
  return {
    voice: shared,
    fast: other,
    narrator: other,
    bookkeeping: other,
    judge: shared,
  };
}

/**
 * A two-profile config. `gemma-voice` judges with a distinct model; `qwen-voice`
 * judges with its own voice model (so the warning should fire). Sorted order is
 * `gemma-voice` then `qwen-voice`.
 */
function stubConfig(): ModelsConfig {
  return {
    endpoint: 'http://localhost:1234/v1',
    contextLength: 8192,
    models: modelsFor(
      'gemma-voice',
      'gemma-other',
      'gemma-judge',
      'qwen-other',
      'qwen-shared',
    ),
    active: 'gemma-voice',
    profiles: {
      'gemma-voice': distinctProfile('gemma'),
      'qwen-voice': sameVoiceJudgeProfile('qwen'),
    },
  };
}

function stubScenario(): ScenarioConfig {
  return { mole: true, narration: 'full' } as unknown as ScenarioConfig;
}

/** A gateway whose methods all throw — the scripted scene player never calls it. */
class FakeGateway implements Gateway {
  structured<T>(): Promise<T> {
    return Promise.reject(new Error('structured must not be called'));
  }
  stream(): AsyncIterable<string> {
    throw new Error('stream must not be called');
  }
  streamNarration(): NarrationStream {
    throw new Error('streamNarration must not be called');
  }
  describeCall(): never {
    throw new Error('describeCall must not be called');
  }
}

/** A fake connected client whose methods are never reached in these tests. */
const fakeClient = {} as unknown as LmStudioClient;

/** A clean load result (no partial-GPU warnings). */
function cleanLoad(): LoadProfileResult {
  return { loaded: [], partialGpu: [], warnings: [] };
}

/** A clean startup result for a profile (passing preflight, clean load). */
function cleanStartup(): StartupResult {
  return {
    client: fakeClient,
    preflight: {
      ok: true,
      missing: [],
      estimatedBytes: 0,
      fitsBytes: 0,
      partialGpu: [],
      issues: [],
    },
    load: cleanLoad(),
  };
}

/**
 * A scripted scene player: it scores one voice reply per profile through the
 * injected scorer (so the judge identity/warning flow from the config), and
 * returns the result. It never drives the gateway.
 */
const scriptedPlayer: ScenePlayer = async ({ config, scorer }) => {
  const result = await scoreWithJudge('voice', 'a reply', config, scorer, {
    prompt: 'q',
  });
  const score: ScenarioJudgeScore = {
    scenario: 'mole-interrogation',
    role: 'voice',
    result,
  };
  return [score];
};

/** A canned scorer: returns a mid verdict for whatever rubric it is handed. */
const cannedScorer: JudgeScorer = (rubric): Promise<JudgeVerdict> =>
  Promise.resolve({
    scores: (rubric.kind === 'dialogue'
      ? DIALOGUE_RUBRIC
      : NARRATION_RUBRIC
    ).criteria.map((c) => ({ criterionId: c.id, score: 3, rationale: 'r' })),
  });

/** An in-memory report writer that captures what was written. */
function memoryWriter(): {
  readonly files: Map<string, string>;
  readonly write: RunEvalsIo['writeReport'];
} {
  const files = new Map<string, string>();
  return { files, write: (name, contents) => void files.set(name, contents) };
}

/** Build a base IO with the given overrides; the fakes reach no server/fs. */
function baseIo(
  overrides: Partial<RunEvalsIo> & Pick<RunEvalsIo, 'writeReport'>,
): RunEvalsIo {
  const out: string[] = [];
  const err: string[] = [];
  const io: RunEvalsIo = {
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
    repoRoot: '/repo',
    scenario: stubScenario(),
    models: stubConfig(),
    preset: 'standard',
    connect: () => Promise.resolve(fakeClient),
    startServer: () => Promise.resolve(),
    gatewayFactory: () => new FakeGateway(),
    scenePlayer: scriptedPlayer,
    scorer: cannedScorer,
    startModelManager: () =>
      Promise.resolve(cleanStartup()),
    loadProfile: () => Promise.resolve(cleanLoad()),
    unloadProfile: () => Promise.resolve([]),
    ...overrides,
  };
  // Expose the captured streams for assertions via a side-channel on the io.
  (io as unknown as { _out: string[]; _err: string[] })._out = out;
  (io as unknown as { _out: string[]; _err: string[] })._err = err;
  return io;
}

function captured(io: RunEvalsIo): { out: string[]; err: string[] } {
  const bag = io as unknown as { _out: string[]; _err: string[] };
  return { out: bag._out, err: bag._err };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runEvals — profile selection', () => {
  it('rejects an unknown --profile without starting the manager', async () => {
    const started: string[] = [];
    const writer = memoryWriter();
    const io = baseIo({
      writeReport: writer.write,
      startModelManager: (config) => {
        started.push(config.active);
        return Promise.resolve(cleanStartup());
      },
    });

    const status = await runEvals(io, { profile: 'nope' });
    expect(status).toBe(1);
    expect(started).toEqual([]);
    expect(writer.files.size).toBe(0);
    expect(captured(io).err.join('\n')).toMatch(/is not a defined profile/);
  });

  it('runs only the named profile without ever switching models', async () => {
    const started: string[] = [];
    const loaded: string[] = [];
    const unloaded: string[] = [];
    const writer = memoryWriter();
    const io = baseIo({
      writeReport: writer.write,
      startModelManager: (config) => {
        started.push(config.active);
        return Promise.resolve(cleanStartup());
      },
      loadProfile: (profile) => {
        loaded.push(profile.voice.model);
        return Promise.resolve(cleanLoad());
      },
      unloadProfile: (profile) => {
        unloaded.push(profile.voice.model);
        return Promise.resolve([]);
      },
    });

    const status = await runEvals(io, { profile: 'qwen-voice' });
    expect(status).toBe(0);
    // The one named profile is started via startModelManager; a single profile
    // never switches, so neither loadProfile nor unloadProfile is called.
    expect(started).toEqual(['qwen-voice']);
    expect(loaded).toEqual([]);
    expect(unloaded).toEqual([]);
    // The report names only the one profile.
    const md = writer.files.get(REPORT_MARKDOWN) ?? '';
    expect(md).toContain('Profiles compared: `qwen-voice`.');
  });
});

describe('runEvals — unload before load when switching profiles (Req 25.3)', () => {
  it('starts the first profile, then unloads the previous before loading the next', async () => {
    const events: string[] = [];
    const writer = memoryWriter();
    const io = baseIo({
      writeReport: writer.write,
      startModelManager: (config) => {
        events.push(`start:${config.active}`);
        return Promise.resolve(cleanStartup());
      },
      loadProfile: (profile) => {
        // The Profile object carries the role models; name it by its voice model.
        events.push(`load:${profile.voice.model}`);
        return Promise.resolve(cleanLoad());
      },
      unloadProfile: (profile) => {
        events.push(`unload:${profile.voice.model}`);
        return Promise.resolve([]);
      },
    });

    const status = await runEvals(io, {});
    expect(status).toBe(0);

    // The first profile (gemma-voice) is started via startModelManager; the
    // second (qwen-voice) unloads gemma then loads qwen — unload strictly
    // before load.
    expect(events).toEqual([
      'start:gemma-voice',
      'unload:gemma-voice',
      'load:qwen-shared',
    ]);
  });

  it('reuses the one connected client across the unload and the load', async () => {
    // A unique client object the fake startup hands back, so we can prove the
    // same connection is threaded through unload(prev) and load(next) rather
    // than a fresh client being made per profile.
    const theClient = { tag: 'the-one-client' } as unknown as LmStudioClient;
    const unloadClients: unknown[] = [];
    const loadClients: unknown[] = [];
    const writer = memoryWriter();
    const io = baseIo({
      writeReport: writer.write,
      startModelManager: () =>
        Promise.resolve({ ...cleanStartup(), client: theClient }),
      unloadProfile: (_profile, client) => {
        unloadClients.push(client);
        return Promise.resolve([]);
      },
      loadProfile: (_profile, _models, client) => {
        loadClients.push(client);
        return Promise.resolve(cleanLoad());
      },
    });

    const status = await runEvals(io, {});
    expect(status).toBe(0);

    // Exactly one switch (two profiles), and both its unload and its load got
    // the single client the startup connected — no reconnect in between.
    expect(unloadClients).toEqual([theClient]);
    expect(loadClients).toEqual([theClient]);
  });

  it('builds one gateway per profile and voices each profile through its own', async () => {
    // Tag each profile's gateway, then record which gateway the scene player is
    // handed for each profile — proving the harness builds a gateway per
    // profile and runs that profile's scenes through it.
    const gatewaysByProfile = new Map<string, Gateway>();
    const seenByProfile = new Map<string, Gateway>();
    const writer = memoryWriter();
    const io = baseIo({
      writeReport: writer.write,
      gatewayFactory: (config) => {
        const gateway = new FakeGateway();
        gatewaysByProfile.set(config.active, gateway);
        return gateway;
      },
      scenePlayer: async ({ config, gateway, scorer }) => {
        seenByProfile.set(config.active, gateway);
        const result = await scoreWithJudge('voice', 'a reply', config, scorer, {
          prompt: 'q',
        });
        return [
          { scenario: 'mole-interrogation', role: 'voice', result },
        ];
      },
    });

    const status = await runEvals(io, {});
    expect(status).toBe(0);

    // Two distinct gateways were built, one per profile, and each profile's
    // scenes ran through the gateway built for that same profile.
    expect(gatewaysByProfile.size).toBe(2);
    expect(seenByProfile.get('gemma-voice')).toBe(
      gatewaysByProfile.get('gemma-voice'),
    );
    expect(seenByProfile.get('qwen-voice')).toBe(
      gatewaysByProfile.get('qwen-voice'),
    );
  });
});

describe('runEvals — judge identity and same-as-voice warning (Req 25.2)', () => {
  it('writes both reports with each profile\'s judge identity', async () => {
    const writer = memoryWriter();
    const io = baseIo({ writeReport: writer.write });

    const status = await runEvals(io, {});
    expect(status).toBe(0);

    const md = writer.files.get(REPORT_MARKDOWN) ?? '';
    const csv = writer.files.get(REPORT_CSV) ?? '';

    // The Markdown judge-identity block names who judged each profile.
    expect(md).toContain('**gemma-voice** — judged by `gemma-judge`');
    expect(md).toContain('**qwen-voice** — judged by `qwen-shared`');

    // The CSV carries the judge model on its rows.
    expect(csv).toContain('gemma-judge');
    expect(csv).toContain('qwen-shared');

    // Stdout states who judged each profile too.
    const out = captured(io).out.join('\n');
    expect(out).toMatch(/profile "gemma-voice" judged by "gemma-judge"/);
    expect(out).toMatch(/profile "qwen-voice" judged by "qwen-shared"/);
  });

  it('flags the profile whose judge model equals its voice model', async () => {
    const writer = memoryWriter();
    const io = baseIo({ writeReport: writer.write });

    await runEvals(io, {});

    const md = writer.files.get(REPORT_MARKDOWN) ?? '';
    // gemma-voice has distinct models — no warning on its line.
    expect(md).toMatch(/⚠️ the judge model "qwen-shared" is the same as the voice model/);
    // The warning also goes to stderr.
    expect(captured(io).err.join('\n')).toMatch(/qwen-shared.*same as the voice model/);
  });
});

describe('runEvals — startup failure', () => {
  it('returns 1 and writes no report when the Model Manager fails to start', async () => {
    const writer = memoryWriter();
    const io = baseIo({
      writeReport: writer.write,
      startModelManager: () => Promise.reject(new Error('server down')),
    });

    const status = await runEvals(io, { profile: 'gemma-voice' });
    expect(status).toBe(1);
    expect(writer.files.size).toBe(0);
    expect(captured(io).err.join('\n')).toMatch(/failed to start: server down/);
  });
});
