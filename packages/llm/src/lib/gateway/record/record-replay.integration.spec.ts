import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { ModelsConfig } from '../../config/models-config.js';
import {
  OpenAIGateway,
  type ChatClient,
  type ChatCompletion,
  type ChatCompletionChunk,
  type ChatRequest,
  type GatewayClient,
} from '../openai-gateway.js';
import { FileRecordSink, FileRecordSource } from './jsonl-store.js';
import { RecordingGateway } from './recording-gateway.js';
import { ReplayGateway } from './replay-gateway.js';

type CreateFn = ChatClient['chat']['completions']['create'];

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

/** A client that streams tokens and resolves structured content, counting calls. */
function liveClient(streamTokens: string[], structuredContent: string): {
  readonly client: GatewayClient;
  readonly create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async (body: ChatRequest) => {
    if (body.stream === true) {
      async function* chunks(): AsyncIterable<ChatCompletionChunk> {
        for (const content of streamTokens) {
          yield { choices: [{ delta: { content } }] };
        }
      }
      return chunks();
    }
    const completion: ChatCompletion = {
      choices: [{ message: { content: structuredContent } }],
    };
    return completion;
  });
  return {
    client: {
      models: {
        async *list() {
          /* no models needed */
        },
      },
      chat: { completions: { create: create as unknown as CreateFn } },
    },
    create,
  };
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const t of stream) {
    out.push(t);
  }
  return out;
}

const schema = z.object({ intent: z.string() });

describe('record and replay through the real OpenAIGateway + a temp JSONL file', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tradecraft-replay-'));
    path = join(dir, 'session.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('records a live session to disk and replays it with no model calls', async () => {
    const { client, create } = liveClient(
      ['Guten ', 'Tag'],
      JSON.stringify({ intent: 'greet' }),
    );
    const live = new OpenAIGateway(config, { client });
    const recorder = new RecordingGateway(live, new FileRecordSink(path));

    const stream = await collect(recorder.stream('voice', 'hello'));
    const structured = await recorder.structured('bookkeeping', 'classify', schema);
    const callsWhileRecording = create.mock.calls.length;
    expect(callsWhileRecording).toBe(2);

    // Replay from the file: the OpenAIGateway client must not be called again.
    const replay = new ReplayGateway(config, new FileRecordSource(path));
    const replayStream = await collect(replay.stream('voice', 'hello'));
    const replayStructured = await replay.structured('bookkeeping', 'classify', schema);

    expect(replayStream).toEqual(stream);
    expect(replayStructured).toEqual(structured);
    // No further client calls happened during replay.
    expect(create.mock.calls.length).toBe(callsWhileRecording);
  });

  it('keys a reasoning-mode call so replay matches the recorded request', async () => {
    // A profile whose fast role uses a qwen model, so describeCall carries the
    // reasoning body params into the hash on both record and replay.
    const reasoningConfig: ModelsConfig = {
      ...config,
      profiles: {
        base: {
          ...config.profiles.base,
          fast: { ...role('qwen3.6-35b-a3b'), reasoning: 'on' as const },
        },
      },
    };
    const { client } = liveClient(['ok'], '{}');
    const live = new OpenAIGateway(reasoningConfig, { client });
    const recorder = new RecordingGateway(live, new FileRecordSink(path));
    const recorded = await collect(recorder.stream('fast', 'think'));

    const replay = new ReplayGateway(reasoningConfig, new FileRecordSource(path));
    expect(await collect(replay.stream('fast', 'think'))).toEqual(recorded);
  });
});
