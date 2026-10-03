import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../call-types.js';
import { canonicalJson, hashRequest, type CallRequest } from './request-hash.js';

const base: CallRequest = {
  kind: 'stream',
  role: 'voice',
  model: 'voice-model',
  messages: [{ role: 'user', content: 'hello' }],
  temperature: 0.7,
  maxTokens: 200,
};

describe('canonicalJson', () => {
  it('sorts object keys so key order does not matter', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('drops undefined members, matching JSON.stringify', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('emits null for non-finite numbers', () => {
    expect(canonicalJson(Number.NaN)).toBe('null');
    expect(canonicalJson(Number.POSITIVE_INFINITY)).toBe('null');
  });

  it('is stable regardless of nested key order', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.integer()),
        (dict) => {
          const shuffled = Object.fromEntries(
            Object.entries(dict).reverse(),
          );
          expect(canonicalJson(dict)).toBe(canonicalJson(shuffled));
        },
      ),
    );
  });
});

describe('hashRequest', () => {
  it('is deterministic for the same request', () => {
    expect(hashRequest(base)).toBe(hashRequest({ ...base }));
  });

  it('returns a lower-case hex sha256 (64 chars)', () => {
    const hash = hashRequest(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores how optional fields were constructed', () => {
    // Explicitly-undefined optionals hash the same as absent ones.
    const withUndefined: CallRequest = {
      ...base,
      responseFormat: undefined,
      reasoning: undefined,
    };
    expect(hashRequest(withUndefined)).toBe(hashRequest(base));
  });

  it('changes when the kind changes', () => {
    expect(hashRequest({ ...base, kind: 'structured' })).not.toBe(
      hashRequest(base),
    );
  });

  it('changes when the role changes', () => {
    expect(hashRequest({ ...base, role: 'fast' })).not.toBe(hashRequest(base));
  });

  it('changes when the model changes', () => {
    expect(hashRequest({ ...base, model: 'other-model' })).not.toBe(
      hashRequest(base),
    );
  });

  it('changes when the messages change', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'goodbye' }];
    expect(hashRequest({ ...base, messages })).not.toBe(hashRequest(base));
  });

  it('changes when temperature or maxTokens change', () => {
    expect(hashRequest({ ...base, temperature: 0.1 })).not.toBe(
      hashRequest(base),
    );
    expect(hashRequest({ ...base, maxTokens: 42 })).not.toBe(hashRequest(base));
  });

  it('changes when the response format changes', () => {
    const responseFormat = {
      type: 'json_schema' as const,
      json_schema: { name: 'r', schema: { type: 'object' }, strict: true as const },
    };
    expect(hashRequest({ ...base, kind: 'structured', responseFormat })).not.toBe(
      hashRequest({ ...base, kind: 'structured' }),
    );
  });

  it('changes when reasoning body params change', () => {
    expect(
      hashRequest({ ...base, reasoning: { reasoning_effort: 'high' } }),
    ).not.toBe(hashRequest({ ...base, reasoning: { reasoning_effort: 'low' } }));
  });

  it('is independent of reasoning key insertion order', () => {
    const a: CallRequest = {
      ...base,
      reasoning: { reasoning_effort: 'low', chat_template_kwargs: { enable_thinking: true } },
    };
    const b: CallRequest = {
      ...base,
      reasoning: { chat_template_kwargs: { enable_thinking: true }, reasoning_effort: 'low' },
    };
    expect(hashRequest(a)).toBe(hashRequest(b));
  });
});
