/**
 * `config/campaign.yaml` (campaign-career Req 24).
 *
 * The file tunes save location, Review Board thresholds, carry clamps,
 * Notoriety decay, Stress amounts and the archive reveal mode. A bad file is
 * refused as `<file>: <path>: <message>` lines.
 */

import { readFileSync } from 'node:fs';

import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';

import { ReviewWeightsSchema } from './content/schemas.js';

export const ARCHIVE_REVEAL_MODES = ['at-end', 'never'] as const;

export const CampaignConfigSchema = z
  .object({
    savePath: z.string().min(1).default('saves/campaigns'),
    review: z
      .object({
        weights: ReviewWeightsSchema,
        assignmentThreshold: z.number(),
        dismissalFloor: z.number(),
      })
      .strict(),
    carry: z
      .object({
        coverSuspicionK: z.number().min(0),
        tailFrom: z.number().min(0).max(1),
        patternCap: z.number().min(0).max(1),
        maxDoctrineShift: z.number().min(0).max(0.5),
        recogniserSuspicion: z.number().min(0).max(0.5),
        assetTrustDecay: z.number().min(0).max(1),
        handoverBonus: z.number().min(0),
      })
      .strict(),
    notorietyDecay: z.number().min(0).max(1).default(0.1),
    stress: z
      .object({
        burned: z.number(),
        capture: z.number(),
        assetArrested: z.number(),
        leaveRelief: z.number(),
      })
      .strict(),
    capture: z
      .object({
        deathBase: z.number(),
        deathMin: z.number().min(0),
        deathMax: z.number().max(1),
      })
      .strict(),
    mole: z
      .object({
        leak: z.number().min(0).max(1),
        threshold: z.number().int().min(1),
      })
      .strict(),
    eraDoctrineScale: z.number().min(0).max(0.5).default(0.2),
    archiveReveal: z.enum(ARCHIVE_REVEAL_MODES).default('at-end'),
  })
  .strict();
export type CampaignConfig = z.infer<typeof CampaignConfigSchema>;

export interface ConfigIssue {
  readonly file: string;
  readonly path: string;
  readonly message: string;
}

export type ConfigResult =
  | { readonly ok: true; readonly value: CampaignConfig }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] };

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') {
      out += `[${key}]`;
    } else {
      out += out === '' ? String(key) : `.${String(key)}`;
    }
  }
  return out;
}

function issuesFromZod(file: string, error: z.ZodError): ConfigIssue[] {
  return error.issues.map((issue) => ({
    file,
    path: formatPath(issue.path),
    message: issue.message,
  }));
}

/** One `<file>: <path>: <message>` line per issue. */
export function formatCampaignConfigIssues(issues: readonly ConfigIssue[]): string {
  return issues
    .map((issue) =>
      issue.path === ''
        ? `${issue.file}: ${issue.message}`
        : `${issue.file}: ${issue.path}: ${issue.message}`,
    )
    .join('\n');
}

/** Parse and validate campaign config text. `file` labels every issue. */
export function parseCampaignConfig(text: string, file: string): ConfigResult {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (err) {
    const message = err instanceof YAMLParseError ? err.message : String(err);
    return { ok: false, issues: [{ file, path: '', message }] };
  }
  const parsed = CampaignConfigSchema.safeParse(doc);
  if (!parsed.success) {
    return { ok: false, issues: issuesFromZod(file, parsed.error) };
  }
  return { ok: true, value: parsed.data };
}

/** Read `config/campaign.yaml` from disk and validate it. */
export function loadCampaignConfig(path: string): ConfigResult {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, issues: [{ file: path, path: '', message }] };
  }
  return parseCampaignConfig(text, path);
}
