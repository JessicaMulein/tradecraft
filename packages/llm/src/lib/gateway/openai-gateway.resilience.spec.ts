/**
 * Integration tests for the Gateway's resilience wiring (task 13.4):
 * timeouts, retry-once-then-fall-back-to-`fast`, the priority queue, and
 * narrator cancellation. These drive the public `stream`, `structured` and
 * `streamNarration` through a mocked client, so they assert the policy and the
 * queue end to end rather than the units in isolation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { ModelsConfig } from '../config/models-config.js';
import {
  OpenAIGateway,
  type ChatClient,
  type ChatCompletion,
  type ChatCompletionChunk,
  type ChatRequest,
  type GatewayClient,
} from './openai-gateway.js';
import { CallPriority } from './resilience/priority.js';

type CreateFn = ChatClient['chat']['completions']['create'];

const role = (model: string, timeoutMs = 8000) => ({
  model,
  temperature: 0.7,
  maxTokens: 200,
  timeoutMs,
  reasoning: 'off' as const,
});

/** A profile whose roles each name a distinct model, so fallback is visible. */
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
    /* no models needed for these tests */
  },
};

/** Build a client from a create() implementation. */
function clientFrom(create: CreateFn): GatewayClient {
  return { models: emptyModels, chat: { completions: { create } } };
}

/** Wrap tokens as a streaming completion. */
function streamOf(tokens: string[]): AsyncIterable<ChatCompletionChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const content of tokens) {
        yield { choices: [{ delta: { content } }] };
      }
    },
  };
}

/** A non-streamed completion carrying `content`. */
function completionOf(content: string): ChatCompletion {
  return { choices: [{ message: { content } }] };
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const token of stream) {
    out.push(token);
  }
  return out;
}

/** A promise that never settles on its own, to simulate a hung call. */
function never<T>(): Promise<T> {
  return new Promise<T>(() => {
    /* intentionally never resolves */
  });
}

const intentSchema = z.object({ intent: z.string() });

describe('OpenAIGateway resilience — structured retry and fallback', () => {
  it('retries once under the same role on failure', async () => {
    const models: string[] = [];
    const create = vi.fn(async (body: ChatRequest) => {
      models.push(body.model);
      if (models.length === 1) {
        throw new Error('transient');
      }
      return completionOf(JSON.stringify({ intent: 'offer' }));
    }) as unknown as CreateFn;

    const gateway = new OpenAIGateway(config, { client: clientFrom(create) });
    const result = await gateway.structured('voice', 'classify', intentSchema);
    expect(result).toEqual({ intent: 'offer' });
    expect(models).toEqual(['voice-model', 'voice-model']);
  });

  it('falls back to the fast model after two failures', async () => {
    const models: string[] = [];
    const create = vi.fn(async (body: ChatRequest) => {
      models.push(body.model);
      if (body.model !== 'fast-model') {
        throw new Error('role down');
      }
      return completionOf(JSON.stringify({ intent: 'rescued' }));
    }) as unknown as CreateFn;

    const gateway = new OpenAIGateway(config, { client: clientFrom(create) });
    const result = await gateway.structured('voice', 'classify', intentSchema);
    expect(result).toEqual({ intent: 'rescued' });
    expect(models).toEqual(['voice-model', 'voice-model', 'fast-model']);
  });

  it('propagates the error when the fast fallback also fails', async () => {
    const create = vi.fn(async () => {
      throw new Error('endpoint down');
    }) as unknown as CreateFn;
    const gateway = new OpenAIGateway(config, { client: clientFrom(create) });
    await expect(
      gateway.structured('voice', 'classify', intentSchema),
    ).rejects.toThrow('endpoint down');
    // voice, voice, fast = 3 attempts.
    expect((create as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3);
  });
});

describe('OpenAIGateway resilience — timeouts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('treats a hung call as a failure and falls back to fast', async () => {
    const models: string[] = [];
    const create = vi.fn((body: ChatRequest) => {
      models.push(body.model);
      if (body.model === 'fast-model') {
        return Promise.resolve(completionOf(JSON.stringify({ intent: 'ok' })));
      }
      // Non-fast roles hang forever, so the role's timeout fires.
      return never<ChatCompletion>();
    }) as unknown as CreateFn;

    const gateway = new OpenAIGateway(config, {
      client: clientFrom(create),
    });

    const promise = gateway.structured('voice', 'classify', intentSchema);
    // Two voice attempts time out at 8000ms each, then fast resolves.
    await vi.advanceTimersByTimeAsync(8000);
    await vi.advanceTimersByTimeAsync(8000);
    await expect(promise).resolves.toEqual({ intent: 'ok' });
    expect(models).toEqual(['voice-model', 'voice-model', 'fast-model']);
  });
});

