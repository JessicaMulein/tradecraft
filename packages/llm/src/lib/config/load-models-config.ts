/**
 * The `models.yaml` loader (Requirements 41.2, 41.3).
 *
 * Reading config is two steps that can each fail: parsing the YAML, then
 * validating it against `ModelsConfigSchema`. Either way the game must refuse
 * to start and tell the developer exactly what is wrong and where, so this
 * loader turns both a YAML syntax error and every Zod issue into a flat list of
 * `ConfigIssue`s, each carrying the file, the dotted field path and a message.
 * `formatConfigIssues` renders them as the `<file>: <field path>: <message>`
 * lines the design calls for.
 *
 * The loader never throws for a validation problem; it returns a discriminated
 * result so the caller decides how to surface the failure. It throws only for a
 * programming error (a schema that is neither parse nor validation failure
 * should be impossible).
 */

import { readFileSync } from 'node:fs';

import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';
import {
  ModelsConfigSchema,
  type ModelsConfig,
} from './models-config.js';

/** A single configuration problem, located to a file and a field path. */
export interface ConfigIssue {
  /** The config file the problem is in, as given to the loader. */
  readonly file: string;
  /**
   * The dotted path to the offending field, for example
   * `profiles.gemma-voice.voice.temperature`. Empty for a problem with the
   * document as a whole, such as a YAML syntax error.
   */
  readonly path: string;
  /** A human-readable description of the problem. */
  readonly message: string;
}

/** The outcome of loading a config file: either the value or the issues. */
export type LoadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] };

/**
 * Render a Zod path (a mix of object keys and array indices) as the dotted
 * string used in `ConfigIssue.path`. Numeric indices are shown in brackets so
 * `profiles.gemma-voice.voice` and an array element `foo[2]` both read
 * naturally.
 */
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

/** Turn a Zod error into the loader's located-issue list for one file. */
function issuesFromZod(file: string, error: z.ZodError): ConfigIssue[] {
  return error.issues.map((issue) => ({
    file,
    path: formatPath(issue.path),
    message: issue.message,
  }));
}

/**
 * Parse and validate a `models.yaml` document given its text. Separated from
 * disk access so it is trivially testable with an inline string. `file` is used
 * only to label issues.
 */
export function parseModelsConfig(
  text: string,
  file: string,
): LoadResult<ModelsConfig> {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (err) {
    const message =
      err instanceof YAMLParseError ? err.message : String(err);
    return { ok: false, issues: [{ file, path: '', message }] };
  }

  const result = ModelsConfigSchema.safeParse(doc);
  if (!result.success) {
    return { ok: false, issues: issuesFromZod(file, result.error) };
  }
  return { ok: true, value: result.data };
}

/**
 * Load, parse and validate `models.yaml` from disk at `path`. A read failure
 * (missing or unreadable file) is reported as a document-level issue so the
 * caller handles it uniformly with parse and validation failures. `path` is
 * used both to read and to label issues.
 */
export function loadModelsConfig(path: string): LoadResult<ModelsConfig> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    return { ok: false, issues: [{ file: path, path: '', message }] };
  }
  return parseModelsConfig(text, path);
}

/**
 * Render loaded issues as one `<file>: <field path>: <message>` line each. A
 * document-level issue (empty path) collapses to `<file>: <message>` so the
 * output never shows a dangling separator.
 */
export function formatConfigIssues(
  issues: readonly ConfigIssue[],
): string {
  return issues
    .map((i) =>
      i.path === ''
        ? `${i.file}: ${i.message}`
        : `${i.file}: ${i.path}: ${i.message}`,
    )
    .join('\n');
}
