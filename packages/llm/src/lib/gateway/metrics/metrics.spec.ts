/**
 * Tests for play metrics recording (task 13.6; Requirements 15.3, 15.6).
 *
 * These drive the public `stream`, `structured` and `streamNarration` through a
 * mocked client, an in-memory metrics sink and a fake clock, so a recorded
 * `ttfsMs`, `durationMs` and `tokensPerSec` are exact asserted values rather
 * than flaky wall-clock deltas. They cover: a call records the right fields,
 * `markReleased()` sets time-to-first-sentence, tokens-per-second computed from
 * completion tokens and duration, best-effort recording (a failing sink does
 * not break the call), and that a record serialises to valid JSONL.
 */

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { ModelsConfig } from '../../config/models-config.js';
import {
  OpenAIGateway,
  type CallHandle,
  type ChatClient,
  type ChatCompletion,
  type ChatCompletionChunk,
  type ChatRequest,
  type GatewayClient,
} from '../openai-gateway.js';
import { parseRecords } from '../record/jsonl-store.js';
import type { Clock } from './clock.js';
import {
  InMemoryMetricsSink,
  type MetricsRecord,
} from './metrics-record.js';

type CreateFn = ChatClient['chat']['completions']['create'];

const role = (model: string, timeoutMs = 8000) => ({
  model,
  temperature: 0.7,
  maxTokens: 200,
  timeoutMs,
  reasoning: 'off' as const,
});

const config: ModelsConfig = {
  endpoint: 'http://localhost:1234/v1',
  contextLength: 8192,
  models: {},
  profiles: {
    main: {
      voice: role('voice-model'),
      fast: role('fast-model'),
      narrator: role('narrator-model'),
      bookkeeping: role('book-model'),
      judge: role('judge-model'),
    },
  },
  active: 'main',
};

const emptyModels: GatewayClient['models'] = {
  async *list() {
    /* no models needed */
  },
};

function clientFrom(create: CreateFn): GatewayClient {
  return { models: emptyModels, chat: { completions: { create } } };
}

function streamingClient(tokens: Array<string | null>): GatewayClient {
  const create = vi.fn(async (_body: ChatRequest) => {
    async function* chunks(): AsyncIterable<ChatCompletionChunk> {
      for (const content of tokens) {
        yield { choices: [{ delta: { content } }] };
      }
    }
    return chunks();
  });
  return clientFrom(create as unknown as CreateFn);
}

function structuredClient(content: string): GatewayClient {
  const create = vi.fn(
    async (_body: ChatRequest): Promise<ChatCompletion> => ({
      choices: [{ message: { content } }],
    }),
  );
  return clientFrom(create as unknown as CreateFn);
}

/** A fake clock that advances by a fixed step each time it is read. */
function steppingClock(start: number, step: number): Clock {
  let t = start;
  return {
    now() {
      const value = t;
      t += step;
      return value;
    },
  };
}

/** A clock whose readings are scripted; the last value repeats. */
function scriptedClock(readings: number[]): Clock {
  let i = 0;
  return {
    now() {
      const value = readings[Math.min(i, readings.length - 1)];
      i += 1;
      return value;
    },
  };
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const token of stream) {
    out.push(token);
  }
  return out;
}

