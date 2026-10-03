import { describe, expect, it, vi } from 'vitest';
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

type CreateFn = ChatClient['chat']['completions']['create'];

const role = (model: string) => ({
  model,
  temperature: 0.7,
  maxTokens: 200,
  timeoutMs: 8000,
  reasoning: 'off' as const,
});

const modelEntry = (family: string) => ({
  family,
  sources: [
    { format: 'mlx' as const, get: `${family}-mlx`, key: `${family}/mlx` },
    { format: 'gguf' as const, get: `${family}-gguf`, key: `${family}/gguf` },
  ] as [
    { format: 'mlx'; get: string; key: string },
    { format: 'gguf'; get: string; key: string },
  ],
});

const config: ModelsConfig = {
  endpoint: 'http://localhost:1234/v1',
  contextLength: 8192,
  models: {
    'voice-model': modelEntry('gemma4'),
    'fast-model': modelEntry('qwen3'),
  },
  profiles: {
    'gemma-voice': {
      voice: role('voice-model'),
      fast: role('fast-model'),
      narrator: role('fast-model'),
      bookkeeping: role('fast-model'),
      judge: role('voice-model'),
    },
  },
  active: 'gemma-voice',
};

/** A chat API that refuses to be called — for the model-list-only tests. */
const noChat: GatewayClient['chat'] = {
  completions: {
    create() {
      throw new Error('chat.completions.create was not expected here');
    },
  },
};

/** A fake client that yields a fixed model list, like LM Studio. */
function fakeClient(ids: string[]): GatewayClient {
  return {
    models: {
      async *list() {
        for (const id of ids) {
          yield { id };
        }
      },
    },
    chat: noChat,
  };
}

/** A client whose chat completions stream the given tokens as deltas. */
function streamingClient(tokens: Array<string | null>): {
  readonly client: GatewayClient;
  readonly create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async (_body: ChatRequest) => {
    async function* chunks(): AsyncIterable<ChatCompletionChunk> {
      for (const content of tokens) {
        yield { choices: [{ delta: { content } }] };
      }
    }
    return chunks();
  });
  return {
    client: {
      models: fakeClient([]).models,
      chat: { completions: { create: create as unknown as CreateFn } },
    },
    create,
  };
}

/** A client whose chat completions resolve to one message with `content`. */
function structuredClient(content: string | null): {
  readonly client: GatewayClient;
  readonly create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(
    async (_body: ChatRequest): Promise<ChatCompletion> => ({
      choices: [{ message: { content } }],
    }),
  );
  return {
    client: {
      models: fakeClient([]).models,
      chat: { completions: { create: create as unknown as CreateFn } },
    },
    create,
  };
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const token of stream) {
    out.push(token);
  }
  return out;
}

