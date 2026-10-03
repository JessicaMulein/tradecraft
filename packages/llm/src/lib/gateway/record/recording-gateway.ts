/**
 * The {@link RecordingGateway} (Req 17.3; design "LLM Gateway").
 *
 * Req 17.3: the Gateway supports a record mode that "persists every request and
 * response". This gateway wraps a real {@link Gateway} (the live
 * {@link OpenAIGateway} or any implementation) and is otherwise transparent:
 * every call is forwarded to the underlying gateway and its result passes
 * straight through to the caller, so recording changes nothing the dialogue
 * pipeline sees. As each call completes it appends one {@link CallRecord} —
 * the request hash, the full request, the response, and timings — to a JSONL
 * {@link RecordSink}, so a later {@link ReplayGateway} can serve the same
 * session with no model (Req 17.4).
 *
 * - `stream` and `streamNarration` tee the token stream: tokens are yielded to
 *   the caller as they arrive and also accumulated, and the record is written
 *   once the stream ends. A stream that errors mid-flight writes no record —
 *   there is no complete response to replay.
 * - `structured` awaits the validated value, writes the record, then returns
 *   the value.
 *
 * The request hash and the request descriptor come from the underlying
 * gateway's {@link Gateway.describeCall}, so recording and replay key calls the
 * exact same way.
 */

import type { ZodType } from 'zod';

import type { Role } from '../../config/models-config.js';
import type { CallInput } from '../call-types.js';
import type {
  NarrateOptions,
  StreamOptions,
  StructuredOptions,
} from '../openai-gateway.js';
import type { NarrationStream } from '../resilience/narration-stream.js';
import type { Gateway } from '../gateway.js';
import type { RecordSink } from './jsonl-store.js';
import type { CallRecord, CallResponse } from './records.js';
import { hashRequest, type CallKind, type CallRequest } from './request-hash.js';

/** Options for a {@link RecordingGateway}. */
export interface RecordingGatewayOptions {
  /**
   * The clock used for record timings, in epoch milliseconds. Defaults to
   * `Date.now`; a test injects a deterministic clock so recorded timings are
   * stable. Timings never affect replay — they key only on the request hash.
   */
  readonly now?: () => number;
}

/**
 * Wraps a {@link Gateway} and appends a {@link CallRecord} for every call to a
 * {@link RecordSink}, while passing the live result through unchanged.
 */
export class RecordingGateway implements Gateway {
  private readonly now: () => number;

  constructor(
    private readonly inner: Gateway,
    private readonly sink: RecordSink,
    options: RecordingGatewayOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  stream(
    role: Role,
    input: CallInput,
    options: StreamOptions = {},
  ): AsyncIterable<string> {
    const request = this.inner.describeCall('stream', role, input);
    const live = this.inner.stream(role, input, options);
    return this.teeStream(request, live);
  }

  streamNarration(
    input: CallInput,
    options: NarrateOptions = {},
  ): NarrationStream {
    const request = this.inner.describeCall('narration', 'narrator', input);
    const live = this.inner.streamNarration(input, options);
    const recorded = this.teeStream(request, live);
    const iterator = recorded[Symbol.asyncIterator].bind(recorded);
    // Preserve the NarrationStream surface (cancel + flags) while recording the
    // tokens the caller actually consumes.
    return {
      [Symbol.asyncIterator]: iterator,
      cancel: () => live.cancel(),
      get firstSentenceSeen(): boolean {
        return live.firstSentenceSeen;
      },
      get cancelled(): boolean {
        return live.cancelled;
      },
    };
  }

  async structured<T>(
    role: Role,
    input: CallInput,
    schema: ZodType<T>,
    options: StructuredOptions = {},
  ): Promise<T> {
    const request = this.inner.describeCall('structured', role, input, schema);
    const startedAt = this.now();
    const value = await this.inner.structured(role, input, schema, options);
    this.write(request, { type: 'structured', value }, startedAt);
    return value;
  }

  describeCall<T>(
    kind: CallKind,
    role: Role,
    input: CallInput,
    schema?: ZodType<T>,
  ): CallRequest {
    return this.inner.describeCall(kind, role, input, schema);
  }

  /**
   * Yield the live stream's tokens to the caller as they arrive, accumulate a
   * copy, and append the record once the stream ends cleanly. A stream that
   * throws before completing writes nothing — a partial response cannot be
   * replayed.
   */
  private teeStream(
    request: CallRequest,
    live: AsyncIterable<string>,
  ): AsyncIterable<string> {
    const startedAt = this.now();
    const write = (tokens: readonly string[]): void =>
      this.write(request, { type: 'stream', tokens }, startedAt);
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<string> {
        const tokens: string[] = [];
        for await (const token of live) {
          tokens.push(token);
          yield token;
        }
        write(tokens);
      },
    };
  }

  /** Append one record for a completed call. */
  private write(
    request: CallRequest,
    response: CallResponse,
    startedAt: number,
  ): void {
    const record: CallRecord = {
      requestHash: hashRequest(request),
      request,
      response,
      timings: { startedAt, durationMs: this.now() - startedAt },
    };
    this.sink.append(record);
  }
}
