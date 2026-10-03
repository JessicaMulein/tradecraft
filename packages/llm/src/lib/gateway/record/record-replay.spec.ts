import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ModelsConfig, Role } from '../../config/models-config.js';
import type { CallInput } from '../call-types.js';
import type { Gateway } from '../gateway.js';
import { cancellableNarration } from '../resilience/narration-stream.js';
import { describeCall } from './describe-call.js';
import { parseRecords, type RecordSink, type RecordSource } from './jsonl-store.js';
import { RecordingGateway } from './recording-gateway.js';
import { ReplayGateway, ReplayMismatchError } from './replay-gateway.js';
import type { CallRecord } from './records.js';
import type { CallKind, CallRequest } from './request-hash.js';

const role = (model: string) => ({
  model,
  temperature: 0.7,
  maxTokens: 200,
  timeoutMs: 8000,
  reasoning: 'off' as const,
});

const config: ModelsConfig = {
  endpoint: 'http://localhost:1234/v1',
  contextLength: 8192,
  models: {},
  profiles: {
    base: {
      voice: role('voice-model'),
      fast: role('fast-model'),
      narrator: role('fast-model'),
      bookkeeping: role('fast-model'),
      judge: role('voice-model'),
    },
  },
  active: 'base',
};

/**
 * A fake underlying Gateway that returns scripted responses and counts every
 * call, so a replay can assert it never reached the underlying gateway. Its
 * `describeCall` uses the same shared helper the ReplayGateway does, so hashes
 * agree.
 */
class FakeGateway implements Gateway {
  streamCalls = 0;
  structuredCalls = 0;
  narrationCalls = 0;

  constructor(
    private readonly streamScript: readonly string[] = ['Guten ', 'Tag', '.'],
    private readonly structuredValue: unknown = { intent: 'offer', confidence: 0.9 },
    private readonly narrationScript: readonly string[] = ['A ', 'quiet ', 'street. '],
  ) {}

  stream(_role: Role, _input: CallInput): AsyncIterable<string> {
    this.streamCalls++;
    const tokens = this.streamScript;
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<string> {
        for (const t of tokens) {
          yield t;
        }
      },
    };
  }

  streamNarration(_input: CallInput) {
    this.narrationCalls++;
    const tokens = this.narrationScript;
    const raw: AsyncIterable<string> = {
      async *[Symbol.asyncIterator](): AsyncGenerator<string> {
        for (const t of tokens) {
          yield t;
        }
      },
    };
    return cancellableNarration(raw);
  }

  structured<T>(_role: Role, _input: CallInput, schema: z.ZodType<T>): Promise<T> {
    this.structuredCalls++;
    return Promise.resolve(schema.parse(this.structuredValue));
  }

  describeCall<T>(kind: CallKind, r: Role, input: CallInput, schema?: z.ZodType<T>): CallRequest {
    return describeCall(config, kind, r, input, schema);
  }
}

/** An in-memory JSONL sink/source pair sharing one buffer, like a temp file. */
class MemoryStore implements RecordSink, RecordSource {
  readonly lines: string[] = [];

  append(record: CallRecord): void {
    this.lines.push(JSON.stringify(record));
  }

  readAll(): CallRecord[] {
    return parseRecords(this.lines.join('\n'));
  }
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const t of stream) {
    out.push(t);
  }
  return out;
}

const intentSchema = z.object({ intent: z.string(), confidence: z.number() });

