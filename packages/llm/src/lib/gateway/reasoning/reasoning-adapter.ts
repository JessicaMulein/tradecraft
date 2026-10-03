/**
 * Reasoning adapters (Requirements 21.4, 21.9).
 *
 * Each model family switches reasoning on or off its own way: a chat-template
 * flag, a system/prompt directive, or no control at all (design "LLM Gateway":
 * "A `ReasoningAdapter` per family hides this. Unknown families default to 'no
 * control' and log a warning."). This module is the single place that knowledge
 * lives: a per-family adapter maps a {@link ReasoningMode} to the concrete
 * request mutation — extra body params and/or a system directive — the model
 * expects.
 *
 * The family is read from the model entry's `family` field in `models.yaml`
 * rather than detected from the model id. Load Identifiers such as `qwen-moe`
 * or `gemma-31b` no longer contain the template family name, so a substring
 * match on the id would miss them (design "Reasoning adapters"); the config's
 * `models` map carries the family explicitly instead.
 *
 * Adapters are pure: each takes the mode and the current message list and
 * returns a {@link ReasoningMutation} without touching anything else. The
 * Gateway's `buildRequest()` is the one caller; it resolves the adapter for the
 * call's role model family and applies the mutation, so the call paths never
 * learn family specifics.
 *
 * Mechanisms verified against each family's current model card:
 *
 * - **`qwen3` family** — the chat template exposes an `enable_thinking` flag
 *   (default on); an OpenAI-compatible server reads it from `chat_template_kwargs`
 *   rather than a top-level field, and the template also honours the inline
 *   `/think` and `/no_think` soft switches. Newer templates accept a
 *   `reasoning_effort` level. We send `enable_thinking` plus a `reasoning_effort`
 *   level through `chat_template_kwargs` so both older and newer templates land
 *   on the right mode.
 *   Sources: Qwen3 chat-template deep dive
 *   https://huggingface.co/blog/qwen-3-chat-template-deep-dive ,
 *   Qwen docs quickstart
 *   https://qwen.readthedocs.io/en/stable/getting_started/quickstart.html ,
 *   vLLM reasoning outputs
 *   https://docs.vllm.ai/en/latest/features/reasoning_outputs/ .
 *   Content was rephrased for compliance with licensing restrictions.
 *
 * - **`gemma4` family** — Gemma 4's chat template exposes an "Enable Thinking"
 *   flag in LM Studio, the same shape as Qwen3's, so the adapter sets
 *   `enable_thinking` through `chat_template_kwargs` rather than steering with a
 *   prompt directive.
 *   Sources: LM Studio Gemma 4 31B page
 *   https://lmstudio.ai/models/google/gemma-4-31b .
 *   Content was rephrased for compliance with licensing restrictions.
 *
 * - **Unknown family** — no control: the request is unchanged and a warning is
 *   logged once per family/model, matching the design's default.
 */

import type { ModelsConfig, ReasoningMode } from '../../config/models-config.js';

/**
 * One chat message, structurally the same as the gateway's `ChatMessage`. It is
 * declared here rather than imported so the reasoning layer does not depend on
 * the gateway module, which depends on this one — keeping the import graph
 * acyclic (dep-cruise `no-circular`). The gateway's `ChatMessage` is assignable
 * to this type, so adapters compose with the gateway without a cast.
 */
export interface ReasoningMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/**
 * The request-level change an adapter asks for. `extraBody` is merged into the
 * chat-completion body (for example `chat_template_kwargs`); `messages` is the
 * possibly-rewritten message list (for example with a reasoning directive
 * prepended). An adapter that wants no change returns an empty object.
 */
export interface ReasoningMutation {
  /** Extra top-level body params to merge into the request, if any. */
  readonly extraBody?: Record<string, unknown>;
  /** The rewritten message list, if the adapter changed it. */
  readonly messages?: readonly ReasoningMessage[];
}

/**
 * A pure reasoning adapter for one model family: given the desired mode and the
 * current messages, produce the request mutation that puts the model in that
 * mode. Must not mutate its inputs.
 */
export type ReasoningAdapter = (
  mode: ReasoningMode,
  messages: readonly ReasoningMessage[],
) => ReasoningMutation;

