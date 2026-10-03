/**
 * Deterministic, offline spec for the first-live-session REPL (checkpoint 17),
 * now on the Composition Root (slice-integration task 17.1).
 *
 * This drives the REPL's session logic end to end through the real
 * {@link createGame} Composition Root with a FAKE gateway — NO live model, no
 * endpoint — so it is reproducible in CI. The session builds the game exactly
 * as the launcher does (the real engine, Turn Pipeline, Live Seams and Player
 * View facade), with only the model behind the gateway faked. It asserts the
 * three things the checkpoint tooling must do:
 *
 *   1. the scripted session runs through the Turn Pipeline end to end: reading
 *      the brief, the travel and surveil (`act`s, the latter streaming
 *      narration), the briefing and NPC talk (`say`s) and the `endScene` each
 *      produce the expected {@link TurnChunk} kinds;
 *   2. recording is enabled: the record sink the gateway is wrapped with
 *      receives a {@link CallRecord} for every model call the session makes;
 *   3. the post-session inspection renders non-empty: the Case File, the
 *      Journal and the ground-truth records all have content.
 *
 * The live gateway construction and the recording *file* live in the thin
 * `scripts/repl.ts`; here the same {@link RecordingGateway} wraps a fake
 * {@link Gateway} over an in-memory {@link RecordSink} and is injected into
 * `createGame` as a caller-supplied Gateway, so the record path is exercised
 * without touching the disk and the Composition Root builds its Live Seams over
 * the fake exactly as it would over a live endpoint.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

import { z, type ZodType } from 'zod';

import {
  RecordingGateway,
  canonicalJson,
  ModelsConfigSchema,
  type CallInput,
  type CallKind,
  type CallRecord,
  type CallRequest,
  type Gateway,
  type ModelsConfig,
  type NarrateOptions,
  type NarrationStream,
  type RecordSink,
  type Role,
  type StreamOptions,
} from '@tradecraft/llm';

import { renderInspection, runSession, type SessionEvent } from './session.js';

// Re-pinned under the content-expansion `generatorVersion` bump (the setting
// step moved slice step 1 to the setting stream, changing every seed's world).
// `vienna-repl-4` is the lowest `vienna-repl-*` seed on which the scripted
// session still has a contact present at a reachable Location — so the briefing
// and talk beats open a Talk Scene and stream speech, and the surveil beat
// streams Narrator Flavour — which the assertions below require.
const SEED = 'vienna-repl-4';

/**
 * The repository root the scenario's pack directories resolve against. This file
 * is at `packages/evals/src/lib/repl/`, so the repo root is five directories up.
 * The Composition Root joins `scenario.packs.dirs` (the core pack) onto this.
 */
const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../../../..');

/**
 * A minimal valid {@link ModelsConfig}. The session builds the game over the
 * injected fake Gateway, so the Composition Root never constructs an endpoint
 * client and this config's model ids are never used; it only has to validate so
 * `createGame`'s type is satisfied.
 */
function fakeModels(): ModelsConfig {
  const role = {
    model: 'fake-model',
    temperature: 0,
    maxTokens: 128,
    timeoutMs: 10_000,
    reasoning: 'off' as const,
  };
  const source = { format: 'mlx' as const, get: 'org/fake', key: 'org/fake' };
  return ModelsConfigSchema.parse({
    endpoint: 'http://localhost:1234/v1',
    contextLength: 8192,
    models: {
      'fake-model': {
        family: 'none',
        sources: [source, { ...source, format: 'gguf' as const }],
      },
    },
    profiles: {
      fake: {
        voice: role,
        fast: role,
        narrator: role,
        bookkeeping: role,
        judge: role,
      },
    },
    active: 'fake',
  });
}

// ---------------------------------------------------------------------------
// An in-memory record sink and a fake gateway
// ---------------------------------------------------------------------------

