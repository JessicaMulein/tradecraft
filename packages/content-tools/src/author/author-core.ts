/**
 * The core of the offline Authoring Aid: calling the model, validating its
 * output and writing drafts to the Draft Area (content-expansion task 5.13;
 * design, "Authoring Aid"; Req 16.2, 16.5, 16.6).
 *
 * `runAuthorCore` ties the pieces together without touching argv or the real
 * network: given a validated {@link AuthoringConfig}, the parsed packs, the
 * draft request and an injected {@link AuthorClient}, it
 *
 * 1. applies the endpoint check (Req 16.7) and refuses a non-local endpoint
 *    unless both the config and the `--remote` flag opt in;
 * 2. builds the prompt from the kind's JSON Schema, the Style Guide, the
 *    in-period Anachronism Entries, the Real-Person Blocklist, the Sensitivity
 *    Term List and samples (Req 16.6; {@link buildPrompt});
 * 3. requests schema-constrained output from the client, parsing each returned
 *    item against the kind's Zod schema;
 * 4. writes the valid items as a content file carrying a Provenance Record
 *    (`generated: true`, the model id, the prompt hash and the generation
 *    time) to `content-drafts/<pack>/<kind>/<UTC timestamp>.yaml` (Req 16.2),
 *    and writes any invalid output to a `.rejected.json` sidecar.
 *
 * The filesystem writer, the clock and the client are all injectable, so the
 * whole flow runs in a unit test with a mocked client and an in-memory sink.
 */

import { z, type ZodType } from 'zod';
import { stringify as toYaml } from 'yaml';
import {
  canonicalJson,
  DRAFT_AREA_SEGMENT,
  CONTENT_KIND_NAMES,
  contentKindSchemas,
  type ContentKindName,
  type ContentKindRegistration,
  type Provenance,
} from '@tradecraft/content';
import { createHash } from 'node:crypto';

import type { ParsedPack } from '../lint/parsed-files.js';
import { endpointDecision, type AuthoringConfig } from './config.js';
import {
  buildPrompt,
  collectPromptInputs,
  type PromptMessages,
  type PromptRequest,
} from './prompt.js';

/**
 * A chat message, matching the OpenAI-compatible shape the `llm` package uses.
 * Kept local so the Authoring Aid never imports the game Gateway's role-routed
 * surface (it uses no Model Role, design "Authoring Aid").
 */
export interface AuthorMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

/** The settings a single authoring call carries. */
export interface AuthorCallOptions {
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
  /** The JSON Schema the endpoint constrains the response to. */
  readonly jsonSchema: Record<string, unknown>;
}

/**
 * The minimal OpenAI-compatible client surface the Authoring Aid drives: one
 * schema-constrained completion returning the model's raw text. The production
 * client wraps the `openai` client against `config.endpoint`
 * ({@link createOpenAiAuthorClient}); a test injects a fake that returns a
 * canned string, so no endpoint is needed.
 */
export interface AuthorClient {
  complete(
    messages: readonly AuthorMessage[],
    options: AuthorCallOptions,
  ): Promise<string>;
}

/** A minimal filesystem sink, so draft writing is testable without disk. */
export interface DraftSink {
  write(path: string, contents: string): void;
}

/** The clock the draft timestamp and filename read; injectable for tests. */
export interface AuthorClock {
  now(): Date;
}

/** The default clock: the system clock. */
export const systemAuthorClock: AuthorClock = {
  now: () => new Date(),
};

/** One draft request: the pack, kind, count and optional brief. */
export interface AuthorRequest extends PromptRequest {
  /** The pack id the draft is for; the Draft Area path uses it. */
  readonly pack: string;
}

/** The outcome of a draft run. */
export interface AuthorResult {
  /** The Draft Area path the valid items were written to, if any were valid. */
  readonly draftPath?: string;
  /** The `.rejected.json` sidecar path, if any output was invalid. */
  readonly rejectedPath?: string;
  /** How many returned items validated against the kind's schema. */
  readonly accepted: number;
  /** How many returned items failed validation. */
  readonly rejected: number;
  /** The prompt hash stamped into the draft's provenance. */
  readonly promptHash: string;
}

/** The response envelope the model is asked to return: `{ items: [...] }`. */
const ResponseEnvelopeSchema = z.object({ items: z.array(z.unknown()) });

/** The Zod schema for a kind, from the slice registry or the effective one. */
function kindSchema(
  kind: string,
  registry: readonly ContentKindRegistration[],
): ZodType<unknown> {
  if ((CONTENT_KIND_NAMES as readonly string[]).includes(kind)) {
    return contentKindSchemas[kind as ContentKindName] as ZodType<unknown>;
  }
  const reg = registry.find((r) => r.kind === kind);
  if (reg === undefined) {
    throw new Error(
      `content author: unknown kind "${kind}" (not in the Content Kind Registry)`,
    );
  }
  return reg.schema as ZodType<unknown>;
}

