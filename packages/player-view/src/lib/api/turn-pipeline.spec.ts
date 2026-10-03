/**
 * Focused unit tests for the Turn Pipeline (task 16.8; design, "Turn Pipeline";
 * Requirements 7.1, 15.5, 16.1, 16.4, 16.5, 17.5, 42.1–42.6).
 *
 * These drive a real generated {@link WorldState} through the concrete
 * {@link createTurnDriver} pipeline behind the {@link PlayerViewEngine} facade,
 * with the model-touching steps supplied as injected seams so the pipeline runs
 * model-free and deterministic. They pin the behaviours task 16.8 owns:
 *
 *  - the Turn Transaction order for an action: simulate on a draft, commit
 *    (state swapped, time advanced) *before* the Fact Lines are shown and
 *    *before* the Narrator starts, then narrate post-commit (Req 15.5, 42.2);
 *  - draft discard on a pre-commit dialogue failure: the state, action log,
 *    Journal and Notifications stay at the pre-turn values and the stream emits
 *    `interrupted` then `paused` (Req 16.1, 16.4, 42.1, 42.4);
 *  - `retry()` re-running the paused turn from the retained pre-turn state
 *    (Req 16.4, 42.4);
 *  - extraction results committed as separate transactions at a turn boundary,
 *    in turn order, each logging an `extraction-commit` entry (Req 7.1, 42.5).
 *
 * The atomicity *property* (Property 29) is task 16.9 and is not duplicated
 * here; these are the example-based tests the pipeline's correctness rests on.
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
import {
  balance,
  buildOutcomeRecord,
  buildWorldHooks,
  generate,
  ScenarioConfigSchema,
  TruthStore,
  worldCipherKeyLookup,
  type Action,
  type AdvanceWorldDeps,
  type Directive,
  type DocId,
  type GameTime,
  type GenerateInputs,
  type NpcId,
  type Proposition,
  type ResolverContext,
  type TalkScene,
  type WorldState,
} from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { implicationRules, type BriefView } from '../casefile/evidence.js';
import { HintStore } from '../aids/hints.js';
import { Journal } from '../journal/journal.js';
import { NotificationStore } from '../notify/store.js';
import { PlayerViewEngine } from './engine-api.js';
import {
  ActionLog,
  ExtractionQueue,
  createTurnDriver,
  type EvaluateExtraction,
  type ExtractionReady,
  type ExtractionRunner,
  type OutcomeSink,
  type QueuedExtraction,
  type TurnPipelineConfig,
} from './turn-pipeline.js';
import type { TurnChunk } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors views.spec.ts)
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

function scenario() {
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

function inputs(): GenerateInputs {
  return { content, preset: STANDARD, scenario: scenario(), cityData, descriptors, publicTexts };
}

function world(seed = 'alpha'): WorldState {
  return generate(seed, inputs());
}

const EMPTY_BRIEF: BriefView = { hostileOrgs: [], hostileChannels: [], materiel: [] };
const NO_RULES = implicationRules([]);

/** A wait action is always allowed, costs phases and advances the clock. */
const WAIT: Action = { kind: 'wait', phases: 1 };

/** Build a facade over a fresh world, wired to a pipeline from `config`. */
function makeEngine(config: TurnPipelineConfig = {}, seed = 'alpha') {
  const state = world(seed);
  const caseFile = new CaseFile();
  const journal = new Journal();
  const notifications = new NotificationStore();
  const ctx: ResolverContext = { content };
  const turnDriver = createTurnDriver(config);
  const engine = new PlayerViewEngine({
    state,
    caseFile,
    journal,
    cityData,
    ctx,
    brief: EMPTY_BRIEF,
    rules: NO_RULES,
    notifications,
    turnDriver,
  });
  return { engine, caseFile, journal, notifications, state };
}