/** A {@link RecordSink} that keeps every appended record in memory. */
class MemoryRecordSink implements RecordSink {
  readonly records: CallRecord[] = [];
  append(record: CallRecord): void {
    this.records.push(record);
  }
}

/** Normalise a {@link CallInput} to a message list for the fake's describeCall. */
function toMessages(input: CallInput): readonly { role: 'system' | 'user' | 'assistant'; content: string }[] {
  return typeof input === 'string' ? [{ role: 'user', content: input }] : input;
}

/**
 * A minimal {@link Gateway} fake with canned, in-character output. `structured`
 * (the intent classifier) returns a legal Intent; `stream` yields a clean,
 * in-character reply for `voice` and vivid-but-leak-free Flavour for
 * `narrator`. `describeCall` returns a well-formed {@link CallRequest} so the
 * {@link RecordingGateway} can key and hash each record exactly as it would
 * over the live gateway.
 */
class FakeGateway implements Gateway {
  /** Every call the fake saw, for assertion. */
  readonly calls: { role: string; kind: CallKind }[] = [];

  async *stream(role: Role, _input: CallInput, _options?: StreamOptions): AsyncIterable<string> {
    this.calls.push({ role, kind: 'stream' });
    const text =
      role === 'narrator'
        ? 'The light falls grey across the stone. Somewhere a tram sighs and is gone.'
        : 'I keep my voice low. Walk with me; this is not a place to linger.';
    // Yield in a couple of chunks so the tee/sentence-splitting is exercised.
    yield `${text.slice(0, 20)}`;
    yield `${text.slice(20)}`;
  }

  async structured<T>(
    role: Role,
    _input: CallInput,
    schema: ZodType<T>,
    _options?: unknown,
  ): Promise<T> {
    this.calls.push({ role, kind: 'structured' });
    // The intent classifier constrains to `{ intent }`; return a legal value.
    return schema.parse({ intent: 'ask' });
  }

  streamNarration(_input: CallInput, _options?: NarrateOptions): NarrationStream {
    // The Live Seams use `stream('narrator', …)`, not `streamNarration`, so this
    // is never driven; a conformant stub (an empty async iterable) keeps the
    // interface satisfied without a generator the lint would flag.
    const empty: AsyncIterator<string> = {
      next: () => Promise.resolve({ done: true, value: undefined }),
    };
    return {
      [Symbol.asyncIterator]: () => empty,
      cancel: () => undefined,
      firstSentenceSeen: false,
      cancelled: false,
    };
  }

