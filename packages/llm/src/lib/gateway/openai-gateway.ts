/**
 * The OpenAI-compatible Gateway client (Requirements 14.1, 14.3, 14.4).
 *
 * The Gateway talks to an OpenAI-compatible server — LM Studio on localhost by
 * default — through the `openai` npm client pointed at the configured endpoint,
 * so any compatible server can be swapped in by changing `endpoint` in
 * `models.yaml` (design "Technology choices"). This file covers the connection,
 * `listModels()` and the startup model check (task 13.1) plus the `stream()`
 * and `structured()` call paths (task 13.2).
 *
 * Calls route by Model Role: each role's `RoleConfig` in the active profile
 * supplies the model id and the per-call settings (temperature, max tokens,
 * timeout) applied to that call. Reasoning-mode wiring and retries/fallback are
 * later tasks (13.3, 13.4); the request is assembled through `buildRequest()`
 * and `callOptions()` so those slot in without reshaping the call paths.
 *
 * LM Studio does not require an API key, but the `openai` client insists on a
 * non-empty one, so a placeholder is sent when the caller gives none.
 */

import OpenAI from 'openai';
import { z, type ZodType } from 'zod';

import type { ModelsConfig, Profile, Role, RoleConfig } from '../config/models-config.js';
import type {
  CallInput,
  ChatMessage,
  JsonSchemaResponseFormat,
} from './call-types.js';
export type {
  CallInput,
  ChatMessage,
  JsonSchemaResponseFormat,
} from './call-types.js';
import {
  checkModels,
  type ModelCheckResult,
} from './model-check.js';
import {
  familyForModel,
  resolveReasoningAdapter,
  type WarnFn,
} from './reasoning/reasoning-adapter.js';
import { CallMetrics } from './metrics/call-metrics.js';
import { systemClock, type Clock } from './metrics/clock.js';
import type { MetricsOutcome, MetricsSink } from './metrics/metrics-record.js';
import { describeCall } from './record/describe-call.js';
import type { CallKind, CallRequest } from './record/request-hash.js';
import {
  cancellableNarration,
  type NarrationStream,
} from './resilience/narration-stream.js';
import { CallPriority, rolePriority } from './resilience/priority.js';
import { runWithRetryAndFallback } from './resilience/retry.js';
import { PriorityScheduler } from './resilience/scheduler.js';
import { TimeoutError, withTimeout } from './resilience/timeout.js';

/** The minimal slice of the OpenAI client the Gateway relies on, for testing. */
export interface ModelLister {
  readonly models: {
    list(): AsyncIterable<{ id: string }>;
  };
}

/** A streamed completion chunk — only the delta content the Gateway reads. */
export interface ChatCompletionChunk {
  readonly choices: ReadonlyArray<{
    readonly delta?: { readonly content?: string | null };
  }>;
}

/** A non-streamed completion — only the message content the Gateway reads. */
export interface ChatCompletion {
  readonly choices: ReadonlyArray<{
    readonly message?: { readonly content?: string | null };
  }>;
}

/** The request body the Gateway builds for a chat-completion call. */
export interface ChatRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly temperature: number;
  readonly max_tokens: number;
  readonly stream?: boolean;
  readonly response_format?: JsonSchemaResponseFormat;
  /**
   * Family-specific reasoning controls merged in by the reasoning adapter
   * (task 13.3), such as `chat_template_kwargs` or `reasoning_effort`. These
   * ride through to the OpenAI-compatible server as extra body params; the key
   * set depends on the model family, so this is deliberately open.
   */
  readonly [extraParam: string]: unknown;
}

/** The per-call request options the Gateway attaches, e.g. the timeout. */
export interface ChatCallOptions {
  readonly timeout: number;
}

/**
 * The minimal slice of the OpenAI client's chat API the Gateway relies on. Both
 * overloads return something the Gateway consumes: a streaming call yields
 * chunks, a non-streaming call resolves to a completion. Supply a fake in tests
 * to drive streaming and structured responses without a live endpoint, the same
 * way {@link ModelLister} fakes the model list.
 */
