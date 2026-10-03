/**
 * The on-disk shape of a recorded session (design "LLM Gateway": `RecordingGateway`
 * appends `{ requestHash, request, response, timings }` to a JSONL file).
 *
 * A recording is a JSON Lines file: one {@link CallRecord} per line, appended
 * in call order. {@link RecordingGateway} writes it; {@link ReplayGateway}
 * reads it and serves calls by {@link CallRecord.requestHash}. The record keeps
 * the full {@link CallRequest} alongside the hash so a recording is
 * self-describing — a human or the eval harness can read what was asked without
 * recomputing anything — and the response in a shape each call path can replay:
 * a stream replays its token sequence, a structured call returns its value.
 */

import type { CallRequest } from './request-hash.js';

/** A stream (or narration) response: the exact token sequence that was */
/** streamed, in order, so replay yields the same tokens. */
export interface StreamResponse {
  readonly type: 'stream';
  readonly tokens: readonly string[];
}

/** A structured response: the validated value the call returned. Stored as */
/** parsed JSON so replay returns a deep copy of the same value. */
export interface StructuredResponse {
  readonly type: 'structured';
  readonly value: unknown;
}

/** The response half of a record: a token stream or a structured value. */
export type CallResponse = StreamResponse | StructuredResponse;

/** Optional wall-clock timings captured while recording, for metrics/debug. */
/** They never affect replay, which keys only on the request hash. */
export interface CallTimings {
  /** Epoch milliseconds when the call started. */
  readonly startedAt: number;
  /** Total duration of the call in milliseconds. */
  readonly durationMs: number;
}

/** One recorded call: the request hash, the full request, the response, and */
/** optional timings. One of these is written per line of the JSONL file. */
export interface CallRecord {
  readonly requestHash: string;
  readonly request: CallRequest;
  readonly response: CallResponse;
  readonly timings?: CallTimings;
}
