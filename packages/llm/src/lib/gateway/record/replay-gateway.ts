/**
 * The {@link ReplayGateway} (Req 17.3, 17.4; design "LLM Gateway").
 *
 * Req 17.3: the Gateway supports a replay mode that "serves recorded responses
 * without a model". This gateway implements the same {@link Gateway} surface as
 * the live one but contacts no endpoint: it is built from a recording (a list
 * of {@link CallRecord}, or a {@link RecordSource} that reads one) and the same
 * {@link ModelsConfig} the session was recorded under, and serves each call by
 * looking its request up by hash.
 *
 * Because it hashes a replayed call with the exact same {@link describeCall}
 * logic the recorder used, an identical call finds its record and returns the
 * recorded response — a stream replays its token sequence, a structured call
 * returns a deep copy of its value. A call with **no** matching record is an
 * error (Req 17.4): if the pipeline diverges from the recorded run it asks
 * something that was never recorded, and surfacing that as a {@link
 * ReplayMismatchError} is how a divergent replay is caught rather than silently
 * served the wrong response. Narration replays as a {@link NarrationStream}
 * whose `cancel()` is a no-op — there is no live call to abort.
 */

import type { ZodType } from 'zod';

import type { ModelsConfig, Role } from '../../config/models-config.js';
import type { CallInput } from '../call-types.js';
import type {
  CallHandle,
  NarrateOptions,
  StreamOptions,
} from '../openai-gateway.js';
import type { WarnFn } from '../reasoning/reasoning-adapter.js';
import type { NarrationStream } from '../resilience/narration-stream.js';
import type { Gateway } from '../gateway.js';
import { describeCall } from './describe-call.js';
import type { RecordSource } from './jsonl-store.js';
import type { CallRecord, CallResponse } from './records.js';
import { hashRequest, type CallKind, type CallRequest } from './request-hash.js';

/**
 * Thrown when a replayed call has no matching record. It carries the computed
 * hash and a short description of the call so a divergent replay can be
 * diagnosed: either the recording is stale or the pipeline changed what it
 * asks.
 */
export class ReplayMismatchError extends Error {
  constructor(
    readonly requestHash: string,
    readonly request: CallRequest,
  ) {
    super(
      `no recorded response for ${request.kind} call to role ` +
        `"${request.role}" (request hash ${requestHash}); the replay diverged ` +
        `from the recording`,
    );
    this.name = 'ReplayMismatchError';
  }
}

/** Options for a {@link ReplayGateway}. */
export interface ReplayGatewayOptions {
  /**
   * Forwarded to the reasoning adapter when describing a call, so an
   * uncontrolled model family warns the same way it did while recording and the
   * described request — and so its hash — matches. Rarely needed in replay.
   */
  readonly warn?: WarnFn;
}

/** A replayed {@link CallHandle}: carries the role and model, no-op release. */
function replayHandle(role: Role, model: string): CallHandle {
  return {
    role,
    model,
    markReleased() {
      /* no-op: there is no live call to time in replay */
    },
  };
}

/**
 * Serves a recorded session by request hash, with no model. Implements the full
 * {@link Gateway} surface so it is a drop-in for the live gateway in replay.
 */
export class ReplayGateway implements Gateway {
  private readonly config: ModelsConfig;
  private readonly warn?: WarnFn;
  /** requestHash → the records sharing it, consumed in recorded order. */
  private readonly byHash = new Map<string, CallRecord[]>();

  constructor(
    config: ModelsConfig,
    records: readonly CallRecord[] | RecordSource,
    options: ReplayGatewayOptions = {},
  ) {
    this.config = config;
    this.warn = options.warn;
    const all = Array.isArray(records)
      ? (records as readonly CallRecord[])
      : (records as RecordSource).readAll();
    for (const record of all) {
      const bucket = this.byHash.get(record.requestHash);
      if (bucket) {
        bucket.push(record);
      } else {
        this.byHash.set(record.requestHash, [record]);
      }
    }
  }

  stream(
    role: Role,
    input: CallInput,
    options: StreamOptions = {},
  ): AsyncIterable<string> {
    const request = this.describeCall('stream', role, input);
    options.onHandle?.(replayHandle(role, request.model));
    const resolve = (): CallResponse => this.resolve(request);
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<string> {
        // Resolve on iteration so a no-match surfaces as a rejected iteration
        // (like a live stream failing), not a synchronous throw from stream().
        for (const token of asStream(resolve(), request)) {
          yield token;
        }
      },
    };
  }

  streamNarration(
    input: CallInput,
    options: NarrateOptions = {},
  ): NarrationStream {
    const role: Role = 'narrator';
    const request = this.describeCall('narration', role, input);
    options.onHandle?.(replayHandle(role, request.model));
    const resolve = (): CallResponse => this.resolve(request);
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<string> {
        for (const token of asStream(resolve(), request)) {
          yield token;
        }
      },
      cancel() {
        /* no-op: nothing live to cancel in replay */
      },
      firstSentenceSeen: false,
      cancelled: false,
    };
  }

  structured<T>(role: Role, input: CallInput, schema: ZodType<T>): Promise<T> {
    // Wrap in a resolved-then chain so a no-match or shape mismatch surfaces as
    // a rejected promise, matching how a live structured call fails.
    return Promise.resolve().then(() => {
      const request = this.describeCall('structured', role, input, schema);
      const response = this.resolve(request);
      if (response.type !== 'structured') {
        throw new Error(
          `recorded response for structured call to role "${role}" is a ` +
            `${response.type} response`,
        );
      }
      // Deep-copy so the caller cannot mutate the stored record, and a second
      // replay of the same call sees the pristine value.
      return deepClone(response.value) as T;
    });
  }

  describeCall<T>(
    kind: CallKind,
    role: Role,
    input: CallInput,
    schema?: ZodType<T>,
  ): CallRequest {
    return describeCall(this.config, kind, role, input, schema, this.warn);
  }

  /**
   * Find the recorded response for a request by hash, consuming matching
   * records in recorded order so a call made twice replays its two recorded
   * responses in turn. A miss throws {@link ReplayMismatchError}.
   */
  private resolve(request: CallRequest): CallResponse {
    const hash = hashRequest(request);
    const bucket = this.byHash.get(hash);
    const record = bucket?.shift();
    if (!record) {
      throw new ReplayMismatchError(hash, request);
    }
    return record.response;
  }
}

/** The token sequence of a stream/narration response, or an error if the */
/** recorded response was a structured value. */
function asStream(
  response: CallResponse,
  request: CallRequest,
): readonly string[] {
  if (response.type !== 'stream') {
    throw new Error(
      `recorded response for ${request.kind} call to role "${request.role}" ` +
        `is a ${response.type} response`,
    );
  }
  return response.tokens;
}

/** A structural deep copy of a JSON-shaped value. */
function deepClone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