export interface ChatClient {
  readonly chat: {
    readonly completions: {
      create(
        body: ChatRequest & { readonly stream: true },
        options?: ChatCallOptions,
      ): Promise<AsyncIterable<ChatCompletionChunk>>;
      create(
        body: ChatRequest & { readonly stream?: false },
        options?: ChatCallOptions,
      ): Promise<ChatCompletion>;
    };
  };
}

/** The injectable client: lists models and makes chat-completion calls. */
export type GatewayClient = ModelLister & ChatClient;

/**
 * A handle to one in-flight or completed call. The dialogue and narrator layers
 * call `markReleased()` when the guards release the call's first sentence, so
 * the metrics log can record time-to-first-sentence (design "Play metrics",
 * Req 15.3, 15.6). `markReleased()` sets the call's time-to-first-sentence from
 * call start to the moment it is called; the record is written when the call
 * completes (task 13.6).
 */
export interface CallHandle {
  /** The Model Role the call was routed to. */
  readonly role: Role;
  /** The model id the call used, from the role's config. */
  readonly model: string;
  /**
   * Report that the guards released the call's first sentence. The first call
   * fixes the time-to-first-sentence recorded in the metrics log; later calls
   * are ignored.
   */
  markReleased(): void;
}

/** Options accepted by {@link OpenAIGateway.stream}. */
export interface StreamOptions {
  /** Receives the {@link CallHandle} once the call is routed, before tokens. */
  readonly onHandle?: (handle: CallHandle) => void;
  /**
   * The priority band for the call. Defaults to the role's band
   * (see {@link rolePriority}). Callers that know their pipeline stage pass it
   * explicitly so, e.g., an intent classification run on the `voice` model
   * still outranks a reply.
   */
  readonly priority?: CallPriority;
  /**
   * The pipeline stage this call serves, recorded as the metric's `purpose`.
   * Defaults to the call kind (`stream`). Callers that know the stage pass a
   * label (e.g. `voice`) so the metrics log and the eval harness can group by
   * it (Req 15.6).
   */
  readonly purpose?: string;
}

/** Options accepted by {@link OpenAIGateway.structured}. */
export interface StructuredOptions {
  /** The priority band for the call. Defaults to the role's band. */
  readonly priority?: CallPriority;
  /**
   * Receives the {@link CallHandle} once the call is routed. A structured call
   * releases its whole value at once, so the handle lets the caller report the
   * release for time-to-first-sentence, consistent with the streaming paths.
   */
  readonly onHandle?: (handle: CallHandle) => void;
  /**
   * The pipeline stage this call serves, recorded as the metric's `purpose`.
   * Defaults to the call kind (`structured`); pass e.g. `intent` or
   * `extraction` when the stage is known.
   */
  readonly purpose?: string;
}

/** Options accepted by {@link OpenAIGateway.streamNarration}. */
export interface NarrateOptions {
  /** Receives the {@link CallHandle} once the call is routed, before tokens. */
  readonly onHandle?: (handle: CallHandle) => void;
  /**
   * The pipeline stage recorded as the metric's `purpose`. Defaults to the
   * call kind (`narration`).
   */
  readonly purpose?: string;
}


/** Options for constructing an {@link OpenAIGateway}. */
export interface OpenAIGatewayOptions {
  /**
   * A pre-built client. Supply this in tests with a fake that yields a model
   * list; in production it is left unset and the Gateway builds the real
   * `openai` client against `config.endpoint`.
   */
  readonly client?: GatewayClient;
  /**
   * The API key to send. LM Studio ignores it; a placeholder is used when it is
   * omitted so the `openai` client does not reject an empty key.
   */
  readonly apiKey?: string;
  /**
   * Where the reasoning layer reports an uncontrolled model family (task 13.3).
   * Defaults to `console.warn`; tests inject a spy to assert the warning fires
   * once per model id.
   */
  readonly warn?: WarnFn;
  /**
   * How many model calls may run at once against the endpoint. Defaults to 1 —
   * the local endpoint serves one model line, so calls run strictly in priority
   * order. Tests raise it to exercise concurrent dispatch.
   */
  readonly concurrency?: number;
  /**
   * Where play metrics are appended, one record per call (Req 15.3, 15.6).
   * Supply a {@link FileMetricsSink} at `scenario.metrics.path` in production,
   * or an in-memory sink in tests. When omitted, metrics are not recorded —
   * the gateway runs exactly as before, so recording is purely additive.
   */
  readonly metrics?: MetricsSink;
  /**
   * The clock the metrics layer reads for timestamps and durations. Defaults
   * to the system clock; tests inject a fake clock to assert exact `ttfsMs`,
   * `durationMs` and `tokensPerSec` values.
   */
  readonly clock?: Clock;
}

