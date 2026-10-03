/**
 * Unit tests for the asynchronous Claim Extractor orchestrator (Requirements
 * 7.1, 7.5).
 *
 * The orchestrator runs one structured call on the `bookkeeping` role, then
 * hands the parsed result to the pure core. These tests fake the Gateway the
 * way the rest of the dialogue package does: the fake's `structured` validates
 * its scripted value against the schema the extractor passes (exactly the live
 * Gateway's contract), and a counter lets a test script a first-call failure
 * followed by a success to exercise the single retry. A fake that always fails
 * drives the unparsed-note fallback.
 */

import {
  compilePredicateRegistry,
  type EvaluatorKind,
  type PredicateDefinition,
  type PredicateRegistry,
} from '@tradecraft/content';
import {
  TruthStore,
  type GameTime,
  type NpcId,
} from '@tradecraft/engine';
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
  EXTRACTION_ROLE,
  EXTRACTION_SYSTEM_PROMPT,
  extractClaims,
} from './extract.js';
import type { SpeakerKnowledge } from './extractor.js';

const ANA: NpcId = 'npc:ana';
const AT: GameTime = { day: 1, phase: 0 };

const worksFor: PredicateDefinition = {
  id: 'WORKS_FOR',
  subject: ['npc', 'unk'],
  object: { entity: ['org'] },
  place: 'none',
  window: 'none',
  evaluator: 'fact-match',
  fieldCode: 'WF',
  render: {
    second: 'You work for {object}.',
    third: '{subject} works for {object}.',
  },
  extractorHint: 'A person works for an organisation.',
};

function registry(): PredicateRegistry {
  const result = compilePredicateRegistry([worksFor]);
  if (!result.ok) throw new Error('test predicate must compile');
  return result.registry;
}

function truthStore(): TruthStore {
  const kinds = new Map<string, EvaluatorKind>([['WORKS_FOR', 'fact-match']]);
  return TruthStore.create(kinds);
}

const knowledge: SpeakerKnowledge = { known: [], falseBeliefs: [], promote: [] };

/**
 * A fake Gateway whose `structured` returns the next scripted value (parsed
 * through the caller's schema) in order, so a test can script a failure then a
 * success. The non-structured methods throw if touched.
 */
class ScriptedGateway implements Gateway {
  calls = 0;
  lastRole: Role | undefined;
  lastInput: CallInput | undefined;

  constructor(private readonly values: readonly unknown[]) {}

  structured<T>(role: Role, input: CallInput, schema: ZodType<T>): Promise<T> {
    this.lastRole = role;
    this.lastInput = input;
    const value = this.values[Math.min(this.calls, this.values.length - 1)];
    this.calls += 1;
    // Parse (and reject) exactly as the live Gateway re-validates the reply.
    return Promise.resolve().then(() => schema.parse(value));
  }

  stream(): AsyncIterable<string> {
    throw new Error('stream not used by the extractor');
  }
  streamNarration(): NarrationStream {
    throw new Error('streamNarration not used by the extractor');
  }
  describeCall<T>(
    _kind: CallKind,
    _role: Role,
    _input: CallInput,
    _schema?: ZodType<T>,
  ): CallRequest {
    throw new Error('describeCall not used by the extractor');
  }
}

const validReply = {
  claims: [
    { predicate: 'WORKS_FOR', subject: 'npc:ana', object: 'org:cell', hedged: false },
  ],
};

describe('extractClaims success (Req 7.1)', () => {
  it('calls the bookkeeping role with the system frame and the utterance', async () => {
    const gateway = new ScriptedGateway([validReply]);
    const out = await extractClaims(
      { speaker: ANA, utterance: 'I work for the collective.', at: AT, knowledge, toldList: [] },
      { gateway, predicates: registry(), truth: truthStore() },
    );

    expect(gateway.lastRole).toBe(EXTRACTION_ROLE);
    const messages = gateway.lastInput;
    if (!Array.isArray(messages)) throw new Error('expected a message array');
    expect(messages[0]).toEqual({ role: 'system', content: EXTRACTION_SYSTEM_PROMPT });
    expect(messages[1]).toEqual({ role: 'user', content: 'I work for the collective.' });
    expect(out.kind).toBe('parsed');
  });

  it('evaluates the parsed result into Claims and truth records', async () => {
    const store = truthStore();
    store.addFact({ id: 'f1', subject: ANA, predicate: 'WORKS_FOR', object: 'org:cell' });
    const gateway = new ScriptedGateway([validReply]);
    const out = await extractClaims(
      { speaker: ANA, utterance: 'I work for the collective.', at: AT, knowledge, toldList: [] },
      { gateway, predicates: registry(), truth: store },
    );
    if (out.kind !== 'parsed') throw new Error('expected a parsed outcome');
    expect(out.claims).toHaveLength(1);
    expect(out.truthRecords[0].held).toBe(true);
    expect(store.claimTruths()).toHaveLength(1);
  });

  it('places the utterance in the user role, never in system content', async () => {
    const gateway = new ScriptedGateway([validReply]);
    await extractClaims(
      { speaker: ANA, utterance: 'the warehouse by the canal', at: AT, knowledge, toldList: [] },
      { gateway, predicates: registry(), truth: truthStore() },
    );
    const messages = gateway.lastInput;
    if (!Array.isArray(messages)) throw new Error('expected a message array');
    expect(messages[0].content).not.toContain('warehouse');
  });
});

describe('extractClaims retry and fallback (Req 7.5)', () => {
  it('retries once after a schema failure and then succeeds', async () => {
    const gateway = new ScriptedGateway([{ claims: [{ bad: true }] }, validReply]);
    const out = await extractClaims(
      { speaker: ANA, utterance: 'I work for the collective.', at: AT, knowledge, toldList: [] },
      { gateway, predicates: registry(), truth: truthStore() },
    );
    expect(gateway.calls).toBe(2);
    expect(out.kind).toBe('parsed');
  });

  it('attaches the raw transcript excerpt as an unparsed note after the retry fails', async () => {
    const gateway = new ScriptedGateway([{ not: 'valid' }]);
    const out = await extractClaims(
      { speaker: ANA, utterance: 'half a sentence that', at: AT, knowledge, toldList: [] },
      { gateway, predicates: registry(), truth: truthStore() },
    );
    // Two attempts: the original plus one retry.
    expect(gateway.calls).toBe(2);
    expect(out.kind).toBe('unparsed');
    if (out.kind !== 'unparsed') return;
    expect(out.excerpt).toBe('half a sentence that');
    expect(out.speaker).toBe(ANA);
    expect(out.at).toEqual(AT);
  });

  it('writes nothing to the Truth Store when parsing fails', async () => {
    const store = truthStore();
    const gateway = new ScriptedGateway([{ not: 'valid' }]);
    await extractClaims(
      { speaker: ANA, utterance: 'garbled', at: AT, knowledge, toldList: [] },
      { gateway, predicates: registry(), truth: store },
    );
    expect(store.claimTruths()).toHaveLength(0);
  });
});