describe('OpenAIGateway', () => {
  it('lists the models the endpoint reports', async () => {
    const gateway = new OpenAIGateway(config, {
      client: fakeClient(['voice-model', 'fast-model']),
    });
    await expect(gateway.listModels()).resolves.toEqual([
      'voice-model',
      'fast-model',
    ]);
  });

  it('resolves the active profile', () => {
    const gateway = new OpenAIGateway(config, {
      client: fakeClient([]),
    });
    expect(gateway.activeProfile().voice.model).toBe('voice-model');
  });

  it('passes the startup check when every model is present', async () => {
    const gateway = new OpenAIGateway(config, {
      client: fakeClient(['voice-model', 'fast-model']),
    });
    const result = await gateway.checkStartup();
    expect(result.ok).toBe(true);
  });

  it('reports missing roles at startup', async () => {
    const gateway = new OpenAIGateway(config, {
      client: fakeClient(['voice-model']),
    });
    const result = await gateway.checkStartup();
    expect(result.ok).toBe(false);
    expect(result.missing.map((m) => m.role)).toEqual([
      'fast',
      'narrator',
      'bookkeeping',
    ]);
  });

  it('surfaces an endpoint failure from the startup check', async () => {
    const failing: GatewayClient = {
      models: {
        // eslint-disable-next-line require-yield
        async *list() {
          throw new Error('ECONNREFUSED');
        },
      },
      chat: noChat,
    };
    const gateway = new OpenAIGateway(config, { client: failing });
    await expect(gateway.checkStartup()).rejects.toThrow('ECONNREFUSED');
  });

  describe('stream', () => {
    it('yields the content tokens in arrival order', async () => {
      const { client } = streamingClient(['Guten ', 'Tag', '.']);
      const gateway = new OpenAIGateway(config, { client });
      const tokens = await collect(gateway.stream('voice', 'hello'));
      expect(tokens).toEqual(['Guten ', 'Tag', '.']);
    });

    it('skips empty and null deltas', async () => {
      const { client } = streamingClient(['', 'word', null, '!']);
      const gateway = new OpenAIGateway(config, { client });
      const tokens = await collect(gateway.stream('voice', 'hello'));
      expect(tokens).toEqual(['word', '!']);
    });

    it('wraps a bare prompt as a single user message', async () => {
      const { client, create } = streamingClient(['ok']);
      const gateway = new OpenAIGateway(config, { client });
      await collect(gateway.stream('voice', 'say hi'));
      const body = create.mock.calls[0][0] as ChatRequest;
      expect(body.messages).toEqual([{ role: 'user', content: 'say hi' }]);
      expect(body.stream).toBe(true);
    });

    it('passes an explicit message list through unchanged', async () => {
      const { client, create } = streamingClient(['ok']);
      const gateway = new OpenAIGateway(config, { client });
      const messages = [
        { role: 'system' as const, content: 'be terse' },
        { role: 'user' as const, content: 'hi' },
      ];
      await collect(gateway.stream('voice', messages));
      const body = create.mock.calls[0][0] as ChatRequest;
      expect(body.messages).toEqual(messages);
    });

    it('applies the role settings: model, temperature, max tokens, timeout', async () => {
      const { client, create } = streamingClient(['ok']);
      const gateway = new OpenAIGateway(config, { client });
      await collect(gateway.stream('fast', 'hello'));
      const body = create.mock.calls[0][0] as ChatRequest;
      expect(body.model).toBe('fast-model');
      expect(body.temperature).toBe(0.7);
      expect(body.max_tokens).toBe(200);
      expect(create.mock.calls[0][1]).toEqual({ timeout: 8000 });
    });

    it('offers a CallHandle before the first token, carrying role and model', async () => {
      const { client } = streamingClient(['ok']);
      const gateway = new OpenAIGateway(config, { client });
      const handles: Array<{ role: string; model: string }> = [];
      await collect(
        gateway.stream('judge', 'hello', {
          onHandle: (h) => handles.push({ role: h.role, model: h.model }),
        }),
      );
      expect(handles).toEqual([{ role: 'judge', model: 'voice-model' }]);
    });

    it('exposes a markReleased hook that is safe to call', async () => {
      const { client } = streamingClient(['ok']);
      const gateway = new OpenAIGateway(config, { client });
      let handle: { markReleased(): void } | undefined;
      await collect(
        gateway.stream('voice', 'hello', { onHandle: (h) => (handle = h) }),
      );
      expect(() => handle?.markReleased()).not.toThrow();
    });
  });

  describe('structured', () => {
    const schema = z.object({ intent: z.string(), confidence: z.number() });

    it('sends a json_schema response_format derived from the Zod schema', async () => {
      const { client, create } = structuredClient(
        JSON.stringify({ intent: 'offer', confidence: 0.9 }),
      );
      const gateway = new OpenAIGateway(config, { client });
      await gateway.structured('bookkeeping', 'classify', schema);
      const body = create.mock.calls[0][0] as ChatRequest;
      expect(body.response_format?.type).toBe('json_schema');
      expect(body.response_format?.json_schema.strict).toBe(true);
      const jsonSchema = body.response_format?.json_schema.schema as Record<
        string,
        unknown
      >;
      expect(jsonSchema).toMatchObject({ type: 'object' });
      expect(Object.keys(jsonSchema.properties as object)).toEqual([
        'intent',
        'confidence',
      ]);
    });

    it('re-validates and returns the parsed value', async () => {
      const { client } = structuredClient(
        JSON.stringify({ intent: 'offer', confidence: 0.9 }),
      );
      const gateway = new OpenAIGateway(config, { client });
      const result = await gateway.structured('bookkeeping', 'classify', schema);
      expect(result).toEqual({ intent: 'offer', confidence: 0.9 });
    });

    it('rejects a response that fails the Zod schema', async () => {
      const { client } = structuredClient(
        JSON.stringify({ intent: 'offer', confidence: 'high' }),
      );
      const gateway = new OpenAIGateway(config, { client });
      await expect(
        gateway.structured('bookkeeping', 'classify', schema),
      ).rejects.toThrow();
    });

    it('rejects a response that is not valid JSON', async () => {
      const { client } = structuredClient('not json');
      const gateway = new OpenAIGateway(config, { client });
      await expect(
        gateway.structured('bookkeeping', 'classify', schema),
      ).rejects.toThrow(/invalid JSON/);
    });

    it('rejects a response with no content', async () => {
      const { client } = structuredClient(null);
      const gateway = new OpenAIGateway(config, { client });
      await expect(
        gateway.structured('bookkeeping', 'classify', schema),
      ).rejects.toThrow(/no content/);
    });

    it('applies the role settings to the structured call', async () => {
      const { client, create } = structuredClient(
        JSON.stringify({ intent: 'offer', confidence: 0.9 }),
      );
      const gateway = new OpenAIGateway(config, { client });
      await gateway.structured('bookkeeping', 'classify', schema);
      const body = create.mock.calls[0][0] as ChatRequest;
      expect(body.model).toBe('fast-model');
      expect(body.temperature).toBe(0.7);
      expect(body.max_tokens).toBe(200);
      expect(create.mock.calls[0][1]).toEqual({ timeout: 8000 });
    });
  });

  describe('reasoning mode wiring', () => {
    const roleWith = (
      model: string,
      reasoning: 'off' | 'low' | 'on',
    ) => ({ model, temperature: 0.7, maxTokens: 200, timeoutMs: 8000, reasoning });

    const source = (format: 'mlx' | 'gguf', get: string, key: string) => ({
      format,
      get,
      key,
    });
    const entry = (family: string) => ({
      family,
      sources: [
        source('mlx', `${family}-mlx`, `${family}/mlx`),
        source('gguf', `${family}-gguf`, `${family}/gguf`),
      ] as [ReturnType<typeof source>, ReturnType<typeof source>],
    });

    // A profile whose roles span both families and all three modes, so each
    // call's reasoning mutation can be read off its request body. The Load
    // Identifiers deliberately do not contain the template family name, so
    // selection has to come from the `models` map's `family` field.
    const reasoningConfig: ModelsConfig = {
      endpoint: 'http://localhost:1234/v1',
      contextLength: 8192,
      models: {
        'voice-model': entry('gemma4'),
        'moe-model': entry('qwen3'),
      },
      profiles: {
        mixed: {
          voice: roleWith('voice-model', 'off'),
          fast: roleWith('moe-model', 'off'),
          narrator: roleWith('moe-model', 'low'),
          bookkeeping: roleWith('moe-model', 'on'),
          judge: roleWith('voice-model', 'on'),
        },
      },
      active: 'mixed',
    };

    it('sends the qwen off mutation for a qwen3-family role set to off', async () => {
      const { client, create } = streamingClient(['ok']);
      const gateway = new OpenAIGateway(reasoningConfig, { client });
      await collect(gateway.stream('fast', 'hi'));
      const body = create.mock.calls[0][0] as ChatRequest;
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
      expect(body.reasoning_effort).toBe('none');
    });

    it('sends the qwen low mutation for a qwen3-family role set to low', async () => {
      const { client, create } = streamingClient(['ok']);
      const gateway = new OpenAIGateway(reasoningConfig, { client });
      await collect(gateway.stream('narrator', 'hi'));
      const body = create.mock.calls[0][0] as ChatRequest;
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: true });
      expect(body.reasoning_effort).toBe('low');
    });

    it('sends the qwen on mutation for a qwen3-family role set to on', async () => {
      const { client, create } = streamingClient(['ok']);
      const gateway = new OpenAIGateway(reasoningConfig, { client });
      await collect(gateway.stream('bookkeeping', 'hi'));
      const body = create.mock.calls[0][0] as ChatRequest;
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: true });
      expect(body.reasoning_effort).toBe('high');
    });

    it('sets the enable_thinking flag for a gemma4-family role', async () => {
      const { client, create } = streamingClient(['ok']);
      const gateway = new OpenAIGateway(reasoningConfig, { client });
      await collect(gateway.stream('voice', 'hi'));
      const body = create.mock.calls[0][0] as ChatRequest;
      // gemma4 steers via the Enable Thinking template flag (off => false),
      // not a prompt directive, so the messages are left untouched.
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
      expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
      expect(body.reasoning_effort).toBeUndefined();
    });

    it('leaves the request unchanged and warns for an unknown family', async () => {
      const warn = vi.fn();
      // A Load Identifier whose family is in no controlled family and unique to
      // this test, so the process-wide "warned once" set does not swallow the
      // warning.
      const unknown = roleWith('solo-model', 'on');
      const unknownConfig: ModelsConfig = {
        endpoint: 'http://localhost:1234/v1',
        contextLength: 8192,
        models: {
          'solo-model': entry('llama-reasoning-test'),
        },
        profiles: {
          solo: {
            voice: unknown,
            fast: unknown,
            narrator: unknown,
            bookkeeping: unknown,
            judge: unknown,
          },
        },
        active: 'solo',
      };
      const { client, create } = streamingClient(['ok']);
      const gateway = new OpenAIGateway(unknownConfig, { client, warn });
      await collect(gateway.stream('voice', 'hi'));
      const body = create.mock.calls[0][0] as ChatRequest;
      expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
      expect(body.chat_template_kwargs).toBeUndefined();
      expect(body.reasoning_effort).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