/**
 * The live Gateway. Holds the validated config and a lazily-usable client, and
 * exposes the endpoint-facing operations the rest of the slice builds on.
 */
export class OpenAIGateway {
  private readonly config: ModelsConfig;
  private readonly client: GatewayClient;
  private readonly warn?: WarnFn;
  private readonly scheduler: PriorityScheduler;
  private readonly metrics?: MetricsSink;
  private readonly clock: Clock;

  constructor(config: ModelsConfig, options: OpenAIGatewayOptions = {}) {
    this.config = config;
    this.warn = options.warn;
    this.scheduler = new PriorityScheduler({ concurrency: options.concurrency });
    this.metrics = options.metrics;
    this.clock = options.clock ?? systemClock;
    this.client =
      options.client ??
      (new OpenAI({
        baseURL: config.endpoint,
        apiKey: options.apiKey ?? 'lm-studio',
      }) as unknown as GatewayClient);
  }

  /** The profile the game runs, resolved from `active`. */
  activeProfile(): Profile {
    return this.config.profiles[this.config.active];
  }

  /**
   * List the model ids the endpoint reports as available. Mirrors the
   * `LLMGateway.listModels()` interface in the design. Any transport failure
   * (endpoint down, bad URL) propagates to the caller, which turns it into the
   * recoverable error the design describes.
   */
  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    for await (const model of this.client.models.list()) {
      ids.push(model.id);
    }
    return ids;
  }

  /**
   * The startup check: list the endpoint's models and report any role in the
   * active profile whose model is missing (Requirements 14.3, 14.5). Returns
   * the structured result so the caller can offer to switch profile or
   * continue with fallbacks, as the error-handling table prescribes.
   */
  async checkStartup(): Promise<ModelCheckResult> {
    const available = await this.listModels();
    return checkModels(this.activeProfile(), available);
  }

  /** The active profile's config for one role: model id and call settings. */
  roleConfig(role: Role): RoleConfig {
    return this.activeProfile()[role];
  }

  /**
   * Describe a call as the meaningful {@link CallRequest} the recording layer
   * hashes and stores (task 13.5). This resolves exactly the fields that change
   * what the model is asked — the role's model id, the assembled messages
   * (reasoning adapter applied), the sampling settings, the structured
   * `response_format` and any reasoning body params — so {@link
   * RecordingGateway} can key a record and {@link ReplayGateway} can match one
   * without re-deriving the request. Timeouts and timings are excluded on
   * purpose; they do not change the output.
   */
  describeCall<T>(
    kind: CallKind,
    role: Role,
    input: CallInput,
    schema?: ZodType<T>,
  ): CallRequest {
    return describeCall(this.config, kind, role, input, schema, this.warn);
  }

  /**
   * Stream a chat completion for `role`. The role's `RoleConfig` supplies the
   * model id and per-call settings; the result is the stream of content tokens
   * the dialogue pipeline consumes, in arrival order, skipping empty deltas.
   * `onHandle` receives the {@link CallHandle} as soon as the call is routed,
   * before any token, so the caller can wire `markReleased()` for metrics
   * (task 13.6).
   *
   * The call runs through the priority scheduler and the resilience policy
   * (task 13.4): it waits for a slot in priority order, and the opening of the
   * stream (reaching the first token, within the role's timeout) is subject to
   * retry-once-then-fall-back-to-`fast`. A failure to even start the stream —
   * a timeout, a connection error — is retried once under the same role and
   * then re-issued under `fast`; once tokens are flowing they pass through
   * untouched, because a partial stream cannot be re-issued.
   */
  stream(
    role: Role,
    input: CallInput,
    options: StreamOptions = {},
  ): AsyncIterable<string> {
    const metrics = this.startMetrics(role, options.purpose ?? 'stream');
    options.onHandle?.(this.makeHandle(role, this.roleConfig(role), metrics));
    return this.scheduledStream(
      role,
      input,
      {
        priority: options.priority ?? rolePriority(role),
        preemptible: false,
      },
      undefined,
      metrics,
    );
  }

  /**
   * Stream Narrator Flavour as a {@link NarrationStream} that can be cancelled
   * before its first sentence (design "LLM Gateway"). The call is scheduled at
   * Narrator priority and marked preemptible, so an incoming higher-priority
   * action reclaims the model slot from a narration that has not yet produced a
   * sentence. The returned stream exposes `cancel()`, which the player-view
   * layer calls when the next action arrives; cancelling before the first
   * sentence stops the stream and aborts the call, while cancelling after it is
   * a no-op.
   *
   * The Narrator does **not** fall back to `fast` (Req 16.2, 16.5): the
   * resilience policy retries once and then surfaces the failure, which the
   * narration layer turns into fact-only output. Only the `narrator` role is
   * valid here.
   */
  streamNarration(
    input: CallInput,
    options: NarrateOptions = {},
  ): NarrationStream {
    const role: Role = 'narrator';
    const metrics = this.startMetrics(role, options.purpose ?? 'narration');
    options.onHandle?.(this.makeHandle(role, this.roleConfig(role), metrics));

    const controller = new AbortController();
    const raw = this.scheduledStream(
      role,
      input,
      { priority: CallPriority.Narrator, preemptible: true },
      controller,
      metrics,
    );
    return cancellableNarration(raw, { controller });
  }

  /**
   * Request schema-constrained structured output for `role` and re-validate it
   * with the Zod schema (Requirement 14.4). The call sends `response_format`
   * carrying a JSON Schema derived from `schema` via `z.toJSONSchema`, so the
   * endpoint constrains generation; the returned JSON is then parsed and run
   * back through `schema`, so a model that drifts from the shape is caught
   * rather than trusted. Used for intent classification and claim extraction.
   *
   * The call runs through the priority scheduler and the resilience policy
   * (task 13.4): it waits for a slot in priority order, times out at the role's
   * `timeoutMs`, and on a timeout or error retries once and then falls back to
   * the `fast` role (Req 16.2). The schema is validated on each attempt, so a
   * fallback that still fails validation surfaces as an error the caller
   * handles.
   */
  structured<T>(
    role: Role,
    input: CallInput,
    schema: ZodType<T>,
    options: StructuredOptions = {},
  ): Promise<T> {
    const priority = options.priority ?? rolePriority(role);
    const metrics = this.startMetrics(role, options.purpose ?? 'structured');
    options.onHandle?.(this.makeHandle(role, this.roleConfig(role), metrics));

    // Track how the call ended across retry/fallback so the record reflects
    // the call as the pipeline saw it: a fallback to `fast` is `fallback`, a
    // timeout is `timeout`, any other failure `rejected`, success `ok`.
    const tracker = new OutcomeTracker();
    const run = this.scheduler.submit(
      (signal) =>
        runWithRetryAndFallback(
          role,
          (attemptRole) =>
            this.structuredAttempt(attemptRole, input, schema, signal),
          { onFallback: () => tracker.sawFallback() },
        ),
      { priority },
    );

    return run.then(
      (value) => {
        // A structured value is released whole; count its JSON length as the
        // completion-token proxy and mark the single release for TTFS.
        metrics.countTokens(completionLength(value));
        metrics.markReleased();
        metrics.finish(tracker.resolve('ok'));
        return value;
      },
      (err: unknown) => {
        metrics.finish(tracker.resolve(outcomeFor(err)));
        throw err;
      },
    );
  }

  /** One structured attempt under a role, with its own timeout. */
  private async structuredAttempt<T>(
    role: Role,
    input: CallInput,
    schema: ZodType<T>,
    signal: AbortSignal,
  ): Promise<T> {
    const settings = this.roleConfig(role);
    const request = {
      ...this.buildRequest(role, input),
      stream: false as const,
      response_format: toResponseFormat(role, schema),
    };

    const controller = new AbortController();
    forwardAbort(signal, controller);

    const completion = await withTimeout(
      this.client.chat.completions.create(request, this.callOptions(settings)),
      settings.timeoutMs,
      { label: `structured call for role "${role}"`, controller },
    );

    const content = completion.choices[0]?.message?.content;
    if (content == null || content === '') {
      throw new Error(
        `structured call for role "${role}" returned no content`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `structured call for role "${role}" returned invalid JSON: ${detail}`,
      );
    }
    return schema.parse(parsed);
  }

  /**
   * Run a streaming call through the scheduler and the resilience policy, and
   * bridge its tokens into an async iterable the caller consumes. The scheduled
   * job holds its slot for the whole stream, so a preemptible narration gives
   * up the slot (via `signal`) when a higher-priority call arrives. The policy
   * applies to *opening* the stream: a failure to produce the first token in
   * time is retried once, then — unless the role is `narrator` — re-issued
   * under `fast`.
   */
  private scheduledStream(
    role: Role,
    input: CallInput,
    submit: { readonly priority: CallPriority; readonly preemptible: boolean },
    externalController?: AbortController,
    metrics?: CallMetrics,
  ): AsyncIterable<string> {
    const bridge = new TokenBridge(metrics);
    const tracker = new OutcomeTracker();

    const run = this.scheduler.submit<void>(async (signal) => {
      // When the external controller (narrator cancel) aborts, propagate to the
      // scheduler job's signal path by forwarding into the per-attempt one.
      await runWithRetryAndFallback(
        role,
        (attemptRole) =>
          this.streamAttempt(
            attemptRole,
            input,
            bridge,
            signal,
            externalController,
          ),
        { onFallback: () => tracker.sawFallback() },
      );
    }, submit);

    // Settle the bridge when the scheduled job ends: a clean end closes it, any
    // failure (including preemption) ends the stream with that error. The
    // metrics record is written here, once, with the outcome of the whole call.
    run.then(
      () => {
        metrics?.finish(tracker.resolve('ok'));
        bridge.close();
      },
      (err: unknown) => {
        metrics?.finish(tracker.resolve(outcomeFor(err)));
        bridge.fail(err);
      },
    );

    return bridge.iterable();
  }

  /**
   * One streaming attempt under a role. Opens the stream within the role's
   * timeout (first-byte), then forwards every non-empty token to the bridge.
   * Rejects if the stream cannot be opened or the first token does not arrive
   * in time, which is what the retry/fallback policy reacts to. Mid-stream
   * errors reject too, but by then tokens are already released, so the policy's
   * retry simply surfaces the error rather than re-issuing.
   */
  private async streamAttempt(
    role: Role,
    input: CallInput,
    bridge: TokenBridge,
    jobSignal: AbortSignal,
    externalController?: AbortController,
  ): Promise<void> {
    const settings = this.roleConfig(role);
    const request = { ...this.buildRequest(role, input), stream: true as const };

    const controller = new AbortController();
    forwardAbort(jobSignal, controller);
    if (externalController) {
      forwardAbort(externalController.signal, controller);
    }

    let chunks: AsyncIterable<ChatCompletionChunk>;
    try {
      chunks = await withTimeout(
        this.client.chat.completions.create(request, this.callOptions(settings)),
        settings.timeoutMs,
        { label: `stream call for role "${role}"`, controller },
      );
    } catch (err) {
      // A rejection caused by our own preemption/cancel is not a call failure;
      // end the attempt cleanly so the policy does not retry a cancelled call.
      if (controller.signal.aborted) {
        return;
      }
      throw err;
    }

    // Drive the iterator by hand so an abort — a preemption or a narrator
    // cancel — can interrupt a `next()` that would otherwise never resolve
    // (the hung-stream case). The abort wins the race and ends the attempt.
    const iterator = chunks[Symbol.asyncIterator]();
    const aborted = abortPromise(controller.signal);
    try {
      for (;;) {
        if (controller.signal.aborted) {
          return;
        }
        const result = await Promise.race([iterator.next(), aborted]);
        if (result === ABORTED || controller.signal.aborted) {
          return;
        }
        if (result.done) {
          return;
        }
        const token = result.value.choices[0]?.delta?.content;
        if (token) {
          bridge.push(token);
        }
      }
    } finally {
      // Best-effort: let the underlying iterator release its resources.
      void iterator.return?.();
    }
  }

  /**
   * Build a {@link CallHandle} for a routed call. `markReleased()` reports the
   * first-released-sentence moment into the call's {@link CallMetrics}, so the
   * metrics log records time-to-first-sentence (Req 15.3, 15.6).
   */
  private makeHandle(
    role: Role,
    settings: RoleConfig,
    metrics: CallMetrics,
  ): CallHandle {
    return {
      role,
      model: settings.model,
      markReleased() {
        metrics.markReleased();
      },
    };
  }

  /**
   * Open a {@link CallMetrics} for a call about to run, routed to `role` and
   * labelled with `purpose`. When no metrics sink is configured, a no-op sink
   * is used so the call paths stay uniform and recording is purely additive.
   */
  private startMetrics(role: Role, purpose: string): CallMetrics {
    const settings = this.roleConfig(role);
    return new CallMetrics(
      role,
      settings.model,
      purpose,
      this.clock,
      this.metrics ?? NOOP_METRICS_SINK,
    );
  }

  /**
   * Assemble the base chat-completion request for a role. Normalises the prompt
   * or message list into messages, applies the role's per-call settings
   * (temperature, max tokens), and applies the role's reasoning mode through
   * the family's reasoning adapter (task 16.5). The adapter — resolved from the
   * role model's configured `family` in the `models` map, not from the Load
   * Identifier string — may add family-specific body params (for example
   * `chat_template_kwargs`) and/or rewrite the messages with a reasoning
   * directive; an uncontrolled family leaves the request unchanged. This is the
   * single assembly point: the stream flag and `response_format` are layered on
   * by the respective call paths.
   */
  private buildRequest(role: Role, input: CallInput): ChatRequest {
    const settings = this.roleConfig(role);
    const messages = toMessages(input);

    const family = familyForModel(this.config, settings.model);
    const adapter = resolveReasoningAdapter(family, settings.model, this.warn);
    const mutation = adapter(settings.reasoning, messages);

    return {
      model: settings.model,
      messages: mutation.messages ?? messages,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      ...mutation.extraBody,
    };
  }

  /** The per-call request options derived from a role's settings. */
  private callOptions(settings: RoleConfig): ChatCallOptions {
    return { timeout: settings.timeoutMs };
  }
}

