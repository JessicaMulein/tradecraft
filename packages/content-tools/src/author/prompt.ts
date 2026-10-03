/**
 * Prompt building for the offline Authoring Aid (content-expansion task 5.13;
 * design, "Authoring Aid"; Req 16.6).
 *
 * A draft request is turned into a schema-constrained prompt built from six
 * ingredients (design, "Authoring Aid"):
 *
 * 1. the target kind's JSON Schema (so the model knows the exact shape, and the
 *    endpoint can constrain generation to it);
 * 2. the era Style Guide;
 * 3. the Anachronism Entries whose `earliest` year falls in the pack's Period
 *    Window (the in-period terms to avoid);
 * 4. the Real-Person Blocklist;
 * 5. the Sensitivity Term List;
 * 6. a sample of existing items of that kind (to steer away from duplicates),
 *
 * plus the author's free-text brief. The Style Guide, Anachronism Entries,
 * Real-Person Blocklist and Sensitivity Term List are always included — this is
 * the Req 16.6 contract — so a draft is pushed toward period-correct,
 * non-infringing, in-style content before a human ever reviews it.
 *
 * The ingredients are read from the already-parsed packs (the same files the
 * linter reads), so prompt building touches no filesystem of its own and is a
 * pure function of the parsed packs, the kind, the JSON Schema and the brief.
 */

import { z, type ZodType } from 'zod';
import {
  contentKindJsonSchema,
  CONTENT_KIND_NAMES,
  type ContentKindName,
  type ContentKindRegistration,
  type JsonSchema,
} from '@tradecraft/content';

import { itemsOf, type ParsedPack } from '../lint/parsed-files.js';

/**
 * One Anachronism Entry, as the prompt reads it. The authoritative schema is
 * the Era kind's registration (`anachronisms`); the prompt only needs the
 * fields it filters and shows, so a structural type keeps it decoupled from the
 * `content` internals the registry schema validates.
 */
export interface AnachronismEntry {
  readonly term: string;
  readonly pattern: string;
  readonly earliest: number;
  readonly city?: string;
  readonly note: string;
}

/** One Real-Person Blocklist entry, as the prompt reads it. */
export interface BlocklistEntry {
  readonly name: string;
  readonly familyOnly?: boolean;
  readonly note: string;
}

/** One Sensitivity Term, as the prompt reads it. */
export interface SensitivityTerm {
  readonly term: string;
  readonly pattern: string;
}

/** One Style Guide rule, as the prompt reads it. */
export interface StyleRule {
  readonly id: string;
  readonly appliesTo: readonly string[];
  readonly check: string;
  readonly value?: number | readonly string[];
  readonly message: string;
}

/** The inclusive Period Window the in-period anachronism filter uses. */
export interface PeriodWindow {
  readonly from: number;
  readonly to: number;
}

/** The ingredients gathered from the parsed packs for one draft prompt. */
export interface PromptInputs {
  /** The target kind's JSON Schema (design, "Authoring Aid"). */
  readonly schema: JsonSchema;
  /** The era Style Guide rules (Req 16.6). */
  readonly styleGuide: readonly StyleRule[];
  /** The Anachronism Entries whose `earliest` year is in the Period Window. */
  readonly anachronisms: readonly AnachronismEntry[];
  /** The Real-Person Blocklist (Req 16.6). */
  readonly blocklist: readonly BlocklistEntry[];
  /** The Sensitivity Term List (Req 16.6). */
  readonly sensitivity: readonly SensitivityTerm[];
  /** A sample of existing items of the target kind (to avoid duplicates). */
  readonly samples: readonly unknown[];
  /** The Period Window the anachronism filter used, for the prompt header. */
  readonly period?: PeriodWindow;
}

/** How many existing items to sample into the prompt by default. */
export const DEFAULT_SAMPLE_LIMIT = 8;