  describeCall<T>(kind: CallKind, role: Role, input: CallInput, _schema?: ZodType<T>): CallRequest {
    return {
      kind,
      role,
      model: `fake-${role}`,
      messages: toMessages(input),
      temperature: 0,
      maxTokens: 128,
    };
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Run the session with a recording-wrapped fake gateway and return everything to assert on. */
async function runFake() {
  const sink = new MemoryRecordSink();
  const fake = new FakeGateway();
  const gateway = new RecordingGateway(fake, sink);
  const events: SessionEvent[] = [];
  const result = await runSession({
    seed: SEED,
    repoRoot: REPO_ROOT,
    models: fakeModels(),
    gateway,
    sink: (e) => events.push(e),
  });
  return { sink, fake, events, result };
}

// Satisfy the unused-var guard: canonicalJson documents the hash contract the
// RecordingGateway relies on; reference it so the import is meaningful.
void canonicalJson;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('REPL first-live-session (checkpoint 17)', () => {
  it('runs the scripted session end to end through the Composition Root', async () => {
    const { events, result } = await runFake();

    // Every beat ran and produced a terminal `done` chunk.
    const beats = new Set(events.map((e) => e.beat));
    for (const beat of ['read-brief', 'briefing', 'surveil', 'talk', 'endScene'] as const) {
      expect(beats.has(beat)).toBe(true);
      const last = events.filter((e) => e.beat === beat).at(-1);
      expect(last?.chunk.kind).toBe('done');
    }

    // The briefing and the NPC talk streamed speech (the voice seam ran clean).
    const speech = events.filter((e) => e.chunk.kind === 'speech');
    expect(speech.length).toBeGreaterThan(0);

    // The surveil `act` streamed Narrator flavour after its facts.
    const surveil = events.filter((e) => e.beat === 'surveil').map((e) => e.chunk.kind);
    expect(surveil.includes('flavour')).toBe(true);
    const firstFlavour = surveil.indexOf('flavour');
    const lastFact = surveil.lastIndexOf('fact');
    if (lastFact !== -1) {
      expect(firstFlavour).toBeGreaterThan(lastFact);
    }

    // The session advanced the clock (travel + surveil cost phases).
    expect(result.finalState.time).not.toEqual(undefined);
  });

  it('records every model call (recording is enabled)', async () => {
    const { sink, fake } = await runFake();

    // The record sink received a record for every COMPLETED model call. The
    // RecordingGateway appends a record when a call finishes, so a stream the
    // Live Seams cancel mid-flight (a Leak/Specifics guard retry) counts as a
    // fake call but leaves no record — hence records are a non-empty subset of
    // the calls the fake saw, not an exact match.
    expect(sink.records.length).toBeGreaterThan(0);
    expect(sink.records.length).toBeLessThanOrEqual(fake.calls.length);

    // Records route by Model Role (Req 15.9): the classifier on `fast`, the
    // NPC reply on the role `routeTurnRole` picks from the scene's stakes and
    // the turn's Intent, and the Narrator on `narrator`. The scripted session
    // opens only routine scenes and the fake classifier returns the routine
    // `ask` Intent, so every NPC reply routes to `fast` — no record lands on
    // `voice`. (A high-stakes beat would, which task 11.5's seam tests cover.)
    const roles = new Set(sink.records.map((r) => r.request.role));
    expect(roles.has('fast')).toBe(true);
    expect(roles.has('voice')).toBe(false);
    expect(roles.has('narrator')).toBe(true);

    // Each record carries a request hash and a response (the record is complete).
    for (const record of sink.records) {
      expect(record.requestHash.length).toBeGreaterThan(0);
      expect(record.response).toBeDefined();
    }
  });

  it('renders a non-empty post-session inspection (Case File, Journal, truth)', async () => {
    const { result } = await runFake();
    const { inspection } = result;

    // The brief Cable rendered.
    expect(inspection.brief.length).toBeGreaterThan(0);

    // The Journal fact log is non-empty (the committed actions recorded facts).
    expect(inspection.journal.entries.length).toBeGreaterThan(0);

    // The ground-truth reveal dump has the TRUTH sections.
    expect(inspection.truthDump).toContain('TRUTH · Allegiances');
    expect(inspection.truthDump).toContain('TRUTH · Plot');

    // The rendered inspection text is non-empty and names its sections.
    const text = renderInspection(inspection);
    expect(text).toContain('== Case File ==');
    expect(text).toContain('== Journal ==');
    expect(text).toContain('== Truth records (ground truth) ==');
  });

  it('is deterministic in the seed (same session, same chunk kinds)', async () => {
    const a = await runFake();
    const b = await runFake();
    const kindsA = a.events.map((e) => `${e.beat}:${e.chunk.kind}`);
    const kindsB = b.events.map((e) => `${e.beat}:${e.chunk.kind}`);
    expect(kindsA).toEqual(kindsB);
  });
});

// A tiny self-check that the fake's structured schema path returns a legal
// Intent — guards against a future schema change silently breaking classify.
describe('REPL fake gateway', () => {
  it('classifies through the structured path to a legal Intent', async () => {
    const fake = new FakeGateway();
    const schema = z.object({ intent: z.enum(['ask', 'probe']) });
    const value = await fake.structured('fast', 'hello', schema);
    expect(value.intent).toBe('ask');
  });
});