/**
 * A metrics sink that drops everything, used when no sink is configured so the
 * call paths can always build a {@link CallMetrics} and recording stays a
 * no-op rather than a special case.
 */
const NOOP_METRICS_SINK: MetricsSink = {
  append() {
    /* metrics disabled: drop the record */
  },
};

/**
 * Tracks the outcome of a call across the retry/fallback policy. The policy
 * reports a fallback through `onFallback`; the final `resolve` turns the call's
 * end into the recorded {@link MetricsOutcome}: a success after a fallback is
 * `fallback`, a plain success is `ok`, and a failure keeps whatever outcome the
 * error maps to (timeout vs rejected).
 */
class OutcomeTracker {
  private fellBack = false;

  /** The policy fell back to the `fast` role. */
  sawFallback(): void {
    this.fellBack = true;
  }

  /**
   * Resolve the final outcome. On success, a prior fallback makes it
   * `fallback`; otherwise the given `base` outcome stands (`ok` for success,
   * or the error-mapped outcome for a failure).
   */
  resolve(base: MetricsOutcome): MetricsOutcome {
    if (base === 'ok' && this.fellBack) {
      return 'fallback';
    }
    return base;
  }
}

/** Map a thrown error to the outcome recorded for a failed call. */
function outcomeFor(err: unknown): MetricsOutcome {
  return err instanceof TimeoutError ? 'timeout' : 'rejected';
}