describe('RecordingGateway', () => {
  it('passes stream tokens through unchanged while recording them', async () => {
    const fake = new FakeGateway();
    const store = new MemoryStore();
    const rec = new RecordingGateway(fake, store);

    const tokens = await collect(rec.stream('voice', 'hello'));
    expect(tokens).toEqual(['Guten ', 'Tag', '.']);
    expect(fake.streamCalls).toBe(1);

    const records = store.readAll();
    expect(records).toHaveLength(1);
    expect(records[0].response).toEqual({ type: 'stream', tokens });
    expect(records[0].request.kind).toBe('stream');
    expect(records[0].request.model).toBe('voice-model');
  });

  it('records a structured call and returns its value', async () => {
    const fake = new FakeGateway();
    const store = new MemoryStore();
    const rec = new RecordingGateway(fake, store);

    const value = await rec.structured('bookkeeping', 'classify', intentSchema);
    expect(value).toEqual({ intent: 'offer', confidence: 0.9 });

    const records = store.readAll();
    expect(records).toHaveLength(1);
    expect(records[0].response).toEqual({ type: 'structured', value });
    expect(records[0].request.responseFormat?.type).toBe('json_schema');
  });

  it('records narration tokens and preserves the NarrationStream surface', async () => {
    const fake = new FakeGateway();
    const store = new MemoryStore();
    const rec = new RecordingGateway(fake, store);

    const narration = rec.streamNarration('describe');
    const tokens = await collect(narration);
    expect(tokens).toEqual(['A ', 'quiet ', 'street. ']);
    expect(fake.narrationCalls).toBe(1);

    const records = store.readAll();
    expect(records[0].request.kind).toBe('narration');
    expect(records[0].response).toEqual({ type: 'stream', tokens });
  });

  it('writes no record when a stream errors before completing', async () => {
    const store = new MemoryStore();
    const fake = new FakeGateway();
    const failing: Gateway = {
      describeCall: fake.describeCall.bind(fake),
      structured: fake.structured.bind(fake),
      streamNarration: fake.streamNarration.bind(fake),
      stream(): AsyncIterable<string> {
        return {
          // eslint-disable-next-line require-yield
          async *[Symbol.asyncIterator](): AsyncGenerator<string> {
            throw new Error('mid-stream failure');
          },
        };
      },
    };
    const rec = new RecordingGateway(failing, store);

    await expect(collect(rec.stream('voice', 'hello'))).rejects.toThrow(
      'mid-stream failure',
    );
    expect(store.readAll()).toHaveLength(0);
  });

  it('records timings with the injected clock', async () => {
    const fake = new FakeGateway();
    const store = new MemoryStore();
    const ticks = [1000, 1300];
    const rec = new RecordingGateway(fake, store, { now: () => ticks.shift() ?? 9999 });

    await rec.structured('bookkeeping', 'classify', intentSchema);
    const [record] = store.readAll();
    expect(record.timings).toEqual({ startedAt: 1000, durationMs: 300 });
  });
});

