/**
 * The {@link Gateway} interface the dialogue and narrator pipelines call
 * (design "LLM Gateway"). It is the public surface those layers use, pulled out
 * of {@link OpenAIGateway} so the live gateway, the {@link RecordingGateway}
 * and the {@link ReplayGateway} are interchangeable — a session can be played
 * live, recorded while live, or replayed from a recording without a model, and
 * nothing downstream changes (Req 17.3, 17.4).
 *
 * The interface is the subset of `OpenAIGateway`'s methods the pipelines
 * depend on: `stream` for a free-text reply, `structured` for schema-constrained
 * output (intent classification, claim extraction), and `streamNarration` for
 * the cancellable Narrator Flavour stream. The config-shaped helpers
 * (`listModels`, `checkStartup`, `roleConfig`) stay on the concrete gateway;
 * record and replay only wrap the call paths that produce model output.
 */

import type { ZodType } from 'zod';

import type { Role } from '../config/models-config.js';
import type { CallInput } from './call-types.js';
import type {
  CallHandle,
  NarrateOptions,
  StreamOptions,
  StructuredOptions,
} from './openai-gateway.js';
import type { CallKind, CallRequest } from './record/request-hash.js';
import type { NarrationStream } from './resilience/narration-stream.js';

export type { CallInput } from './call-types.js';
export type {
  CallHandle,
  NarrateOptions,
  StreamOptions,
  StructuredOptions,
} from './openai-gateway.js';
export type { NarrationStream } from './resilience/narration-stream.js';

/**
 * The call surface the dialogue pipeline and the Narrator use. {@link
 * OpenAIGateway} implements it live; {@link RecordingGateway} and {@link
 * ReplayGateway} wrap or stand in for it so a session can be recorded or
 * replayed deterministically.
 */
export interface Gateway {
  /**
   * Stream a free-text completion for `role`, yielding content tokens in
   * arrival order. See {@link OpenAIGateway.stream}.
   */
  stream(
    role: Role,
    input: CallInput,
    options?: StreamOptions,
  ): AsyncIterable<string>;

  /**
   * Request schema-constrained structured output for `role` and return the
   * value validated against `schema`. See {@link OpenAIGateway.structured}.
   */
  structured<T>(
    role: Role,
    input: CallInput,
    schema: ZodType<T>,
    options?: StructuredOptions,
  ): Promise<T>;

  /**
   * Stream Narrator Flavour as a cancellable {@link NarrationStream}. See
   * {@link OpenAIGateway.streamNarration}.
   */
  streamNarration(input: CallInput, options?: NarrateOptions): NarrationStream;

  /**
   * Describe a call as the meaningful {@link CallRequest} the recording layer
   * hashes and keys on. See {@link OpenAIGateway.describeCall}. This is the
   * single source of truth for what identifies a call, so a {@link
   * RecordingGateway} and a {@link ReplayGateway} wrapping the same underlying
   * gateway agree on every hash.
   */
  describeCall<T>(
    kind: CallKind,
    role: Role,
    input: CallInput,
    schema?: ZodType<T>,
  ): CallRequest;
}

/** Re-exported for implementers that build their own {@link CallHandle}. */
export type { CallHandle as GatewayCallHandle };