/**
 * The completion-token proxy for a structured call: the length of its JSON
 * serialisation. A structured call returns a parsed value rather than a token
 * stream, so there is no token count to read; the serialised length is a
 * stable, monotonic stand-in the eval harness can compare across runs.
 */
function completionLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Sentinel the abort race resolves to when the signal wins. */
const ABORTED = Symbol('aborted');

/**
 * A promise that resolves to {@link ABORTED} when `signal` aborts. Used to race
 * a hung `iterator.next()` so a preemption or cancel can interrupt it. If the
 * signal is already aborted it resolves immediately.
 */
function abortPromise(signal: AbortSignal): Promise<typeof ABORTED> {
  if (signal.aborted) {
    return Promise.resolve(ABORTED);
  }
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(ABORTED), { once: true });
  });
}

/**
 * Forward an abort from one signal to a controller. When `source` aborts (now
 * or later), `target` is aborted with the same reason, so a scheduler
 * preemption or a narrator cancel reaches the in-flight call's own controller.
 */
function forwardAbort(source: AbortSignal, target: AbortController): void {
  if (source.aborted) {
    target.abort(source.reason);
    return;
  }
  source.addEventListener('abort', () => target.abort(source.reason), {
    once: true,
  });
}

/**
 * A single-producer/single-consumer async queue that bridges a push-style
 * producer (the streaming attempt forwarding tokens) to a pull-style consumer
 * (the `for await` in the dialogue pipeline). Tokens pushed before the consumer
 * asks are buffered; a consumer that asks before a token is available waits.
 * {@link close} ends the stream cleanly; {@link fail} ends it with an error.
 */