/**
 * The model families this module controls reasoning for. These are the
 * `family` values in `models.yaml`'s `models` map, not substrings of the Load
 * Identifier.
 */
export const REASONING_FAMILIES = ['qwen3', 'gemma4'] as const;

export type ReasoningFamily = (typeof REASONING_FAMILIES)[number];

/**
 * The Qwen3 adapter. Sends the `enable_thinking` flag and a `reasoning_effort`
 * level through `chat_template_kwargs`, where OpenAI-compatible servers read it.
 * `off` turns thinking off; `low` keeps it on at a low effort; `on` is full
 * thinking. Messages are left untouched — the template handles the switch.
 */
export const qwenAdapter: ReasoningAdapter = (mode) => {
  switch (mode) {
    case 'off':
      return {
        extraBody: {
          chat_template_kwargs: { enable_thinking: false },
          reasoning_effort: 'none',
        },
      };
    case 'low':
      return {
        extraBody: {
          chat_template_kwargs: { enable_thinking: true },
          reasoning_effort: 'low',
        },
      };
    case 'on':
      return {
        extraBody: {
          chat_template_kwargs: { enable_thinking: true },
          reasoning_effort: 'high',
        },
      };
  }
};

/**
 * The Gemma 4 adapter. Gemma 4's chat template exposes an "Enable Thinking"
 * flag, so — like the Qwen3 adapter — it sets `enable_thinking` through
 * `chat_template_kwargs` and leaves the messages untouched. `off` turns
 * thinking off; `low` and `on` both leave it on (the template has no effort
 * level), with `on` the full-reasoning case.
 */
export const gemmaAdapter: ReasoningAdapter = (mode) => ({
  extraBody: {
    chat_template_kwargs: { enable_thinking: mode !== 'off' },
  },
});

/** The no-op adapter for families this module does not control. */
export const noopAdapter: ReasoningAdapter = () => ({});

/** The adapter registry, keyed by the model entry's `family`. */
const ADAPTERS: Record<ReasoningFamily, ReasoningAdapter> = {
  qwen3: qwenAdapter,
  gemma4: gemmaAdapter,
};

/** A sink for the one-time warning about an uncontrolled family. */
export type WarnFn = (message: string) => void;

/**
 * Resolve the reasoning adapter for a model's configured `family`. A controlled
 * family returns its adapter; any other family returns the no-op adapter and,
 * the first time that family/model pair is seen, logs a warning through `warn`
 * so the developer knows reasoning is uncontrolled for that model (design:
 * "Unknown families default to 'no control' and log a warning."). `warn` is
 * injectable for testing and defaults to `console.warn`; `seen` tracks the
 * already-warned family/model pairs so the warning fires once per pair.
 *
 * `modelId` is the Load Identifier, used only to make the warning actionable;
 * selection is driven entirely by `family`.
 */
export function resolveReasoningAdapter(
  family: string,
  modelId: string,
  warn: WarnFn = (message) => console.warn(message),
  seen: Set<string> = defaultSeen,
): ReasoningAdapter {
  if (isReasoningFamily(family)) {
    return ADAPTERS[family];
  }
  const token = `${family}\u0000${modelId}`;
  if (!seen.has(token)) {
    seen.add(token);
    warn(
      `reasoning: no adapter for family "${family}" (model "${modelId}"); ` +
        `reasoning mode will not be controlled`,
    );
  }
  return noopAdapter;
}

/** Whether `family` is one this module controls reasoning for. */
export function isReasoningFamily(family: string): family is ReasoningFamily {
  return (REASONING_FAMILIES as readonly string[]).includes(family);
}

/**
 * The reasoning `family` configured for a role's Load Identifier. Reads the
 * config's `models` map, which the schema's refinement guarantees contains an
 * entry for every role model (design "Reasoning adapters"). When no entry is
 * found — a config that bypassed validation — an empty string is returned,
 * which routes to the no-op adapter and the uncontrolled-family warning.
 */
export function familyForModel(config: ModelsConfig, loadId: string): string {
  return config.models[loadId]?.family ?? '';
}

/** The process-wide set of family/model pairs already warned about. */
const defaultSeen = new Set<string>();
