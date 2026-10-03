/**
 * Unit tests for the Intent Classifier's schema and parse path (Requirements
 * 4.2, 14.4).
 *
 * The classifier runs on the `fast` role through the Gateway's `structured`
 * path. These tests fake the Gateway the way the llm package's record/replay
 * tests do: the fake's `structured` validates its scripted value against the
 * schema the classifier passes, so a legal reply parses to one of the twelve
 * Intents and an illegal reply (a value outside the enum, a missing field) is
 * rejected by the same schema the live Gateway would re-validate against.
 */

import { INTENTS } from '@tradecraft/engine';
import type {
  CallInput,
  CallKind,
  CallRequest,
  Gateway,
  NarrationStream,
  Role,
} from '@tradecraft/llm';
import type { ZodType } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  IntentClassificationSchema,
  INTENT_SYSTEM_PROMPT,
  classifyIntent,
} from './classifier.js';

/**
 * A fake Gateway whose `structured` returns a scripted value parsed through the
 * caller's schema — exactly the contract the live Gateway offers (it
 * re-validates the model's reply against the schema). The other Gateway methods
 * are unused here and throw if touched, so a test that reaches them fails loudly.
 */
class FakeGateway implements Gateway {
  lastRole: Role | undefined;
  lastInput: CallInput | undefined;

  constructor(private readonly value: unknown) {}

  structured<T>(role: Role, input: CallInput, schema: ZodType<T>): Promise<T> {
    this.lastRole = role;
    this.lastInput = input;
    return Promise.resolve(schema.parse(this.value));
  }

  stream(): AsyncIterable<string> {
    throw new Error('stream not used by the classifier');
  }

  streamNarration(): NarrationStream {
    throw new Error('streamNarration not used by the classifier');
  }

  describeCall<T>(
    kind: CallKind,
    role: Role,
    input: CallInput,
    schema?: ZodType<T>,
  ): CallRequest {
    void kind;
    void role;
    void input;
    void schema;
    throw new Error('describeCall not used by the classifier');
  }
}

describe('IntentClassificationSchema (Req 14.4)', () => {
  it('accepts every legal Intent', () => {
    for (const intent of INTENTS) {
      const parsed = IntentClassificationSchema.parse({ intent });
      expect(parsed.intent).toBe(intent);
    }
  });

  it('rejects a value outside the fixed set', () => {
    expect(() => IntentClassificationSchema.parse({ intent: 'offer' })).toThrow();
  });

  it('rejects a missing intent field', () => {
    expect(() => IntentClassificationSchema.parse({})).toThrow();
  });
});

describe('classifyIntent (Req 4.2)', () => {
  it('returns the Intent the structured reply carries', async () => {
    const gateway = new FakeGateway({ intent: 'pitch-money' });
    const intent = await classifyIntent(gateway, 'I can make it worth your while.');
    expect(intent).toBe('pitch-money');
  });

  it('calls the fast role with the system frame and the player line', async () => {
    const gateway = new FakeGateway({ intent: 'ask' });
    await classifyIntent(gateway, 'Where were you on Tuesday?');

    expect(gateway.lastRole).toBe('fast');
    const messages = gateway.lastInput;
    expect(Array.isArray(messages)).toBe(true);
    if (!Array.isArray(messages)) return;
    expect(messages[0]).toEqual({ role: 'system', content: INTENT_SYSTEM_PROMPT });
    expect(messages[1]).toEqual({
      role: 'user',
      content: 'Where were you on Tuesday?',
    });
  });

  it('rejects when the model returns a value outside the Intent set', async () => {
    const gateway = new FakeGateway({ intent: 'definitely-not-an-intent' });
    await expect(classifyIntent(gateway, 'anything')).rejects.toThrow();
  });

  it('places the player line in the user role, never in system content', async () => {
    const gateway = new FakeGateway({ intent: 'confront' });
    await classifyIntent(gateway, 'You lied to me about the warehouse.');
    const messages = gateway.lastInput;
    if (!Array.isArray(messages)) throw new Error('expected message array');
    expect(messages[0].content).not.toContain('warehouse');
    expect(messages[1].role).toBe('user');
  });
});