class TokenBridge {
  private readonly buffer: string[] = [];
  private pending?: {
    resolve: (result: IteratorResult<string>) => void;
    reject: (reason: unknown) => void;
  };
  private done = false;
  private error?: unknown;

  constructor(private readonly metrics?: CallMetrics) {}

  /** Enqueue a token for the consumer. */
  push(token: string): void {
    if (this.done) {
      return;
    }
    // Count every non-empty token pushed as one completion token for metrics;
    // empty/null deltas are already filtered out upstream before `push`.
    this.metrics?.countTokens();
    if (this.pending) {
      const { resolve } = this.pending;
      this.pending = undefined;
      resolve({ value: token, done: false });
      return;
    }
    this.buffer.push(token);
  }

  /** End the stream cleanly once all pushed tokens are drained. */
  close(): void {
    if (this.done) {
      return;
    }
    this.done = true;
    if (this.pending && this.buffer.length === 0) {
      const { resolve } = this.pending;
      this.pending = undefined;
      resolve({ value: undefined, done: true });
    }
  }

  /** End the stream with an error, surfaced to the consumer. */
  fail(reason: unknown): void {
    if (this.done) {
      return;
    }
    this.done = true;
    this.error = reason;
    if (this.pending) {
      const { reject } = this.pending;
      this.pending = undefined;
      reject(reason);
    }
  }

  /** The consumer-facing async iterable. Iterated at most once. */
  iterable(): AsyncIterable<string> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<IteratorResult<string>> => {
          if (this.buffer.length > 0) {
            const value = this.buffer.shift() as string;
            return Promise.resolve({ value, done: false });
          }
          if (this.error !== undefined) {
            const reason = this.error;
            this.error = undefined;
            return Promise.reject(reason);
          }
          if (this.done) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise<IteratorResult<string>>((resolve, reject) => {
            this.pending = { resolve, reject };
          });
        },
      }),
    };
  }
}

/** Normalise a bare prompt or message list into a chat message list. */
function toMessages(input: CallInput): readonly ChatMessage[] {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }
  return input;
}

/**
 * Derive an OpenAI `json_schema` response format from a Zod schema. The schema
 * is converted with `z.toJSONSchema` and sent `strict`, so the endpoint
 * constrains output to the shape; the Gateway still re-validates on return.
 */
function toResponseFormat(
  role: Role,
  schema: ZodType<unknown>,
): JsonSchemaResponseFormat {
  return {
    type: 'json_schema',
    json_schema: {
      name: `${role}_response`,
      schema: z.toJSONSchema(schema) as Record<string, unknown>,
      strict: true,
    },
  };
}
