/**
 * The request hash that keys a recording (design "LLM Gateway": record and
 * replay by `requestHash`; Req 17.3, 17.4).
 *
 * A recorded session is a list of `{ requestHash, request, response }` lines.
 * Replay serves a call by looking its request up by hash, so the hash must be
 * **deterministic over the meaningful request fields** and nothing else: the
 * same logical call always hashes to the same value, on any machine, regardless
 * of object key order or incidental fields. If replay produces a request that
 * was never recorded — because the pipeline diverged from the recorded run —
 * the lookup misses and the divergence is caught (Req 17.4: a replay reaches an
 * identical final state, so a mismatch must surface rather than be papered
 * over).
 *
 * The meaningful fields are the ones that change what the model is asked and
 * so what it returns: the call `kind` (stream, structured or narration), the
 * Model `role`, the resolved `model` id, the `messages`, the sampling settings
 * (`temperature`, `maxTokens`), the structured `responseFormat`, and any
 * family-specific reasoning body params. Timeouts, retry bookkeeping and
 * timings are deliberately excluded: they do not change the model's output, so
 * two calls that differ only there must replay the same recorded response.
 *
 * Canonicalisation mirrors the content package's pack hash: object keys are
 * sorted and no incidental whitespace is emitted, so deeply-equal requests
 * hash byte-identically. It is kept local to the `llm` package rather than
 * imported, because `content` is a pure data-contract package the gateway does
 * not depend on.
 */

import { createHash } from 'node:crypto';

import type { ChatMessage, JsonSchemaResponseFormat } from '../call-types.js';

/** The kind of call a record captures, so a stream and a structured call to */
/** the same role with the same messages never collide. */
export type CallKind = 'stream' | 'structured' | 'narration';

/**
 * The meaningful shape of one model call, canonicalised and hashed to key a
 * recording. Everything here changes what the model is asked; timeouts and
 * timings are excluded on purpose.
 */
export interface CallRequest {
  /** Which call path produced this request. */
  readonly kind: CallKind;
  /** The Model Role the call routed to. */
  readonly role: string;
  /** The resolved model id for the role, as the endpoint reports it. */
  readonly model: string;
  /** The chat messages sent, in order. */
  readonly messages: readonly ChatMessage[];
  /** The sampling temperature. */
  readonly temperature: number;
  /** The completion token cap. */
  readonly maxTokens: number;
  /** The JSON-Schema `response_format` for a structured call, if any. */
  readonly responseFormat?: JsonSchemaResponseFormat;
  /**
   * Family-specific reasoning body params merged in by the reasoning adapter
   * (e.g. `chat_template_kwargs`, `reasoning_effort`). Open-ended by design.
   */
  readonly reasoning?: Readonly<Record<string, unknown>>;
}

/**
 * Serialise a JSON-shaped value with object keys sorted, so two values that are
 * deeply equal produce byte-identical output regardless of key insertion order.
 * `undefined` members are dropped, matching `JSON.stringify`, and non-finite
 * numbers emit `null`, so hashing never throws on an unexpected value.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(normalise(v))).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const members = keys.map(
      (k) => `${JSON.stringify(k)}:${canonicalJson(normalise(obj[k]))}`,
    );
    return `{${members.join(',')}}`;
  }
  return 'null';
}

/** `undefined` becomes `null` only inside arrays, as `JSON.stringify` does. */
function normalise(value: unknown): unknown {
  return value === undefined ? null : value;
}

/**
 * The lower-case hex SHA-256 of a call's meaningful fields. Two calls that are
 * logically identical hash the same; any difference in kind, role, model,
 * messages, sampling, response format or reasoning params changes the hash.
 */
export function hashRequest(request: CallRequest): string {
  // Build a plain object with only the meaningful fields, so canonicalisation
  // ignores how the CallRequest happened to be constructed.
  const canonical = canonicalJson({
    kind: request.kind,
    role: request.role,
    model: request.model,
    messages: request.messages,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    responseFormat: request.responseFormat,
    reasoning: request.reasoning,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