/** The prompt hash recorded in provenance: SHA-256 over the canonical prompt. */
export function hashPrompt(messages: PromptMessages): string {
  return createHash('sha256')
    .update(canonicalJson({ system: messages.system, user: messages.user }))
    .digest('hex');
}

/**
 * A UTC timestamp safe for a filename: `YYYY-MM-DDTHH-MM-SS-mmmZ`. Colons and
 * dots in the ISO form are replaced with dashes so the name is portable.
 */
export function draftStamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

/**
 * The Draft Area path for a draft file:
 * `content-drafts/<pack>/<kind>/<UTC timestamp>.yaml` (design, "Authoring
 * Aid"). The pack id is used as written; a namespaced id keeps its `/` so the
 * draft lives under a per-pack directory.
 */
export function draftPathFor(pack: string, kind: string, stamp: string): string {
  return `${DRAFT_AREA_SEGMENT}/${pack}/${kind}/${stamp}.yaml`;
}

/**
 * Split the model's returned items into those that validate against the kind's
 * schema and those that do not, keeping the raw invalid items (and their Zod
 * errors) for the sidecar.
 */
function partitionItems(
  items: readonly unknown[],
  schema: ZodType<unknown>,
): { readonly valid: unknown[]; readonly invalid: { item: unknown; errors: unknown }[] } {
  const valid: unknown[] = [];
  const invalid: { item: unknown; errors: unknown }[] = [];
  for (const item of items) {
    const parsed = schema.safeParse(item);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      invalid.push({ item, errors: parsed.error.issues });
    }
  }
  return { valid, invalid };
}

/**
 * Parse the model's raw text into an item list. The model is asked for
 * `{ items: [...] }`, but a model that returns a bare array is accepted too, so
 * a slightly off-shape response still yields items to validate rather than
 * being thrown away whole.
 */
function extractItems(raw: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`content author: model returned invalid JSON: ${detail}`);
  }
  const envelope = ResponseEnvelopeSchema.safeParse(parsed);
  if (envelope.success) {
    return envelope.data.items;
  }
  if (Array.isArray(parsed)) {
    return parsed;
  }
  throw new Error(
    'content author: model response was neither an { items: [...] } object nor an array',
  );
}

/**
 * Run one draft: endpoint check, prompt, model call, validate and write
 * (design, "Authoring Aid"). Returns the paths written and the accepted/
 * rejected counts. Throws on a refused endpoint or a model response that is not
 * JSON at all; a response with some invalid *items* is not an error — the valid
 * items are drafted and the invalid ones land in the sidecar.
 */
export async function runAuthorCore(args: {
  readonly config: AuthoringConfig;
  readonly remoteFlag: boolean;
  readonly packs: readonly ParsedPack[];
  readonly registry: readonly ContentKindRegistration[];
  readonly request: AuthorRequest;
  readonly client: AuthorClient;
  readonly sink: DraftSink;
  readonly clock?: AuthorClock;
}): Promise<AuthorResult> {
  const { config, remoteFlag, packs, registry, request, client, sink } = args;
  const clock = args.clock ?? systemAuthorClock;

  const decision = endpointDecision(config, remoteFlag);
  if (!decision.allowed) {
    throw new Error(`content author: ${decision.reason}`);
  }

  const inputs = collectPromptInputs(packs, request.kind, registry);
  const messages = buildPrompt(request, inputs);
  const promptHash = hashPrompt(messages);

  const raw = await client.complete(
    [
      { role: 'system', content: messages.system },
      { role: 'user', content: messages.user },
    ],
    {
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      jsonSchema: inputs.schema as Record<string, unknown>,
    },
  );

  const returned = extractItems(raw);
  const schema = kindSchema(request.kind, registry);
  const { valid, invalid } = partitionItems(returned, schema);

  const now = clock.now();
  const stamp = draftStamp(now);
  const basePath = draftPathFor(request.pack, request.kind, stamp);

  const result: {
    draftPath?: string;
    rejectedPath?: string;
    accepted: number;
    rejected: number;
    promptHash: string;
  } = { accepted: valid.length, rejected: invalid.length, promptHash };

  if (valid.length > 0) {
    const provenance: Provenance = {
      generated: true,
      model: config.model,
      promptHash,
      generatedAt: now.toISOString(),
    };
    sink.write(basePath, toYaml({ provenance, items: valid }));
    result.draftPath = basePath;
  }

  if (invalid.length > 0) {
    const rejectedPath = `${basePath}.rejected.json`;
    sink.write(
      rejectedPath,
      `${JSON.stringify(
        {
          model: config.model,
          promptHash,
          generatedAt: now.toISOString(),
          rejected: invalid,
        },
        null,
        2,
      )}\n`,
    );
    result.rejectedPath = rejectedPath;
  }

  return result;
}
