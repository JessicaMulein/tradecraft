/**
 * Build the meaningful {@link CallRequest} for a call, independent of any
 * client (task 13.5). This is the single place that decides what identifies a
 * call for record and replay, so the live {@link OpenAIGateway} and the
 * model-free {@link ReplayGateway} key calls identically.
 *
 * It mirrors the gateway's own request assembly: normalise the prompt or
 * message list, resolve the role's `RoleConfig` from the active profile, apply
 * the family's reasoning adapter (which may rewrite the messages and add body
 * params), and derive the structured `response_format` from the Zod schema.
 * Only the output-affecting fields are kept — timeouts and timings are left
 * out, because they do not change what the model returns (Req 17.4).
 */

import { z, type ZodType } from 'zod';

import type { ModelsConfig, Role } from '../../config/models-config.js';
import type {
  CallInput,
  ChatMessage,
  JsonSchemaResponseFormat,
} from '../call-types.js';
import {
  familyForModel,
  resolveReasoningAdapter,
  type WarnFn,
} from '../reasoning/reasoning-adapter.js';
import type { CallKind, CallRequest } from './request-hash.js';

/**
 * Describe a call as a {@link CallRequest} using only the config — no client,
 * so a replay never needs an endpoint. `kind` separates a stream from a
 * structured call to the same role and messages; `schema`, when given, adds the
 * structured `response_format`. `warn` is forwarded to the reasoning adapter so
 * an uncontrolled family still warns once, matching the live path.
 */
export function describeCall<T>(
  config: ModelsConfig,
  kind: CallKind,
  role: Role,
  input: CallInput,
  schema?: ZodType<T>,
  warn?: WarnFn,
): CallRequest {
  const settings = config.profiles[config.active][role];
  const messages = toMessages(input);

  const family = familyForModel(config, settings.model);
  const adapter = resolveReasoningAdapter(family, settings.model, warn);
  const mutation = adapter(settings.reasoning, messages);
  const resolvedMessages = mutation.messages ?? messages;
  const reasoning = mutation.extraBody;

  const responseFormat =
    schema !== undefined ? toResponseFormat(role, schema) : undefined;

  return {
    kind,
    role,
    model: settings.model,
    messages: resolvedMessages,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    ...(responseFormat !== undefined ? { responseFormat } : {}),
    ...(reasoning !== undefined && Object.keys(reasoning).length > 0
      ? { reasoning }
      : {}),
  };
}

/** Normalise a bare prompt or message list into a chat message list. */
function toMessages(input: CallInput): readonly ChatMessage[] {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }
  return input;
}

/** Derive an OpenAI `json_schema` response format from a Zod schema. */
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