describe('play metrics — streaming', () => {
  it('records role, model, purpose, tokens and outcome for a stream call', async () => {
    const sink = new InMemoryMetricsSink();
    const gateway = new OpenAIGateway(config, {
      client: streamingClient(['Guten ', 'Tag', '.']),
      metrics: sink,
      clock: steppingClock(1000, 10),
    });

    await collect(gateway.stream('voice', 'hi', { purpose: 'voice' }));

    expect(sink.records).toHaveLength(1);
    const record = sink.records[0];
    expect(record.role).toBe('voice');
    expect(record.model).toBe('voice-model');
    expect(record.purpose).toBe('voice');
    expect(record.completionTokens).toBe(3);
    expect(record.outcome).toBe('ok');
    expect(record.at).toBe(1000);
  });

  it('defaults purpose to the call kind when none is given', async () => {
    const sink = new InMemoryMetricsSink();
    const gateway = new OpenAIGateway(config, {
      client: streamingClient(['ok']),
      metrics: sink,
    });
    await collect(gateway.stream('voice', 'hi'));
    expect(sink.records[0].purpose).toBe('stream');
  });

  it('does not count empty or null deltas as completion tokens', async () => {
    const sink = new InMemoryMetricsSink();
    const gateway = new OpenAIGateway(config, {
      client: streamingClient(['', 'word', null, '!']),
      metrics: sink,
    });
    await collect(gateway.stream('voice', 'hi'));
    expect(sink.records[0].completionTokens).toBe(2);
  });

  it('sets ttfsMs from call start to markReleased()', async () => {
    const sink = new InMemoryMetricsSink();
    // Readings: start=0 (ctor), release=250, finish=400.
    const gateway = new OpenAIGateway(config, {
      client: streamingClient(['A ', 'B']),
      metrics: sink,
      clock: scriptedClock([0, 250, 400]),
    });

    let handle: CallHandle | undefined;
    const stream = gateway.stream('voice', 'hi', {
      onHandle: (h) => (handle = h),
    });
    // Consume one token, then report the release, then drain.
    const out: string[] = [];
    for await (const token of stream) {
      out.push(token);
      if (out.length === 1) {
        handle?.markReleased();
      }
    }

    const record = sink.records[0];
    expect(record.ttfsMs).toBe(250);
    expect(record.durationMs).toBe(400);
  });

  it('records a null ttfsMs when no sentence is released', async () => {
    const sink = new InMemoryMetricsSink();
    const gateway = new OpenAIGateway(config, {
      client: streamingClient(['x']),
      metrics: sink,
    });
    await collect(gateway.stream('voice', 'hi'));
    expect(sink.records[0].ttfsMs).toBeNull();
  });

  it('computes tokensPerSec from completion tokens and duration', async () => {
    const sink = new InMemoryMetricsSink();
    // start=0 (ctor), finish=2000ms → 2s. 4 tokens / 2s = 2 tokens/s.
    const gateway = new OpenAIGateway(config, {
      client: streamingClient(['a', 'b', 'c', 'd']),
      metrics: sink,
      clock: scriptedClock([0, 2000]),
    });
    await collect(gateway.stream('voice', 'hi'));
    const record = sink.records[0];
    expect(record.completionTokens).toBe(4);
    expect(record.durationMs).toBe(2000);
    expect(record.tokensPerSec).toBe(2);
  });

  it('records tokensPerSec as null when the duration is zero', async () => {
    const sink = new InMemoryMetricsSink();
    const gateway = new OpenAIGateway(config, {
      client: streamingClient(['a']),
      metrics: sink,
      clock: scriptedClock([5]), // every reading is the same instant
    });
    await collect(gateway.stream('voice', 'hi'));
    expect(sink.records[0].tokensPerSec).toBeNull();
  });

  it('is best effort: a failing sink does not break the call', async () => {
    const sink = new InMemoryMetricsSink({ throwOnAppend: true });
    const gateway = new OpenAIGateway(config, {
      client: streamingClient(['safe ', 'tokens']),
      metrics: sink,
    });
    await expect(collect(gateway.stream('voice', 'hi'))).resolves.toEqual([
      'safe ',
      'tokens',
    ]);
  });

  it('writes a record that round-trips as valid JSONL', async () => {
    const sink = new InMemoryMetricsSink();
    const gateway = new OpenAIGateway(config, {
      client: streamingClient(['x', 'y']),
      metrics: sink,
      clock: steppingClock(100, 5),
    });
    await collect(gateway.stream('voice', 'hi'));

    const line = `${JSON.stringify(sink.records[0])}\n`;
    const parsed = JSON.parse(line.trim()) as MetricsRecord;
    expect(parsed).toEqual(sink.records[0]);
    // The record-store line parser (shared JSONL format) accepts it too.
    expect(() => parseRecords(line)).not.toThrow();
  });
});

