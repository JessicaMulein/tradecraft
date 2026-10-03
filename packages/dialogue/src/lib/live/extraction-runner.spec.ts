/**
 * Unit tests for the two-phase extraction runner (`buildExtractionRunner`,
 * slice-integration task 11.3; Requirements 17.1, 17.3, 17.6).
 *
 * The runner wraps the asynchronous Claim Extractor behind the Turn Pipeline's
 * `ExtractionRunner` seam: `start(job)` fires `extractClaims` on the
 * `bookkeeping` role off the critical path and stores the pending outcome keyed
 * by the job; `ready(job)` reports `pending` while it is in flight, then a raw
 * `parsed` result, an `unparsed` note, or `unreachable` when the endpoint
 * rejected. These tests drive the runner over a scripted fake Gateway (no live
 * model) and a real Truth Store, so the mapping from `extractClaims`'s result to
 * the pipeline's `ExtractionReady` is exercised end to end offline.
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
  type TurnId,
} from '@tradecraft/engine';
import {
  ConnectionError,
  type CallInput,
  type CallKind,
  type CallRequest,
  type Gateway,
  type NarrationStream,
  type Role,
} from '@tradecraft/llm';
import type { ZodType } from 'zod';
import { describe, expect, it } from 'vitest';

import { buildExtractionRunner, type LiveSeamDeps, type QueuedExtraction } from './live-seams.js';

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

function queuedJob(turnId: TurnId): QueuedExtraction {
  return {
    turnId,
    speaker: ANA,
    utterance: 'I work for the collective.',
    at: AT,
    speakerKnowledgeAtTurn: { known: [], falseBeliefs: [], promote: [] },
    toldList: [],
    coverIntact: true,
  };
}

function deps(gateway: Gateway, truth: TruthStore | undefined): LiveSeamDeps {
  return {
    getState: () => {
      throw new Error('getState not used by the extraction runner');
    },
    predicates: registry(),
    ...(truth !== undefined ? { truth } : {}),
  };
}

/** A fake Gateway whose `structured` resolves (or rejects) a scripted value. */
class ScriptedGateway implements Gateway {
  lastRole: Role | undefined;

  constructor(private readonly behaviour: { readonly value?: unknown; readonly reject?: boolean }) {}

  structured<T>(role: Role, _input: CallInput, schema: ZodType<T>): Promise<T> {
    this.lastRole = role;
    if (this.behaviour.reject === true) {
      return Promise.reject(new ConnectionError(3, new Error('ECONNREFUSED')));
    }
    return Promise.resolve().then(() => schema.parse(this.behaviour.value));
  }

  stream(): AsyncIterable<string> {
    throw new Error('stream not used by the extraction runner');
  }
  streamNarration(): NarrationStream {
    throw new Error('streamNarration not used by the extraction runner');
  }
  describeCall<T>(
    _kind: CallKind,
    _role: Role,
    _input: CallInput,
    _schema?: ZodType<T>,
  ): CallRequest {
    throw new Error('describeCall not used by the extraction runner');
  }
}

const validReply = {
  claims: [
    { predicate: 'WORKS_FOR', subject: 'npc:ana', object: 'org:cell', hedged: false },
  ],
};

/**
 * Let the started phase-1 promise settle. `extractClaims` awaits the gateway
 * and (on a schema failure) retries, so several microtasks must drain before
 * the runner's stored state flips off `pending`; a macrotask tick is the
 * simplest way to let the whole chain finish.
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('buildExtractionRunner start/ready (Req 17.1)', () => {
  it('runs extractClaims on the bookkeeping role when started', async () => {
    const gateway = new ScriptedGateway({ value: validReply });
    const runner = buildExtractionRunner(gateway, deps(gateway, truthStore()));
    const job = queuedJob('turn:0');

    runner.start(job);
    await flush();

    expect(gateway.lastRole).toBe('bookkeeping');
  });

  it('reports pending before the call resolves and the raw parsed Claims after', async () => {
    const gateway = new ScriptedGateway({ value: validReply });
    const runner = buildExtractionRunner(gateway, deps(gateway, truthStore()));
    const job = queuedJob('turn:0');

    runner.start(job);
    // Before the microtask flush the structured promise has not resolved.
    expect(runner.ready(job)).toBe('pending');

    await flush();

    const ready = runner.ready(job);
    if (typeof ready === 'string' || ready.kind !== 'parsed') {
      throw new Error('expected a parsed result');
    }
    // The pipeline re-evaluates these raw Claims; the runner hands back the raw
    // shape (predicate / entity-or-literal object / hedged), not the verdict.
    expect(ready.result.claims).toEqual([
      { predicate: 'WORKS_FOR', subject: 'npc:ana', object: 'org:cell', hedged: false },
    ]);
  });

  it('reports pending for a job that was never started', () => {
    const gateway = new ScriptedGateway({ value: validReply });
    const runner = buildExtractionRunner(gateway, deps(gateway, truthStore()));
    expect(runner.ready(queuedJob('turn:9'))).toBe('pending');
  });
});

describe('buildExtractionRunner unparsed note (Req 17.3)', () => {
  it('reports an unparsed note carrying the utterance when the reply fails the schema', async () => {
    const gateway = new ScriptedGateway({ value: { not: 'valid' } });
    const runner = buildExtractionRunner(gateway, deps(gateway, truthStore()));
    const job = queuedJob('turn:0');

    runner.start(job);
    await flush();

    const ready = runner.ready(job);
    if (typeof ready === 'string' || ready.kind !== 'unparsed') {
      throw new Error('expected an unparsed note');
    }
    expect(ready.excerpt).toBe('I work for the collective.');
  });
});

describe('buildExtractionRunner unreachable endpoint (Req 17.6)', () => {
  it('reports unreachable when the structured call rejects', async () => {
    const gateway = new ScriptedGateway({ reject: true });
    const runner = buildExtractionRunner(gateway, deps(gateway, truthStore()));
    const job = queuedJob('turn:0');

    runner.start(job);
    await flush();

    expect(runner.ready(job)).toBe('unreachable');
  });
});

describe('buildExtractionRunner without a Truth Store', () => {
  it('never starts the call and stays pending (the model-free default)', async () => {
    const gateway = new ScriptedGateway({ value: validReply });
    const runner = buildExtractionRunner(gateway, deps(gateway, undefined));
    const job = queuedJob('turn:0');

    runner.start(job);
    await flush();

    expect(gateway.lastRole).toBeUndefined();
    expect(runner.ready(job)).toBe('pending');
  });
});