/**
 * The JSON Schema for a content kind. A slice kind that `content` exposes
 * through {@link contentKindJsonSchema} uses that memoised schema directly; any
 * other registered kind (an Era, City or Library kind, or a follow-on spec's
 * kind) is converted from its registry Zod schema with `z.toJSONSchema`, the
 * same conversion `contentKindJsonSchema` performs. An unregistered kind is an
 * error — a draft of an unknown kind could never load (Req 17.2).
 */
export function schemaForKind(
  kind: string,
  registry: readonly ContentKindRegistration[],
): JsonSchema {
  if ((CONTENT_KIND_NAMES as readonly string[]).includes(kind)) {
    return contentKindJsonSchema(kind as ContentKindName);
  }
  const reg = registry.find((r) => r.kind === kind);
  if (reg === undefined) {
    throw new Error(
      `content author: unknown kind "${kind}" (not in the Content Kind Registry)`,
    );
  }
  return z.toJSONSchema(reg.schema);
}

/** Whether a pack-relative path belongs to the kind written under `dir`. */
function fileMatchesKind(relPath: string, dir: string): boolean {
  return (
    relPath === `${dir}.yaml` ||
    relPath === `${dir}.yml` ||
    relPath.startsWith(`${dir}/`)
  );
}

/** The registry's Zod schema for a kind, or undefined if it is not registered. */
function registrySchema(
  kind: string,
  registry: readonly ContentKindRegistration[],
): ZodType<unknown> | undefined {
  return registry.find((r) => r.kind === kind)?.schema as ZodType<unknown> | undefined;
}

/** The directory a kind is written under, from the registry (default: the kind). */
function kindDir(kind: string, registry: readonly ContentKindRegistration[]): string {
  return registry.find((r) => r.kind === kind)?.dir ?? kind;
}

/**
 * Collect every item of one era-quality kind across all packs, validated
 * against the kind's registry schema and cast to the prompt's structural view.
 * A kind missing from the registry (a bare fixture with no Era Pack kinds
 * registered) yields nothing.
 */
function collectEraKind<T>(
  packs: readonly ParsedPack[],
  kind: string,
  registry: readonly ContentKindRegistration[],
): T[] {
  const schema = registrySchema(kind, registry);
  if (schema === undefined) {
    return [];
  }
  const dir = kindDir(kind, registry);
  const out: T[] = [];
  for (const pack of packs) {
    for (const file of pack.files) {
      if (!fileMatchesKind(file.relPath, dir)) {
        continue;
      }
      for (const item of itemsOf(file.content).items) {
        const parsed = schema.safeParse(item);
        if (parsed.success) {
          out.push(parsed.data as T);
        }
      }
    }
  }
  return out;
}

/**
 * The Period Window to filter anachronisms by: the one Era record found in the
 * parsed packs. A pack set with no Era Pack (a bare fixture) has no window, so
 * every anachronism is treated as in-period.
 */
export function periodOf(
  packs: readonly ParsedPack[],
  registry: readonly ContentKindRegistration[],
): PeriodWindow | undefined {
  for (const era of collectEraKind<{ period: PeriodWindow }>(packs, 'era', registry)) {
    return { from: era.period.from, to: era.period.to };
  }
  return undefined;
}

/**
 * Gather the prompt ingredients for a draft of `kind` from the parsed packs:
 * the kind's JSON Schema, the era quality lists (Style Guide, in-period
 * Anachronism Entries, Real-Person Blocklist, Sensitivity Term List) and a
 * sample of existing items of that kind. `sampleLimit` caps the samples so a
 * large library does not overflow the context.
 */
