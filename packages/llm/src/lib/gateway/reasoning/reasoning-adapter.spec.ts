import { describe, expect, it, vi } from 'vitest';

import type { ModelsConfig } from '../../config/models-config.js';
import {
  familyForModel,
  gemmaAdapter,
  isReasoningFamily,
  noopAdapter,
  qwenAdapter,
  resolveReasoningAdapter,
  type ReasoningMessage,
} from './reasoning-adapter.js';

const user = (content: string): ReasoningMessage => ({
  role: 'user',
  content,
});

describe('isReasoningFamily', () => {
  it('recognises the controlled families', () => {
    expect(isReasoningFamily('qwen3')).toBe(true);
    expect(isReasoningFamily('gemma4')).toBe(true);
  });

  it('rejects a family it does not control', () => {
    expect(isReasoningFamily('llama')).toBe(false);
    expect(isReasoningFamily('qwen')).toBe(false);
    expect(isReasoningFamily('')).toBe(false);
  });
});

describe('qwenAdapter', () => {
  it('turns thinking off via chat_template_kwargs and reasoning_effort', () => {
    const mutation = qwenAdapter('off', [user('hi')]);
    expect(mutation.extraBody).toEqual({
      chat_template_kwargs: { enable_thinking: false },
      reasoning_effort: 'none',
    });
    // off must not rewrite the messages
    expect(mutation.messages).toBeUndefined();
  });

  it('keeps thinking on at low effort for the low mode', () => {
    const mutation = qwenAdapter('low', [user('hi')]);
    expect(mutation.extraBody).toEqual({
      chat_template_kwargs: { enable_thinking: true },
      reasoning_effort: 'low',
    });
  });

  it('enables full thinking for the on mode', () => {
    const mutation = qwenAdapter('on', [user('hi')]);
    expect(mutation.extraBody).toEqual({
      chat_template_kwargs: { enable_thinking: true },
      reasoning_effort: 'high',
    });
  });

  it('never mutates the input messages', () => {
    const messages = [user('hi')];
    qwenAdapter('off', messages);
    expect(messages).toEqual([user('hi')]);
  });
});

describe('gemmaAdapter', () => {
  it('turns the Enable Thinking template flag off for the off mode', () => {
    const mutation = gemmaAdapter('off', [user('hi')]);
    expect(mutation.extraBody).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
    // like Qwen3, Gemma 4 steers via the template flag, not a directive
    expect(mutation.messages).toBeUndefined();
  });

  it('keeps the Enable Thinking flag on for the low mode', () => {
    const mutation = gemmaAdapter('low', [user('hi')]);
    expect(mutation.extraBody).toEqual({
      chat_template_kwargs: { enable_thinking: true },
    });
  });

  it('keeps the Enable Thinking flag on for the on mode', () => {
    const mutation = gemmaAdapter('on', [user('hi')]);
    expect(mutation.extraBody).toEqual({
      chat_template_kwargs: { enable_thinking: true },
    });
  });

  it('never mutates the input messages', () => {
    const messages = [user('hi')];
    gemmaAdapter('on', messages);
    expect(messages).toEqual([user('hi')]);
  });
});

describe('noopAdapter', () => {
  it('returns an empty mutation regardless of mode', () => {
    expect(noopAdapter('off', [user('hi')])).toEqual({});
    expect(noopAdapter('on', [user('hi')])).toEqual({});
  });
});

describe('resolveReasoningAdapter', () => {
  it('resolves the qwen adapter for the qwen3 family', () => {
    expect(resolveReasoningAdapter('qwen3', 'qwen-moe')).toBe(qwenAdapter);
  });

  it('resolves the gemma adapter for the gemma4 family', () => {
    expect(resolveReasoningAdapter('gemma4', 'gemma-31b')).toBe(gemmaAdapter);
  });

  it('ignores the model id when the family is controlled', () => {
    // A Load Identifier that contains no family substring still resolves by
    // family, which the old substring detection could not do.
    expect(resolveReasoningAdapter('qwen3', 'moe-a')).toBe(qwenAdapter);
    expect(resolveReasoningAdapter('gemma4', 'voice-small')).toBe(gemmaAdapter);
  });

  it('falls back to the no-op adapter for an unknown family', () => {
    const warn = vi.fn();
    const adapter = resolveReasoningAdapter(
      'llama',
      'llama-3-8b',
      warn,
      new Set(),
    );
    expect(adapter).toBe(noopAdapter);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('llama');
    expect(warn.mock.calls[0][0]).toContain('llama-3-8b');
  });

  it('warns only once per family/model pair', () => {
    const warn = vi.fn();
    const seen = new Set<string>();
    resolveReasoningAdapter('phi', 'phi-4', warn, seen);
    resolveReasoningAdapter('phi', 'phi-4', warn, seen);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns again for a different model in the same unknown family', () => {
    const warn = vi.fn();
    const seen = new Set<string>();
    resolveReasoningAdapter('phi', 'phi-4', warn, seen);
    resolveReasoningAdapter('phi', 'phi-5', warn, seen);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('does not warn for a controlled family', () => {
    const warn = vi.fn();
    resolveReasoningAdapter('qwen3', 'qwen-moe', warn, new Set());
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('familyForModel', () => {
  const config = {
    models: {
      'qwen-moe': { family: 'qwen3' },
      'gemma-31b': { family: 'gemma4' },
    },
  } as unknown as ModelsConfig;

  it('reads the configured family for a Load Identifier', () => {
    expect(familyForModel(config, 'qwen-moe')).toBe('qwen3');
    expect(familyForModel(config, 'gemma-31b')).toBe('gemma4');
  });

  it('returns an empty string for an unknown Load Identifier', () => {
    expect(familyForModel(config, 'not-in-map')).toBe('');
  });
});