/** Drain a turn stream into an array of chunks. */
async function drain(stream: AsyncIterable<TurnChunk>): Promise<TurnChunk[]> {
  const out: TurnChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

/** The first NPC in a generated world — the scene speaker the dialogue tests use. */
function firstNpc(state: WorldState): NpcId {
  const [npc] = Object.keys(state.npcs) as NpcId[];
  if (npc === undefined) throw new Error('generated world has no NPCs');
  return npc;
}

/** Open a routine Talk Scene with `npc` (default: the first NPC) on the world. */
function withScene(state: WorldState, npc: NpcId = firstNpc(state)): WorldState {
  const scene: TalkScene = {
    npc,
    kind: 'routine',
    openedAt: state.time,
    via: 'talk',
    recent: [],
  };
  return { ...state, player: { ...state.player, scene } };
}

/**
 * Build a facade whose world already has an open Talk Scene — the precondition a
 * dialogue turn requires (Req 15.4). The facade is wired with the Session's
 * clock deps absent, as the other pipeline specs are, so the dialogue turn stays
 * model-free behind its seams.
 */
function makeSceneEngine(config: TurnPipelineConfig = {}, seed = 'alpha') {
  const base = world(seed);
  const npc = firstNpc(base);
  const state = withScene(base, npc);
  const caseFile = new CaseFile();
  const journal = new Journal();
  const notifications = new NotificationStore();
  const ctx: ResolverContext = { content };
  const turnDriver = createTurnDriver(config);
  const engine = new PlayerViewEngine({
    state,
    caseFile,
    journal,
    cityData,
    ctx,
    brief: EMPTY_BRIEF,
    rules: NO_RULES,
    notifications,
    turnDriver,
  });
  return { engine, caseFile, journal, notifications, state, npc };
}

// ---------------------------------------------------------------------------
// Action turn: order and commit-before-narrate
// ---------------------------------------------------------------------------

describe('Turn Pipeline — action turn order', () => {
  it('commits (swaps state, advances the clock) before Fact Lines and the Narrator', async () => {
    // The narrate seam records the state it sees, to prove commit ran first.
    let stateAtNarrate: WorldState | undefined;
    const { engine } = makeEngine({
      narrate: (_result, state) => {
        stateAtNarrate = state;
        return Promise.resolve(['A grey drizzle settles over the quay.']);
      },
    });

    const before = engine.state;
    const chunks = await drain(engine.act(WAIT));

    // The clock advanced by the quoted phase: the committed state is a new value
    // with a later time, and the facade now reads it.
    expect(engine.state).not.toBe(before);
    expect(engine.state.time).not.toEqual(before.time);

    // The Narrator saw the committed (advanced) state — commit happened first.
    expect(stateAtNarrate).toBeDefined();
    expect(stateAtNarrate?.time).toEqual(engine.state.time);

    // Order within the stream: any `flavour` chunk follows every `fact` chunk,
    // and the stream ends with `done`.
    const kinds = chunks.map((c) => c.kind);
    const firstFlavour = kinds.indexOf('flavour');
    const lastFact = kinds.lastIndexOf('fact');
    if (firstFlavour !== -1 && lastFact !== -1) {
      expect(firstFlavour).toBeGreaterThan(lastFact);
    }
    expect(kinds.at(-1)).toBe('done');
    expect(chunks.some((c) => c.kind === 'flavour')).toBe(true);
  });

  it('is fact-only when the Narrator seam rejects, leaving the commit intact (Req 16.5, 42.6)', async () => {
    const { engine } = makeEngine({
      narrate: () => Promise.reject(new Error('narrator timeout')),
    });
    const before = engine.state;
    const chunks = await drain(engine.act(WAIT));

    // The commit stands: state advanced, no flavour, stream completes normally.
    expect(engine.state).not.toBe(before);
    expect(chunks.some((c) => c.kind === 'flavour')).toBe(false);
    expect(chunks.at(-1)?.kind).toBe('done');
  });

  it('records a committed action in the action log at the advanced time', async () => {
    const actionLog = new ActionLog();
    const { engine } = makeEngine({ actionLog });
    await drain(engine.act(WAIT));

    const entries = actionLog.all();
    const actionEntry = entries.find((e) => e.kind === 'action');
    expect(actionEntry).toBeDefined();
    expect(actionEntry?.at).toEqual(engine.state.time);
  });

  it('advances the clock through advanceWorld (the committed state carries the hooks/Phase Step results)', async () => {
    // The rewired action turn runs `advanceWorld` over the quoted phases rather
    // than the old events-only `advance`. A one-phase WAIT lands on a new state
    // whose time advanced by exactly one phase, driven through the full clock
    // (hooks at a boundary, the Phase Step each phase), with the runtime stream
    // threaded back so the committed PRNG moved on.
    const { engine } = makeEngine();
    const before = engine.state;
    await drain(engine.act(WAIT));

    expect(engine.state).not.toBe(before);
    // The clock moved forward (never backward).
    const movedForward =
      engine.state.time.day > before.time.day ||
      (engine.state.time.day === before.time.day &&
        engine.state.time.phase > before.time.phase);
    expect(movedForward).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Action turn: the ended gate (design step 2; Req 7.7)
// ---------------------------------------------------------------------------

describe('Turn Pipeline — action turn ended gate', () => {
  it('rejects an action with a fact + done and commits nothing once the game has ended', async () => {
    const actionLog = new ActionLog();
    const { engine, journal, notifications } = makeEngine({ actionLog });

    // Force the game into an ended state (a success, say). The action turn must
    // take no further action: it rejects at the gate before simulating anything.
    const ended = {
      outcome: 'success',
      at: engine.state.time,
      cause: 'pressure' as const,
    };
    engine.commit({ ...engine.state, ended });

    const before = engine.state;
    const logLenBefore = actionLog.length;
    const chunks = await drain(engine.act(WAIT));

    // Nothing simulated or committed: the state is the same reference, and the
    // log, Journal and Notifications are untouched.
    expect(engine.state).toBe(before);
    expect(actionLog.length).toBe(logLenBefore);
    expect(journal.entryCount).toBe(0);
    expect(notifications.count).toBe(0);

    // The stream is a single disallowed `fact` chunk and `done`.
    const kinds = chunks.map((c) => c.kind);
    expect(kinds).toEqual(['fact', 'done']);
  });
});

// ---------------------------------------------------------------------------
// Dialogue failure: draft discard, interrupted + paused, retry
// ---------------------------------------------------------------------------

describe('Turn Pipeline — dialogue failure and retry', () => {
  it('discards the draft and emits interrupted then paused when voice rejects (Req 16.1, 16.4)', async () => {
    const actionLog = new ActionLog();
    const { engine, journal, notifications } = makeSceneEngine({
      actionLog,
      voice: () => Promise.reject(new Error('endpoint unreachable')),
    });

    const before = engine.state;
    const chunks = await drain(engine.say('Tell me about the courier.'));

    // Nothing committed: the state, action log, Journal and Notifications are
    // untouched — the whole Turn Transaction (incl. the Intent/pitch effects and
    // the Truth draft) was discarded (Req 5.4, 42.1, 42.4).
    expect(engine.state).toBe(before);
    expect(actionLog.length).toBe(0);
    expect(journal.entryCount).toBe(0);
    expect(notifications.count).toBe(0);

    // The stream told the UI to drop the attempt and that the turn is paused.
    const kinds = chunks.map((c) => c.kind);
    expect(kinds).toContain('interrupted');
    expect(kinds).toContain('paused');
    const paused = chunks.find((c) => c.kind === 'paused');
    expect(paused && paused.kind === 'paused' && paused.error.endpoint).toBe('voice');
  });

  it('retry re-runs the paused turn from the pre-turn state and can succeed', async () => {
    // Fail the first attempt, then succeed on retry: the voice seam flips.
    let attempt = 0;
    const actionLog = new ActionLog();
    const { engine } = makeSceneEngine({
      actionLog,
      voice: () => {
        attempt += 1;
        if (attempt === 1) {
          return Promise.reject(new Error('endpoint unreachable'));
        }
        return Promise.resolve({ released: ['I never met him.'], speaker: 'The contact' });
      },
    });

    const pre = engine.state;
    await drain(engine.say('Tell me about the courier.'));
    // Paused: nothing committed yet (the state is unchanged at `pre`).
    expect(engine.state).toBe(pre);
    expect(actionLog.length).toBe(0);

    const retryChunks = await drain(engine.retry());
    // The retry ran from the same pre-turn state and committed cleanly. The
    // committed state is a NEW value — the dialogue turn applied the Intent to
    // the scene NPC's Relationship — not the `pre` reference.
    expect(engine.state).not.toBe(pre);
    expect(retryChunks.some((c) => c.kind === 'speech')).toBe(true);
    expect(retryChunks.at(-1)?.kind).toBe('done');
    // The dialogue line was logged exactly once (the retry's commit).
    expect(actionLog.all().filter((e) => e.kind === 'line')).toHaveLength(1);
  });

  it('retry with nothing paused is a no-op that completes', async () => {
    const { engine } = makeSceneEngine();
    const chunks = await drain(engine.retry());
    expect(chunks).toEqual([{ kind: 'done' }]);
  });
});

// ---------------------------------------------------------------------------
// Dialogue turn: the no-scene gate and the dialogue-turn wiring
// ---------------------------------------------------------------------------

describe('Turn Pipeline — dialogue turn wiring', () => {
  it('refuses say with no open scene: a single fact + done, no model call, no commit (Req 15.4)', async () => {
    const actionLog = new ActionLog();
    let classified = 0;
    let voiced = 0;
    // No scene open (plain makeEngine): the gate fires before any seam.
    const { engine } = makeEngine({
      actionLog,
      classify: () => {
        classified += 1;
        return Promise.resolve('ask');
      },
      voice: () => {
        voiced += 1;
        return Promise.resolve({ released: ['...'], speaker: 'x' });
      },
    });

    const before = engine.state;
    const chunks = await drain(engine.say('Hello?'));

    expect(chunks.map((c) => c.kind)).toEqual(['fact', 'done']);
    expect(classified).toBe(0);
    expect(voiced).toBe(0);
    expect(engine.state).toBe(before);
    expect(actionLog.length).toBe(0);
  });

  it('applies the classified Intent to the scene NPC Relationship BEFORE the reply streams (Req 15.5)', async () => {
    // The voice seam records the scene NPC's suspicion at the moment it runs, to
    // prove the Intent was applied to the Draft before the reply was voiced.
    const { engine, npc } = makeSceneEngine({
      classify: () => Promise.resolve('threaten'),
      voice: () =>
        Promise.resolve({ released: ['I have nothing to say.'], speaker: 'The contact' }),
    });

    const before = engine.state.relationships[npc]?.suspicion ?? 0;
    await drain(engine.say('You are lying to me.'));
    const after = engine.state.relationships[npc]?.suspicion ?? 0;

    // A `threaten` Intent raises suspicion sharply: the committed Relationship
    // moved, which only happens if applyDialogueTurn ran on the Draft.
    expect(after).toBeGreaterThan(before);
  });

  it('appends both the player line and the NPC reply to the scene recent turns (Req 15.9)', async () => {
    const { engine } = makeSceneEngine({
      classify: () => Promise.resolve('ask'),
      voice: () =>
        Promise.resolve({ released: ['The courier left on Tuesday.'], speaker: 'The contact' }),
    });

    await drain(engine.say('When did the courier leave?'));

    const recent = engine.state.player.scene?.recent ?? [];
    expect(recent).toHaveLength(2);
    expect(recent[0]).toMatchObject({ speaker: 'player', text: 'When did the courier leave?' });
    expect(recent[1]).toMatchObject({ speaker: 'npc', text: 'The courier left on Tuesday.' });
  });

  it('tags speech with the scene NPC player-facing name and enqueues extraction keyed to that NPC (Req 15.10, 15.11)', async () => {
    const extractionQueue = new ExtractionQueue();
    const { engine, npc, state } = makeSceneEngine({
      extractionQueue,
      classify: () => Promise.resolve('ask'),
      // Echo the speaker name the pipeline passed in.
      voice: (_line, _intent, scene) =>
        Promise.resolve({ released: ['Nothing.'], speaker: scene.speakerName }),
    });

    const chunks = await drain(engine.say('Well?'));
    const speech = chunks.find((c) => c.kind === 'speech');
    expect(speech && speech.kind === 'speech' && speech.speaker.length).toBeGreaterThan(0);

    // The extraction job is keyed to the real scene NPC.
    const [job] = extractionQueue.pending();
    expect(job?.speaker).toBe(npc);
    void state;
  });

  it('rejects a money-pitch offer the Budget cannot cover before any model call (Req 15.7)', async () => {
    let classified = 0;
    const { engine } = makeSceneEngine({
      classify: () => {
        classified += 1;
        return Promise.resolve('pitch-money');
      },
      voice: () => Promise.resolve({ released: ['x'], speaker: 'y' }),
    });

    const over = balance(engine.state.station.ledger) + 1;
    const before = engine.state;
    const chunks = await drain(engine.say('Work for us.', { offer: over }));

    expect(chunks.map((c) => c.kind)).toEqual(['fact', 'done']);
    expect(classified).toBe(0);
    expect(engine.state).toBe(before);
  });

  it('debits the Budget for a covered money-pitch offer (Req 15.7)', async () => {
    const { engine } = makeSceneEngine({
      classify: () => Promise.resolve('pitch-money'),
      voice: () => Promise.resolve({ released: ['I will think about it.'], speaker: 'The contact' }),
    });

    const before = balance(engine.state.station.ledger);
    const offer = Math.min(before, 100);
    await drain(engine.say('Here is something for your trouble.', { offer }));
    const after = balance(engine.state.station.ledger);

    expect(after).toBe(before - offer);
  });

  it('clears the open Talk Scene on endScene at commit (Req 15.3)', async () => {
    const { engine } = makeSceneEngine();
    expect(engine.state.player.scene).toBeDefined();

    const chunks = await drain(engine.endScene());
    expect(chunks.at(-1)?.kind).toBe('done');
    expect(engine.state.player.scene).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Extraction: enqueue, boundary commit in turn order, extraction-commit log
// ---------------------------------------------------------------------------

describe('Turn Pipeline — two-phase extraction boundary', () => {
  /**
   * A phase-1 {@link ExtractionRunner} driven from a per-turn `ready` map, which
   * records every `start`/`ready` call. The commit (phase 2) is owned by the
   * pipeline; a committed job is observed through the `extraction-commit` log
   * entry it appends, so these tests pin the pipeline's ordering and logging
   * without the runner owning the Case File write.
   */
  function scriptedRunner(
    readyFor: (job: QueuedExtraction) => ExtractionReady,
  ): { runner: ExtractionRunner; started: string[] } {
    const started: string[] = [];
    const runner: ExtractionRunner = {
      start: (job) => {
        started.push(job.turnId);
      },
      ready: (job) => readyFor(job),
    };
    return { runner, started };
  }

  it("commits a dialogue turn's extraction at the next boundary and logs extraction-commit (Req 17.1, 17.5)", async () => {
    const actionLog = new ActionLog();
    const extractionQueue = new ExtractionQueue();
    // Every job's phase-1 result is a parsed, empty extraction result.
    const { runner, started } = scriptedRunner(() => ({ kind: 'parsed', result: { claims: [] } }));

    const { engine } = makeSceneEngine({
      actionLog,
      extractionQueue,
      extraction: runner,
      voice: (line) =>
        Promise.resolve({ released: [`reply to: ${line}`], speaker: 'The contact' }),
    });

    // First dialogue turn: enqueues an extraction job and kicks off phase 1,
    // nothing committed yet.
    await drain(engine.say('one'));
    expect(extractionQueue.length).toBe(1);
    expect(started).toEqual(['turn:0']);
    expect(actionLog.all().some((e) => e.kind === 'extraction-commit')).toBe(false);

    // Second dialogue turn: its boundary (step 1) drains the first job's ready
    // result, committing it (phase 2) and logging an extraction-commit before
    // the new turn's work.
    await drain(engine.say('two'));
    const extractionCommits = actionLog.all().filter((e) => e.kind === 'extraction-commit');
    expect(extractionCommits).toHaveLength(1);
    expect(extractionCommits[0].kind === 'extraction-commit' && extractionCommits[0].forTurn).toBe(
      'turn:0',
    );
    // The second turn enqueued its own job, still pending.
    expect(extractionQueue.length).toBe(1);
  });

  it('commits extraction results strictly in turn order, holding a later turn behind an unready one', async () => {
    const actionLog = new ActionLog();
    const extractionQueue = new ExtractionQueue();
    // turn:0's result is never ready; turn:1's would be, but must wait behind it.
    const { runner } = scriptedRunner((job): ExtractionReady =>
      job.turnId === 'turn:0' ? 'pending' : { kind: 'parsed', result: { claims: [] } },
    );
    const { engine } = makeSceneEngine({
      actionLog,
      extractionQueue,
      extraction: runner,
      voice: (line) => Promise.resolve({ released: [line], speaker: 'The contact' }),
    });

    await drain(engine.say('a')); // turn:0 enqueued
    await drain(engine.say('b')); // turn:1 enqueued; boundary cannot drain turn:0
    await drain(engine.say('c')); // boundary still blocked on turn:0

    // Nothing committed: turn:1 is held behind turn:0 (design step 7).
    expect(actionLog.all().some((e) => e.kind === 'extraction-commit')).toBe(false);
    expect(extractionQueue.length).toBe(3);
  });

  it('runs the pure phase-2 evaluateExtraction over the turn draft and writes npc Claims + the Told List (Req 17.2)', async () => {
    // A Truth Store must be wired for phase 2 to commit anything. Build the
    // facade with a Truth Store on the resolver context and a fake, pure
    // `evaluateExtraction` that returns one view-safe Claim and an appended
    // Told List over a bespoke Proposition.
    const base = world('alpha');
    const npc = firstNpc(base);
    const state = withScene(base, npc);
    const caseFile = new CaseFile();
    const truth = TruthStore.create(content.predicates.evaluators);
    const ctx: ResolverContext = { content, truth };

    const prop = {
      id: 'claim:extracted:1',
      subject: npc,
      predicate: 'MEMBER_OF',
      object: 'org:x',
    } as unknown as Proposition;

    let sawTruthDraft = false;
    const evaluateExtraction: EvaluateExtraction = (inputs) => {
      // Phase 2 is handed the turn's TruthDraft as its store (not the live one):
      // writing through it must not reach the live store until commit. Prove the
      // store it got is not the live TruthStore instance.
      sawTruthDraft = (inputs.truth as unknown) !== truth;
      return {
        truthRecords: [],
        claims: [
          { id: prop.id, prop, speaker: inputs.speaker, observedAt: inputs.at, hedged: false },
        ],
        toldList: [...inputs.toldList, prop],
        chanceLeaks: [],
        consistencyViolations: [],
      };
    };

    const turnDriver = createTurnDriver({
      extraction: {
        start: () => undefined,
        ready: (): ExtractionReady => ({
          kind: 'parsed',
          result: { claims: [{ predicate: 'MEMBER_OF', subject: npc, object: 'org:x', hedged: false }] },
        }),
      },
      evaluateExtraction,
      voice: (line) => Promise.resolve({ released: [line], speaker: 'The contact' }),
    });
    const engine = new PlayerViewEngine({
      state,
      caseFile,
      journal: new Journal(),
      cityData,
      ctx,
      brief: EMPTY_BRIEF,
      rules: NO_RULES,
      notifications: new NotificationStore(),
      truth,
      turnDriver,
    });

    await drain(engine.say('first')); // enqueue turn:0
    expect(caseFile.size).toBe(0); // not committed until the next boundary
    await drain(engine.say('second')); // boundary commits turn:0

    expect(sawTruthDraft).toBe(true);
    // One `npc` Claim filed, sourced to the speaker.
    const claims = caseFile.list();
    expect(claims).toHaveLength(1);
    expect(claims[0]?.source).toEqual({ kind: 'npc', npc });
    // The speaker's Told List was written back onto the committed WorldState.
    expect(engine.state.told[npc]).toHaveLength(1);
  });

  it('files an unparsed note and still logs extraction-commit, with no Truth write (Req 17.3)', async () => {
    const actionLog = new ActionLog();
    const journal = new Journal();
    const extractionQueue = new ExtractionQueue();
    const base = world('alpha');
    const npc = firstNpc(base);
    const state = withScene(base, npc);
    const truth = TruthStore.create(content.predicates.evaluators);
    const factsBefore = truth.facts().length;

    const turnDriver = createTurnDriver({
      actionLog,
      extractionQueue,
      extraction: {
        start: () => undefined,
        ready: (): ExtractionReady => ({ kind: 'unparsed', excerpt: 'a muttered line' }),
      },
      voice: (line) => Promise.resolve({ released: [line], speaker: 'The contact' }),
    });
    const engine = new PlayerViewEngine({
      state,
      caseFile: new CaseFile(),
      journal,
      cityData,
      ctx: { content, truth },
      brief: EMPTY_BRIEF,
      rules: NO_RULES,
      notifications: new NotificationStore(),
      truth,
      turnDriver,
    });

    await drain(engine.say('one')); // enqueue turn:0
    await drain(engine.say('two')); // boundary files the unparsed note

    // The excerpt was filed as a note (the default sink), attached to the speaker.
    const note = journal.notes().find((n) => n.text === 'a muttered line');
    expect(note).toBeDefined();
    expect(note?.attachTo).toBe(npc);
    // The extraction-commit position is still logged.
    const commits = actionLog.all().filter((e) => e.kind === 'extraction-commit');
    expect(commits).toHaveLength(1);
    expect(commits[0].kind === 'extraction-commit' && commits[0].forTurn).toBe('turn:0');
    // No Truth write for an unparsed result.
    expect(truth.facts().length).toBe(factsBefore);
    expect(engine.state.told[npc] ?? []).toHaveLength(0);
  });

  it('keeps an unreachable job queued, adds one notice, and does not pause the game (Req 17.6)', async () => {
    const actionLog = new ActionLog();
    const extractionQueue = new ExtractionQueue();
    const notices: QueuedExtraction[] = [];
    const { engine } = makeSceneEngine({
      actionLog,
      extractionQueue,
      extraction: {
        start: () => undefined,
        ready: (): ExtractionReady => 'unreachable',
      },
      unreachableNotice: (job) => notices.push(job),
      voice: (line) => Promise.resolve({ released: [line], speaker: 'The contact' }),
    });

    await drain(engine.say('a')); // turn:0 enqueued
    const chunksB = await drain(engine.say('b')); // boundary: turn:0 unreachable
    const chunksC = await drain(engine.say('c')); // boundary: still unreachable

    // The jobs stay queued and nothing was committed.
    expect(extractionQueue.length).toBe(3);
    expect(actionLog.all().some((e) => e.kind === 'extraction-commit')).toBe(false);
    // The game never paused: each turn completed normally.
    expect(chunksB.at(-1)?.kind).toBe('done');
    expect(chunksC.at(-1)?.kind).toBe('done');
    expect(chunksB.some((c) => c.kind === 'paused')).toBe(false);
    // Exactly one notice for the sustained outage (de-duped across boundaries).
    expect(notices).toHaveLength(1);
    expect(notices[0]?.turnId).toBe('turn:0');
  });
});

// ---------------------------------------------------------------------------
// Hint triggers streamed through the pipeline (task 8.8; design, "Hints";
// Req 19.10)
// ---------------------------------------------------------------------------
//
// `hintTriggers` (the trigger-detection logic) is exhaustively unit-tested in
// `../aids/hints-triggers.spec.ts`. These tests pin the OTHER half the task
// owns: the Turn Pipeline's wiring of that logic — after a turn commits, it
// `fire`s each held trigger on the facade's HintStore and streams the ones that
// are not yet seen as `{ kind: 'hint'; text }` chunks, the first time only
// (first-occurrence), in the fixed order, and nothing when hints are disabled.
//
// A one-phase WAIT advances the clock from the start of the game (day 0 phase 0)
// to day 0 phase 1 — no Day Boundary is crossed, so the hooks do not run and the
// committed state keeps the field each trigger reads. That lets each state- and
// Case File-driven trigger be set up with a narrow override and surfaced through
// the real action pipeline.

describe('Turn Pipeline — hint triggers streamed on a committed turn (Req 19.10)', () => {
  const SOME_PREDICATE = (() => {
    const p = content.predicates.predicates.find((d) => d.id !== 'IS_ALIAS_OF');
    if (p === undefined) throw new Error('core pack defines no non-alias predicate');
    return p.id;
  })();

  /**
   * Build a facade whose live state is `state`, wired with hints ENABLED (a real
   * {@link HintStore} over the core content) and seeded Case File. The pipeline
   * is model-free: a WAIT turn runs the action path and fires the hint triggers
   * from the committed state.
   */
  function makeHintEngine(state: WorldState, caseFile = new CaseFile()) {
    const hints = new HintStore(content, /* enabled */ true);
    const ctx: ResolverContext = { content };
    const turnDriver = createTurnDriver({});
    const engine = new PlayerViewEngine({
      state,
      caseFile,
      journal: new Journal(),
      cityData,
      ctx,
      brief: EMPTY_BRIEF,
      rules: NO_RULES,
      notifications: new NotificationStore(),
      hints,
      turnDriver,
    });
    return { engine, hints };
  }

  /** The authored text for a trigger (the pack defines one per trigger). */
  function hintTextFor(hints: HintStore, trigger: Parameters<HintStore['peek']>[0]): string {
    const view = hints.peek(trigger);
    if (view === undefined) throw new Error(`no authored hint for ${trigger}`);
    return view.text;
  }

  /** A Case File holding one Claim referencing an Unidentified Subject. */
  function unkCaseFile(now: GameTime): CaseFile {
    const caseFile = new CaseFile();
    caseFile.add({
      source: { kind: 'surveillance', loc: 'loc:cafe' },
      prop: { id: 'p:unk:0', subject: 'unk:3', predicate: SOME_PREDICATE, object: 'loc:cafe' },
      observedAt: now,
    });
    return caseFile;
  }

  /** Drain the ledger to just under 20% of the starting Budget. */
  function budgetLow(base: WorldState): WorldState {
    const start = base.station.ledger.start;
    return {
      ...base,
      station: {
        ...base.station,
        ledger: {
          ...base.station.ledger,
          entries: [
            { at: base.time, amount: -(start - Math.floor(0.2 * start) + 1), reason: 'pay' },
          ],
        },
      },
    };
  }

  it('streams first-document when the committed state has a read Document', async () => {
    const base = world('alpha');
    const state: WorldState = {
      ...base,
      player: { ...base.player, readDocuments: ['doc:leaflet' as DocId] },
    };
    const { engine, hints } = makeHintEngine(state);

    const chunks = await drain(engine.act(WAIT));
    const hintChunks = chunks.filter((c) => c.kind === 'hint');
    expect(hintChunks).toContainEqual({
      kind: 'hint',
      text: hintTextFor(hints, 'first-document'),
    });
  });

  it('streams first-recruitment once a Relationship is recruited', async () => {
    const base = world('alpha');
    const npc = firstNpc(base);
    const rel = { ...base.relationships[npc], recruited: true };
    const state: WorldState = {
      ...base,
      relationships: { ...base.relationships, [npc]: rel },
    };
    const { engine, hints } = makeHintEngine(state);

    const chunks = await drain(engine.act(WAIT));
    expect(chunks.filter((c) => c.kind === 'hint')).toContainEqual({
      kind: 'hint',
      text: hintTextFor(hints, 'first-recruitment'),
    });
  });

  it('streams first-unidentified-subject from an unk: Claim in the Case File', async () => {
    const base = world('alpha');
    const { engine, hints } = makeHintEngine(base, unkCaseFile(base.time));

    const chunks = await drain(engine.act(WAIT));
    expect(chunks.filter((c) => c.kind === 'hint')).toContainEqual({
      kind: 'hint',
      text: hintTextFor(hints, 'first-unidentified-subject'),
    });
  });

  it('streams standing-low when Standing is below zero', async () => {
    const base = world('alpha');
    const state: WorldState = { ...base, station: { ...base.station, standing: -1 } };
    const { engine, hints } = makeHintEngine(state);

    const chunks = await drain(engine.act(WAIT));
    expect(chunks.filter((c) => c.kind === 'hint')).toContainEqual({
      kind: 'hint',
      text: hintTextFor(hints, 'standing-low'),
    });
  });

  it('streams budget-low when the Budget is below 20% of the start', async () => {
    const { engine, hints } = makeHintEngine(budgetLow(world('alpha')));

    const chunks = await drain(engine.act(WAIT));
    expect(chunks.filter((c) => c.kind === 'hint')).toContainEqual({
      kind: 'hint',
      text: hintTextFor(hints, 'budget-low'),
    });
  });

  it('streams directive-near-deadline for an open Directive due within a day', async () => {
    const base = world('alpha');
    const now = base.time;
    const directive: Directive = {
      id: 'dir:1',
      text: 'Identify the resident.',
      objective: { kind: 'recruit', count: 1 },
      deadline: { day: now.day + 1, phase: now.phase },
      reward: 1,
      status: 'open',
    };
    const state: WorldState = {
      ...base,
      station: { ...base.station, directives: [directive] },
    };
    const { engine, hints } = makeHintEngine(state);

    const chunks = await drain(engine.act(WAIT));
    expect(chunks.filter((c) => c.kind === 'hint')).toContainEqual({
      kind: 'hint',
      text: hintTextFor(hints, 'directive-near-deadline'),
    });
  });

  it('streams plot-deadline-near from a brief lead Claim with a near stated deadline', async () => {
    const base = world('alpha');
    const now = base.time;
    const briefDoc = 'doc:brief-cable' as DocId;
    const caseFile = new CaseFile();
    caseFile.add({
      source: { kind: 'document', id: briefDoc },
      prop: {
        id: 'p:lead:0',
        subject: 'npc:target',
        predicate: SOME_PREDICATE,
        object: 'loc:depot',
        window: { from: now, to: { day: now.day + 1, phase: now.phase } },
      },
      observedAt: now,
    });

    // The pipeline needs to know which Case File Claims are brief leads.
    const hints = new HintStore(content, true);
    const turnDriver = createTurnDriver({ briefLeadDocs: new Set([briefDoc]) });
    const engine = new PlayerViewEngine({
      state: base,
      caseFile,
      journal: new Journal(),
      cityData,
      ctx: { content },
      brief: EMPTY_BRIEF,
      rules: NO_RULES,
      notifications: new NotificationStore(),
      hints,
      turnDriver,
    });

    const chunks = await drain(engine.act(WAIT));
    expect(chunks.filter((c) => c.kind === 'hint')).toContainEqual({
      kind: 'hint',
      text: hintTextFor(hints, 'plot-deadline-near'),
    });
  });

  it('streams first-dead-drop from the committed service-drop action', async () => {
    // `first-dead-drop` reads the committed action, not just state. Drive a
    // service-drop whose quote is allowed through the catalogue; the trigger
    // fires regardless of what the drop observed. We find an allowed drop from
    // the action catalogue so the quote lets the turn commit.
    const base = world('alpha');
    const { engine, hints } = makeHintEngine(base);
    const dropOption = engine
      .actions()
      .find((o) => o.action.kind === 'service-drop' && o.quote.allowed);
    if (dropOption === undefined) {
      // No allowed service-drop in this generated world: assert the trigger does
      // not fire for a plain WAIT (the negative wiring), which still exercises
      // the action-reading branch.
      const chunks = await drain(engine.act(WAIT));
      expect(
        chunks.some(
          (c) => c.kind === 'hint' && c.text === hintTextFor(hints, 'first-dead-drop'),
        ),
      ).toBe(false);
      return;
    }
    const chunks = await drain(engine.act(dropOption.action));
    expect(chunks.filter((c) => c.kind === 'hint')).toContainEqual({
      kind: 'hint',
      text: hintTextFor(hints, 'first-dead-drop'),
    });
  });

  it('fires a persistent trigger only the first time (first-occurrence rule)', async () => {
    // budget-low holds every turn (the Budget never recovers), but the hint
    // shows once: the HintStore keeps the seen flag across turns.
    const { engine } = makeHintEngine(budgetLow(world('alpha')));

    const first = await drain(engine.act(WAIT));
    const second = await drain(engine.act(WAIT));

    expect(first.filter((c) => c.kind === 'hint')).not.toHaveLength(0);
    expect(second.filter((c) => c.kind === 'hint')).toHaveLength(0);
  });

  it('streams no hint chunks when hints are disabled', async () => {
    const base = world('alpha');
    const state: WorldState = {
      ...base,
      player: { ...base.player, readDocuments: ['doc:leaflet' as DocId] },
      station: { ...base.station, standing: -1 },
    };
    // makeEngine builds the facade with hints disabled by default (no HintStore,
    // hintsEnabled defaults to false).
    const caseFile = new CaseFile();
    const turnDriver = createTurnDriver({});
    const engine = new PlayerViewEngine({
      state,
      caseFile,
      journal: new Journal(),
      cityData,
      ctx: { content },
      brief: EMPTY_BRIEF,
      rules: NO_RULES,
      notifications: new NotificationStore(),
      turnDriver,
    });

    const chunks = await drain(engine.act(WAIT));
    expect(chunks.some((c) => c.kind === 'hint')).toBe(false);
  });

  it('fires a landed-recruitment hint on a dialogue turn (the dialogue path streams hints too)', async () => {
    const base = world('alpha');
    const npc = firstNpc(base);
    // Open a scene AND pre-recruit the NPC, so the committed dialogue turn's
    // state satisfies first-recruitment and the dialogue path's streamHints
    // fires it.
    const rel = { ...base.relationships[npc], recruited: true };
    const scene: TalkScene = {
      npc,
      kind: 'routine',
      openedAt: base.time,
      via: 'talk',
      recent: [],
    };
    const state: WorldState = {
      ...base,
      relationships: { ...base.relationships, [npc]: rel },
      player: { ...base.player, scene },
    };
    const hints = new HintStore(content, true);
    const turnDriver = createTurnDriver({
      classify: () => Promise.resolve('ask'),
      voice: () => Promise.resolve({ released: ['As you wish.'], speaker: 'The contact' }),
    });
    const engine = new PlayerViewEngine({
      state,
      caseFile: new CaseFile(),
      journal: new Journal(),
      cityData,
      ctx: { content },
      brief: EMPTY_BRIEF,
      rules: NO_RULES,
      notifications: new NotificationStore(),
      hints,
      turnDriver,
    });

    const chunks = await drain(engine.say('Keep working with us.'));
    expect(chunks.filter((c) => c.kind === 'hint')).toContainEqual({
      kind: 'hint',
      text: hints.peek('first-recruitment')?.text,
    });
  });
});

// ---------------------------------------------------------------------------
// The hook-throw path (task 8.8; design, "Turn Pipeline": "If a hook or the
// Phase Step throws, discard the Draft, stream 'The turn could not be
// completed'"; Req 5.4)
// ---------------------------------------------------------------------------

describe('Turn Pipeline — hook-throw path', () => {
  /**
   * Build an {@link AdvanceWorldDeps} whose `plot` Day-Boundary Hook throws, with
   * the other three production hooks intact. `advanceWorld` runs the hooks at a
   * Day Boundary, so a WAIT that crosses one (4 phases from the start) hits the
   * throwing hook mid-advance.
   */
  function throwingAdvance(state: WorldState): AdvanceWorldDeps {
    const hooks = buildWorldHooks();
    return {
      content,
      cityData,
      hooks: {
        ...hooks,
        plot: () => {
          throw new Error('plot hook blew up');
        },
      },
      objectives: () => () => false,
      cipherKeys: worldCipherKeyLookup(state.meta.seed, state.documents),
    };
  }

  /** A facade wired with the throwing `advance` deps and a shared action log. */
  function makeThrowEngine() {
    const state = world('alpha');
    const caseFile = new CaseFile();
    const journal = new Journal();
    const notifications = new NotificationStore();
    const actionLog = new ActionLog();
    const turnDriver = createTurnDriver({ actionLog });
    const engine = new PlayerViewEngine({
      state,
      caseFile,
      journal,
      cityData,
      ctx: { content },
      brief: EMPTY_BRIEF,
      rules: NO_RULES,
      notifications,
      advance: throwingAdvance(state),
      turnDriver,
    });
    return { engine, caseFile, journal, notifications, actionLog, before: state };
  }

  /** A WAIT of 4 phases crosses a Day Boundary from the day-0, phase-0 start. */
  const WAIT_OVER_BOUNDARY: Action = { kind: 'wait', phases: 4 };

  it('streams "the turn could not be completed" and commits nothing when a hook throws (Req 5.4)', async () => {
    const { engine, journal, notifications, actionLog, before } = makeThrowEngine();

    const chunks = await drain(engine.act(WAIT_OVER_BOUNDARY));

    // Nothing committed: the state is the SAME reference (an immutable value, so
    // a commit would swap it), and the log, Journal and Notifications are all
    // untouched — the whole draft (incl. the Truth draft) was discarded.
    expect(engine.state).toBe(before);
    expect(actionLog.length).toBe(0);
    expect(journal.entryCount).toBe(0);
    expect(notifications.count).toBe(0);

    // The stream is the fixed failure line and `done` — no fact lines from the
    // action, no notifications, no narration.
    const kinds = chunks.map((c) => c.kind);
    expect(kinds).toEqual(['fact', 'done']);
    const fact = chunks[0];
    expect(fact.kind === 'fact' && fact.text).toBe('The turn could not be completed.');
  });

  it('does not pause the turn or stream an ended chunk on a hook throw', async () => {
    const { engine } = makeThrowEngine();
    const chunks = await drain(engine.act(WAIT_OVER_BOUNDARY));
    const kinds = chunks.map((c) => c.kind);
    // An action-turn hook throw is a draft discard, not a model-endpoint pause.
    expect(kinds).not.toContain('paused');
    expect(kinds).not.toContain('ended');
    expect(kinds).not.toContain('flavour');
  });
});

// ---------------------------------------------------------------------------
// The Outcome-Record write failure path (task 8.8; design, "Turn Pipeline"
// step 9 error table; Req 7.6)
// ---------------------------------------------------------------------------

describe('Turn Pipeline — Outcome-Record write failure path', () => {
  /** A sink that always throws, counting its calls. */
  function throwingSink(): { sink: OutcomeSink; readonly calls: number } {
    const box = { calls: 0 };
    const sink: OutcomeSink = () => {
      box.calls += 1;
      throw new Error('fs write failed');
    };
    return {
      sink,
      get calls() {
        return box.calls;
      },
    };
  }

  /** Build a facade with a Truth Store and the given Outcome Sink; no model seams. */
  function makeEndEngine(sink: OutcomeSink, outcomeWritten = false) {
    const truth = TruthStore.create(content.predicates.evaluators);
    const state = world('alpha');
    const caseFile = new CaseFile();
    const turnDriver = createTurnDriver({
      outcomes: sink,
      outcomeWritten,
      actionLog: new ActionLog(),
      extractionQueue: new ExtractionQueue(),
    });
    const engine = new PlayerViewEngine({
      state,
      caseFile,
      journal: new Journal(),
      cityData,
      ctx: { content, truth },
      brief: EMPTY_BRIEF,
      rules: NO_RULES,
      notifications: new NotificationStore(),
      truth,
      turnDriver,
    });
    return { engine, truth };
  }

  /** Drive the game to its first End Condition with a long action-only walk. */
  async function driveToEnd(engine: PlayerViewEngine): Promise<void> {
    for (let i = 0; i < 120 && engine.state.ended === undefined; i++) {
      await drain(engine.act({ kind: 'wait', phases: 4 }));
    }
    if (engine.state.ended === undefined) {
      throw new Error('the walk did not reach an End Condition');
    }
  }

  it('keeps the committed end and streams it even though the sink threw (Req 7.6)', async () => {
    const sink = throwingSink();
    const { engine } = makeEndEngine(sink.sink);

    // Drive to the ending turn, draining each stream — a throwing sink must never
    // propagate out of the pipeline, so none of these calls reject.
    for (let i = 0; i < 120 && engine.state.ended === undefined; i++) {
      // The ending turn's stream carries the `ended` chunk; earlier turns do not.
      await drain(engine.act({ kind: 'wait', phases: 4 }));
    }

    // The end stands: the committed state is ended (the turn committed before the
    // sink ran), and the sink was called exactly once (the first-ended turn).
    expect(engine.state.ended).toBeDefined();
    expect(sink.calls).toBe(1);
  });

  it('streams the ended chunk on the ending turn despite the sink failure', async () => {
    const sink = throwingSink();
    const { engine } = makeEndEngine(sink.sink);

    let endingChunks: TurnChunk[] | undefined;
    for (let i = 0; i < 120 && engine.state.ended === undefined; i++) {
      const endedBefore = engine.state.ended !== undefined;
      const chunks = await drain(engine.act({ kind: 'wait', phases: 4 }));
      if (!endedBefore && engine.state.ended !== undefined) {
        endingChunks = chunks;
      }
    }

    expect(endingChunks).toBeDefined();
    const kinds = (endingChunks as TurnChunk[]).map((c) => c.kind);
    // The committed turn still streams its end and completes normally.
    expect(kinds).toContain('ended');
    expect(kinds.at(-1)).toBe('done');
    // The sink's throw never surfaced as a `paused`/error chunk.
    expect(kinds).not.toContain('paused');
  });

  it('calls the sink exactly once even as further gated turns run after the end', async () => {
    // After the end commits (with a failed write), the ended gate rejects every
    // further action turn, so the pipeline never re-derives or re-attempts the
    // write on an action turn — the sink's throw is swallowed once and never
    // retried from a gated turn. This pins that a flaky sink does not cause a
    // write storm.
    const sink = throwingSink();
    const { engine } = makeEndEngine(sink.sink);
    await driveToEnd(engine);

    const endedState = engine.state;
    expect(sink.calls).toBe(1);

    // Keep acting: each turn hits the ended gate and commits nothing, and the
    // sink is not called again.
    for (let i = 0; i < 5; i++) {
      await drain(engine.act({ kind: 'wait', phases: 4 }));
      expect(engine.state).toBe(endedState);
      expect(sink.calls).toBe(1);
    }
  });

  it('writes the expected record when the sink succeeds (the write-success baseline)', async () => {
    // The positive counterpart: a working sink receives exactly the record the
    // engine derives off the first ended state, so the failure-path tests above
    // are about the SINK failing, not a derivation problem.
    const records: unknown[] = [];
    const okSink: OutcomeSink = (record) => {
      records.push(record);
    };
    const { engine, truth } = makeEndEngine(okSink);

    let firstEnded: WorldState | undefined;
    for (let i = 0; i < 120 && engine.state.ended === undefined; i++) {
      const endedBefore = engine.state.ended !== undefined;
      await drain(engine.act({ kind: 'wait', phases: 4 }));
      if (!endedBefore && engine.state.ended !== undefined) {
        firstEnded = engine.state;
      }
    }

    expect(firstEnded).toBeDefined();
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(buildOutcomeRecord(firstEnded as WorldState, truth));
  });
});