export function collectPromptInputs(
  packs: readonly ParsedPack[],
  kind: string,
  registry: readonly ContentKindRegistration[],
  sampleLimit: number = DEFAULT_SAMPLE_LIMIT,
): PromptInputs {
  const reg = registry.find((r) => r.kind === kind);
  const dir = reg?.dir ?? kind;
  const period = periodOf(packs, registry);

  const anachronisms = collectEraKind<AnachronismEntry>(
    packs,
    'anachronisms',
    registry,
  ).filter(
    (entry) =>
      period === undefined ||
      (entry.earliest >= period.from && entry.earliest <= period.to),
  );

  // Sample existing items of the target kind from across the pack set.
  const samples: unknown[] = [];
  for (const pack of packs) {
    for (const file of pack.files) {
      if (!fileMatchesKind(file.relPath, dir)) {
        continue;
      }
      for (const item of itemsOf(file.content).items) {
        samples.push(item);
      }
    }
  }

  return {
    schema: schemaForKind(kind, registry),
    styleGuide: collectEraKind<StyleRule>(packs, 'style-guide', registry),
    anachronisms,
    blocklist: collectEraKind<BlocklistEntry>(packs, 'blocklist', registry),
    sensitivity: collectEraKind<SensitivityTerm>(packs, 'sensitivity', registry),
    samples: samples.slice(0, Math.max(0, sampleLimit)),
    ...(period === undefined ? {} : { period }),
  };
}

/** The parameters a prompt is built for: the kind, the count and the brief. */
export interface PromptRequest {
  readonly kind: string;
  readonly count: number;
  readonly brief?: string;
}

/**
 * A chat message pair for the authoring call: a system message carrying the
 * contract (schema, period and quality lists) and a user message carrying the
 * concrete request (kind, count and brief).
 */
export interface PromptMessages {
  readonly system: string;
  readonly user: string;
}

/** Pretty-print a value as JSON for inclusion in the prompt text. */
function asJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Build the system/user messages for a draft request (Req 16.6). The system
 * message states the task, the exact JSON Schema the items must satisfy, the
 * Period Window, the Style Guide, the in-period Anachronism Entries, the
 * Real-Person Blocklist and the Sensitivity Term List; the user message carries
 * the count, the kind and the author's brief, plus the sampled existing items
 * so the model steers away from duplicates.
 */
export function buildPrompt(
  request: PromptRequest,
  inputs: PromptInputs,
): PromptMessages {
  const periodLine =
    inputs.period === undefined
      ? 'No era Period Window is in force.'
      : `The era Period Window is ${inputs.period.from}–${inputs.period.to}. ` +
        `Every item must be correct for that period.`;

  const system = [
    'You are an offline authoring aid for a historical espionage game. You draft',
    'candidate static content that a human reviews before it is ever loaded. You',
    'invent no real people and no real-world facts beyond verifiable period',
    'texture. All characters and organisations are fictional.',
    '',
    periodLine,
    '',
    'Every item you produce MUST validate against this JSON Schema:',
    asJson(inputs.schema),
    '',
    'Follow this Style Guide:',
    inputs.styleGuide.length === 0
      ? '(none provided)'
      : asJson(inputs.styleGuide),
    '',
    'Do NOT use any of these terms before they are period-correct (Anachronism',
    'Entries in the Period Window):',
    inputs.anachronisms.length === 0 ? '(none)' : asJson(inputs.anachronisms),
    '',
    'Do NOT use any name on this Real-Person Blocklist:',
    inputs.blocklist.length === 0 ? '(none)' : asJson(inputs.blocklist),
    '',
    'Avoid every term on this Sensitivity Term List:',
    inputs.sensitivity.length === 0 ? '(none)' : asJson(inputs.sensitivity),
  ].join('\n');

  const briefLine =
    request.brief === undefined || request.brief.trim() === ''
      ? ''
      : `\n\nAuthor brief: ${request.brief.trim()}`;

  const samplesLine =
    inputs.samples.length === 0
      ? '\n\nThere are no existing items of this kind yet.'
      : '\n\nHere are existing items of this kind — produce new, distinct items ' +
        `that do not duplicate them:\n${asJson(inputs.samples)}`;

  const user =
    `Draft ${request.count} new item(s) of kind "${request.kind}". ` +
    'Return a JSON object with an "items" array of exactly that many items, ' +
    'each conforming to the schema.' +
    briefLine +
    samplesLine;

  return { system, user };
}