describe('OpenAIGateway resilience — narrator does not fall back', () => {
  it('retries the narrator once and then fails without a fast fallback', async () => {
    const models: string[] = [];
    const create = vi.fn(async (body: ChatRequest) => {
      models.push(body.model);
      throw new Error('narrator down');
    }) as unknown as CreateFn;

    const gateway = new OpenAIGateway(config, { client: clientFrom(create) });
    await expect(collect(gateway.streamNarration('describe'))).rejects.toThrow(
      'narrator down',
    );
    // narrator, narrator — never fast-model.
    expect(models).toEqual(['narrator-model', 'narrator-model']);
  });
});

describe('OpenAIGateway resilience — priority queue', () => {
  it('dispatches queued calls intent → voice → narrator → extraction', async () => {
    const order: string[] = [];
    // A gate so all four calls queue behind the first before any resolve.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let firstSeen = false;

    const create = vi.fn(async (body: ChatRequest) => {
      if (!firstSeen) {
        firstSeen = true;
        await gate; // hold the only slot until every call is queued
      }
      order.push(body.model);
      return completionOf(JSON.stringify({ intent: body.model }));
    }) as unknown as CreateFn;

    const gateway = new OpenAIGateway(config, {
      client: clientFrom(create),
      concurrency: 1,
    });

    // A blocker occupies the slot first (lowest priority, submitted first).
    const blocker = gateway.structured('bookkeeping', 'b', intentSchema, {
      priority: CallPriority.Extraction,
    });
    // Give the blocker time to start and hit the gate.
    await Promise.resolve();
    await Promise.resolve();

    // Now submit the rest out of priority order.
    const extraction = gateway.structured('bookkeeping', 'e', intentSchema, {
      priority: CallPriority.Extraction,
    });
    const narrator = gateway.structured('voice', 'n', intentSchema, {
      priority: CallPriority.Narrator,
    });
    const voice = gateway.structured('voice', 'v', intentSchema, {
      priority: CallPriority.Voice,
    });
    const intent = gateway.structured('fast', 'i', intentSchema, {
      priority: CallPriority.Intent,
    });

    release();
    await Promise.all([blocker, extraction, narrator, voice, intent]);

    // The blocker ran first (it held the slot); the rest drain by priority.
    expect(order[0]).toBe('book-model');
    expect(order.slice(1)).toEqual([
      'fast-model', // intent
      'voice-model', // voice
      'voice-model', // narrator (routed to voice model here)
      'book-model', // extraction
    ]);
  });
});

describe('OpenAIGateway resilience — narration cancellation', () => {
  it('cancels a narration that has not produced a first sentence', async () => {
    const create = vi.fn(async () =>
      streamOf(['A ', 'grey ', 'morning ', 'without end']),
    ) as unknown as CreateFn;
    const gateway = new OpenAIGateway(config, { client: clientFrom(create) });

    const narration = gateway.streamNarration('describe');
    const out: string[] = [];
    for await (const token of narration) {
      out.push(token);
      narration.cancel(); // player issued the next action
    }
    // Cancelled before the first sentence ended, so only the opening token.
    expect(narration.cancelled).toBe(true);
    expect(out).toEqual(['A ']);
  });

  it('lets a narration finish once its first sentence is out', async () => {
    const create = vi.fn(async () =>
      streamOf(['A grey morning.', ' Then ', 'the bells.']),
    ) as unknown as CreateFn;
    const gateway = new OpenAIGateway(config, { client: clientFrom(create) });

    const narration = gateway.streamNarration('describe');
    const out: string[] = [];
    for await (const token of narration) {
      out.push(token);
      narration.cancel(); // too late: first sentence already released
    }
    expect(narration.cancelled).toBe(false);
    expect(out).toEqual(['A grey morning.', ' Then ', 'the bells.']);
  });

  it('reclaims the slot from an in-flight narration for a higher-priority call', async () => {
    // The narrator stream opens but never produces a token on its own; a voice
    // call then preempts it, so the narration ends and the voice call runs.
    const create = vi.fn((body: ChatRequest & { stream?: boolean }) => {
      if (body.model === 'narrator-model') {
        const hang: AsyncIterable<ChatCompletionChunk> = {
          [Symbol.asyncIterator]: () => ({
            next: () => never<IteratorResult<ChatCompletionChunk>>(),
          }),
        };
        return Promise.resolve(hang);
      }
      return Promise.resolve(completionOf(JSON.stringify({ intent: 'acted' })));
    }) as unknown as CreateFn;

    const gateway = new OpenAIGateway(config, {
      client: clientFrom(create),
      concurrency: 1,
    });

    const narration = gateway.streamNarration('describe');
    // Start consuming so the scheduled narration job takes the slot.
    const drained = collect(narration);
    await Promise.resolve();
    await Promise.resolve();

    // A higher-priority structured call preempts the narration.
    const action = gateway.structured('voice', 'act', intentSchema, {
      priority: CallPriority.Voice,
    });

    await expect(action).resolves.toEqual({ intent: 'acted' });
    // The narration ends with no tokens, having yielded its slot.
    await expect(drained).resolves.toEqual([]);
  });
});