describe('play metrics — structured', () => {
  const schema = z.object({ intent: z.string() });

  it('records a structured call with purpose, tokens and ok outcome', async () => {
    const sink = new InMemoryMetricsSink();
    const gateway = new OpenAIGateway(config, {
      client: structuredClient(JSON.stringify({ intent: 'offer' })),
      metrics: sink,
      clock: steppingClock(0, 30),
    });

    const value = await gateway.structured('bookkeeping', 'classify', schema, {
      purpose: 'intent',
    });
    expect(value).toEqual({ intent: 'offer' });

    const record = sink.records[0];
    expect(record.role).toBe('bookkeeping');
    expect(record.model).toBe('book-model');
    expect(record.purpose).toBe('intent');
    expect(record.outcome).toBe('ok');
    // Completion tokens stand in as the JSON length of the validated value.
    expect(record.completionTokens).toBe(
      JSON.stringify({ intent: 'offer' }).length,
    );
  });

  it('reports the release for a structured value so ttfsMs is set', async () => {
    const sink = new InMemoryMetricsSink();
    const gateway = new OpenAIGateway(config, {
      client: structuredClient(JSON.stringify({ intent: 'ok' })),
      metrics: sink,
      clock: scriptedClock([0, 120]),
    });
    await gateway.structured('bookkeeping', 'classify', schema);
    expect(sink.records[0].ttfsMs).toBe(120);
  });

  it('records a rejected outcome when the response fails validation', async () => {
    const sink = new InMemoryMetricsSink();
    const gateway = new OpenAIGateway(config, {
      client: structuredClient(JSON.stringify({ intent: 42 })),
      metrics: sink,
    });
    await expect(
      gateway.structured('bookkeeping', 'classify', schema),
    ).rejects.toThrow();
    expect(sink.records[0].outcome).toBe('rejected');
  });

  it('records a fallback outcome when the call falls back to fast', async () => {
    const sink = new InMemoryMetricsSink();
    const create = vi.fn(async (body: ChatRequest) => {
      if (body.model !== 'fast-model') {
        throw new Error('role down');
      }
      return { choices: [{ message: { content: JSON.stringify({ intent: 'x' }) } }] };
    }) as unknown as CreateFn;
    const gateway = new OpenAIGateway(config, {
      client: clientFrom(create),
      metrics: sink,
    });

    await gateway.structured('voice', 'classify', schema);
    expect(sink.records[0].outcome).toBe('fallback');
    // The record keeps the originally-routed role and model, as offered to the
    // caller, not the fallback role.
    expect(sink.records[0].role).toBe('voice');
    expect(sink.records[0].model).toBe('voice-model');
  });
});

describe('play metrics — narration', () => {
  it('records a narration call with the narration purpose', async () => {
    const sink = new InMemoryMetricsSink();
    const create = vi.fn(async () => {
      async function* chunks(): AsyncIterable<ChatCompletionChunk> {
        yield { choices: [{ delta: { content: 'A grey morning.' } }] };
      }
      return chunks();
    }) as unknown as CreateFn;
    const gateway = new OpenAIGateway(config, {
      client: clientFrom(create),
      metrics: sink,
    });

    await collect(gateway.streamNarration('describe'));
    const record = sink.records[0];
    expect(record.role).toBe('narrator');
    expect(record.model).toBe('narrator-model');
    expect(record.purpose).toBe('narration');
    expect(record.completionTokens).toBe(1);
    expect(record.outcome).toBe('ok');
  });
});

describe('play metrics — disabled', () => {
  it('does not record and runs normally when no sink is configured', async () => {
    const gateway = new OpenAIGateway(config, {
      client: streamingClient(['a', 'b']),
    });
    await expect(collect(gateway.stream('voice', 'hi'))).resolves.toEqual([
      'a',
      'b',
    ]);
  });
});