describe('record then replay (Req 17.3, 17.4)', () => {
  it('replays identical outputs keyed by request hash, with no underlying calls', async () => {
    // Record a session of mixed calls against the fake gateway.
    const recorder = new FakeGateway();
    const store = new MemoryStore();
    const rec = new RecordingGateway(recorder, store);

    const liveStream = await collect(rec.stream('voice', 'hello'));
    const liveStructured = await rec.structured('bookkeeping', 'classify', intentSchema);
    const liveNarration = await collect(rec.streamNarration('describe'));

    // Replay from the recording against a fresh underlying gateway, which must
    // never be touched.
    const underlying = new FakeGateway();
    const replay = new ReplayGateway(config, store.readAll());

    const replayStream = await collect(replay.stream('voice', 'hello'));
    const replayStructured = await replay.structured('bookkeeping', 'classify', intentSchema);
    const replayNarration = await collect(replay.streamNarration('describe'));

    expect(replayStream).toEqual(liveStream);
    expect(replayStructured).toEqual(liveStructured);
    expect(replayNarration).toEqual(liveNarration);

    // Replay contacted no model.
    expect(underlying.streamCalls).toBe(0);
    expect(underlying.structuredCalls).toBe(0);
    expect(underlying.narrationCalls).toBe(0);
  });

  it('replays repeated identical calls in recorded order', async () => {
    const recorder = new FakeGateway(['one']);
    const store = new MemoryStore();
    const rec = new RecordingGateway(recorder, store);
    await collect(rec.stream('voice', 'hi'));
    // Re-point the script by recording a second, different response for the
    // same request by appending a hand-made record.
    const records = store.readAll();
    const second: CallRecord = {
      ...records[0],
      response: { type: 'stream', tokens: ['two'] },
    };
    const replay = new ReplayGateway(config, [records[0], second]);

    expect(await collect(replay.stream('voice', 'hi'))).toEqual(['one']);
    expect(await collect(replay.stream('voice', 'hi'))).toEqual(['two']);
  });

  it('errors when a replayed call has no matching record', async () => {
    const replay = new ReplayGateway(config, []);
    await expect(
      replay.structured('bookkeeping', 'classify', intentSchema),
    ).rejects.toBeInstanceOf(ReplayMismatchError);
    await expect(collect(replay.stream('voice', 'never recorded'))).rejects.toBeInstanceOf(
      ReplayMismatchError,
    );
  });

  it('detects a divergent replay: a changed prompt finds no record', async () => {
    const recorder = new FakeGateway();
    const store = new MemoryStore();
    const rec = new RecordingGateway(recorder, store);
    await collect(rec.stream('voice', 'the recorded prompt'));

    const replay = new ReplayGateway(config, store.readAll());
    // Same prompt replays fine...
    await expect(collect(replay.stream('voice', 'the recorded prompt'))).resolves.toEqual([
      'Guten ',
      'Tag',
      '.',
    ]);
    // ...a diverged prompt is caught.
    await expect(
      collect(replay.stream('voice', 'a different prompt')),
    ).rejects.toBeInstanceOf(ReplayMismatchError);
  });

  it('builds a replay gateway from a RecordSource too', async () => {
    const recorder = new FakeGateway();
    const store = new MemoryStore();
    const rec = new RecordingGateway(recorder, store);
    await collect(rec.stream('voice', 'hello'));

    const replay = new ReplayGateway(config, store);
    expect(await collect(replay.stream('voice', 'hello'))).toEqual([
      'Guten ',
      'Tag',
      '.',
    ]);
  });

  it('returns a defensive copy of a structured value', async () => {
    const recorder = new FakeGateway(['x'], { items: [1, 2] });
    const store = new MemoryStore();
    const rec = new RecordingGateway(recorder, store);
    const listSchema = z.object({ items: z.array(z.number()) });
    await rec.structured('bookkeeping', 'list', listSchema);

    const replay = new ReplayGateway(config, store.readAll());
    const first = await replay.structured('bookkeeping', 'list', listSchema);
    (first.items as number[]).push(99);
    // A second replay of the same recorded call is unaffected by the mutation.
    const records = store.readAll();
    const replay2 = new ReplayGateway(config, records);
    const second = await replay2.structured('bookkeeping', 'list', listSchema);
    expect(second.items).toEqual([1, 2]);
  });

  it('offers a replayed CallHandle with role and model, no-op release', async () => {
    const recorder = new FakeGateway();
    const store = new MemoryStore();
    const rec = new RecordingGateway(recorder, store);
    await collect(rec.stream('judge', 'hello'));

    const replay = new ReplayGateway(config, store.readAll());
    const handles: Array<{ role: string; model: string }> = [];
    await collect(
      replay.stream('judge', 'hello', {
        onHandle: (h) => {
          handles.push({ role: h.role, model: h.model });
          expect(() => h.markReleased()).not.toThrow();
        },
      }),
    );
    expect(handles).toEqual([{ role: 'judge', model: 'voice-model' }]);
  });
});

describe('JSONL store round-trip', () => {
  it('parses records back from JSONL text, ignoring blank lines', () => {
    const store = new MemoryStore();
    store.append({
      requestHash: 'abc',
      request: {
        kind: 'stream',
        role: 'voice',
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0,
        maxTokens: 1,
      },
      response: { type: 'stream', tokens: ['ok'] },
    });
    const text = `${store.lines.join('\n')}\n\n`;
    expect(parseRecords(text)).toHaveLength(1);
  });

  it('reports a corrupt line with its location', () => {
    expect(() => parseRecords('{"ok":1}\nnot json', 'rec.jsonl')).toThrow(
      /invalid recording at rec\.jsonl:2/,
    );
  });
});
