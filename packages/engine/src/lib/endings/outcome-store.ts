/**
 * Writing an Outcome Record to disk (design, "Outcome Record": "written to
 * `saves/outcomes/<seed>-<endedAt>.json` after Zod validation"; Requirements
 * 35.1, 35.3). Task 20.3.
 *
 * This module is the thin filesystem seam, kept apart from the pure derivation
 * ({@link import('./build-outcome-record.js').buildOutcomeRecord}) so the
 * derivation stays testable with no disk (task 20.5). It validates a record
 * against the versioned schema *before* writing (Req 35.3 — the Sim validates
 * before writing), creates the target directory if it is missing, and writes one
 * pretty-printed JSON file per game.
 *
 * The engine already touches `node:fs` for the scenario-config loader
 * (`config/load-scenario-config.ts`), so a synchronous, best-effort file write
 * here is consistent with the package. The write is synchronous because it
 * happens exactly once, at game end, off the turn path — there is no stream to
 * keep flowing.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  OutcomeRecordSchema,
  type OutcomeRecord,
} from './outcome-record.js';

/**
 * The default directory Outcome Records are written to, relative to the process
 * working directory (design: `saves/outcomes/`). Callers that keep saves
 * elsewhere pass an absolute directory to {@link writeOutcomeRecord}.
 */
export const DEFAULT_OUTCOMES_DIR = join('saves', 'outcomes');

/**
 * The file name for an Outcome Record (design: `<seed>-<endedAt>.json`). The
 * seed and the end time together name one game uniquely; the end time is
 * flattened to `d<day>p<phase>` so the name is a safe, stable filename on every
 * platform (no colons or spaces). The seed is sanitised the same way, so an
 * unusual seed string cannot escape the directory or produce an invalid name.
 */
export function outcomeFileName(record: OutcomeRecord): string {
  const seed = sanitise(record.seed);
  const at = `d${record.endedAt.day}p${record.endedAt.phase}`;
  return `${seed}-${at}.json`;
}

/**
 * Write an {@link OutcomeRecord} to `dir` (default {@link DEFAULT_OUTCOMES_DIR}),
 * one JSON file per game (Req 35.1, 35.3). It:
 *
 * 1. **validates** the record against {@link OutcomeRecordSchema} and throws a
 *    {@link import('zod').ZodError} if it is malformed — nothing invalid is ever
 *    written (Req 35.3);
 * 2. **creates** the directory (and any missing parents) if it does not exist;
 * 3. **writes** the record as pretty-printed JSON (so a human can read the file)
 *    to `dir/<seed>-<endedAt>.json`.
 *
 * Returns the full path written. The write is synchronous — it runs once, at
 * game end — and surfaces any IO error to the caller rather than swallowing it:
 * unlike a best-effort metrics line, a lost Outcome Record is a failure a
 * campaign layer would want to know about.
 *
 * @param record the record to persist (validated before writing).
 * @param dir    the target directory (default `saves/outcomes/`).
 */
export function writeOutcomeRecord(
  record: OutcomeRecord,
  dir: string = DEFAULT_OUTCOMES_DIR,
): string {
  // 1. Validate before writing (Req 35.3). A malformed record throws here.
  const validated = OutcomeRecordSchema.parse(record);
  // 2. Ensure the directory exists (create missing parents).
  mkdirSync(dir, { recursive: true });
  // 3. Write one pretty-printed JSON file per game.
  const path = join(dir, outcomeFileName(validated));
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  return path;
}

/**
 * Make a string safe to use as a filename component: keep letters, digits,
 * `.`, `_` and `-`; replace every other character (path separators, colons,
 * spaces) with `-`. Keeps a seed or id from escaping the directory or producing
 * an invalid name on any platform.
 */
function sanitise(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, '-');
  return cleaned.length > 0 ? cleaned : 'game';
}
