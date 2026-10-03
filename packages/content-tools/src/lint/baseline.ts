/**
 * Loading a Baseline Manifest for the `--baseline` id-stability check (content-
 * expansion task 5.2 wires the loading; CE-IDSTABLE itself lands in task 5.4;
 * data model, `BaselineManifest`; Req 13.7).
 *
 * A Baseline Manifest is a JSON or YAML file holding the Content Manifest a
 * prior pack version produced together with the content ids each pack then
 * held. The linter reads it so CE-IDSTABLE can report an id present in the
 * baseline and missing now (unless the pack's major version increased). This
 * module only parses and validates the file; the comparison is the rule's.
 */

import { readFileSync } from 'node:fs';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import type { BaselineManifest } from './rules.js';

const ManifestEntrySchema = z
  .object({ id: z.string(), version: z.string(), hash: z.string() })
  .strict();

const BaselineSchema = z
  .object({
    manifest: z
      .object({ schema: z.number().int(), packs: z.array(ManifestEntrySchema) })
      .strict(),
    ids: z.record(z.string(), z.array(z.string())),
  })
  .strict();

/** The outcome of loading a baseline file. */
export type BaselineResult =
  | { readonly ok: true; readonly baseline: BaselineManifest }
  | { readonly ok: false; readonly message: string };

/**
 * Read and validate a Baseline Manifest from `path`. Accepts JSON or YAML (both
 * parse through the `yaml` dependency). A read error, a parse error or a schema
 * violation returns a message the CLI reports; a valid file returns the
 * {@link BaselineManifest}.
 */
export function loadBaseline(path: string): BaselineResult {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return { ok: false, message: `cannot read baseline "${path}": ${messageOf(err)}` };
  }

  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (err) {
    return { ok: false, message: `cannot parse baseline "${path}": ${messageOf(err)}` };
  }

  const result = BaselineSchema.safeParse(data);
  if (!result.success) {
    return {
      ok: false,
      message: `invalid baseline "${path}": ${result.error.issues[0]?.message ?? 'schema mismatch'}`,
    };
  }
  return { ok: true, baseline: result.data };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
