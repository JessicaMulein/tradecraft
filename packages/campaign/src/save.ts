/**
 * Campaign Save (design, "Campaign save and migrations"; Requirements 5.5,
 * 23.1, 23.2, 23.5, 23.7).
 *
 * A campaign is a directory. Completed postings are written first, then the
 * in-progress snapshot to a temp file. `campaign.json` is written to a temp
 * file, fsynced, and renamed into place only after those bytes are durable.
 * An interrupted commit leaves the previous `campaign.json` and the files it
 * hashes untouched.
 */

import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import type { ContentManifest } from '@tradecraft/content';
import { z, type ZodType } from 'zod';

import type { CampaignState } from './state.js';

/** Schema of `campaign.json`. Schema 1 ships with an empty migration table. */
export const CAMPAIGN_SAVE_VERSION = 1;

export interface CampaignFileHash {
  readonly path: string;
  readonly sha256: string;
}

export interface CampaignSaveDocument {
  readonly version: number;
  readonly savedAt: string;
  readonly state: CampaignState;
  readonly files: readonly CampaignFileHash[];
}

/** One finished posting's archive files under `postings/<index>/`. */
export interface PostingArchive {
  readonly index: number;
  readonly result: unknown;
  readonly actions: string;
  readonly recording: string;
}

export interface SaveCampaignInput {
  readonly state: CampaignState;
  /** Finished postings. Files already stored with the same bytes are left in place. */
  readonly postings?: readonly PostingArchive[];
  /** Slice save snapshot while a posting is in progress. Omitted when none is. */
  readonly currentPosting?: unknown;
  readonly savedAt?: string;
}

export interface ManifestDifference {
  readonly id: string;
  readonly saved?: string;
  readonly loaded?: string;
}

export type CampaignLoadError =
  | { readonly kind: 'campaign-version'; readonly saved: number; readonly supported: number }
  | { readonly kind: 'migration-failed'; readonly from: number; readonly issues: readonly string[] }
  | { readonly kind: 'hash-mismatch'; readonly file: string }
  | { readonly kind: 'unreadable'; readonly file: string };

/** One step from schema `from` to the next. The shipped table is empty at schema 1. */
export interface CampaignMigration {
  readonly from: ZodType;
  readonly to: ZodType;
  readonly up: (save: unknown) => unknown;
}

/**
 * Version *n* maps to the migration that produces *n + 1*.
 * Schema 1 has no predecessors, so this table is empty.
 */
export const migrations: Readonly<Record<number, CampaignMigration>> = {};

/** Envelope of a schema-1 campaign save. Unknown fields are kept, so a current save stays intact. */
const campaignSaveSchema = z.looseObject({
  version: z.number().int(),
  savedAt: z.string(),
  state: z.looseObject({}),
  files: z.array(z.looseObject({ path: z.string(), sha256: z.string() })),
});

export interface LoadedCampaign {
  readonly state: CampaignState;
  readonly savedAt: string;
  /** Set when `current-posting.json` matches the loaded manifest. */
  readonly currentPosting?: unknown;
  /**
   * The campaign state was restored, and the in-progress posting was not.
   * `differing` names each pack whose version does not match (Req 23.5).
   */
  readonly postingRefusal?: {
    readonly kind: 'manifest-mismatch';
    readonly differing: readonly ManifestDifference[];
  };
}

/** The file operations a save performs, in order, so a test can fail one of them. */
export interface CampaignSaveIo {
  write(path: string, data: string): void;
  fsync(path: string): void;
  read(path: string): string;
  exists(path: string): boolean;
  /** Renames each pair, in order. A failure before this call leaves the previous save in place. */
  commit(ops: readonly { readonly from: string; readonly to: string }[]): void;
}

const CURRENT = 'current-posting.json';
const CURRENT_TMP = 'current-posting.json.tmp';
const CAMPAIGN = 'campaign.json';
const CAMPAIGN_TMP = 'campaign.json.tmp';

export function nodeSaveIo(root: string): CampaignSaveIo {
  const full = (path: string): string => join(root, path);
  return {
    write(path, data) {
      const target = full(path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
    },
    fsync(path) {
      const fd = openSync(full(path), 'r');
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    },
    read(path) {
      return readFileSync(full(path), 'utf8');
    },
    exists(path) {
      return existsSync(full(path));
    },
    commit(ops) {
      for (const op of ops) {
        renameSync(full(op.from), full(op.to));
      }
    },
  };
}

export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Write the directory. Archive files go down first. `campaign.json` is
 * replaced only in `commit`, after its temp file has been fsynced.
 */
export function saveCampaign(io: CampaignSaveIo, input: SaveCampaignInput): CampaignSaveDocument {
  const staged: StagedFile[] = [];
  for (const posting of [...(input.postings ?? [])].sort((left, right) => left.index - right.index)) {
    const dir = `postings/${posting.index}`;
    staged.push(store(io, `${dir}/result.json`, `${JSON.stringify(posting.result)}\n`));
    staged.push(store(io, `${dir}/actions.jsonl`, posting.actions));
    staged.push(store(io, `${dir}/recording.jsonl`, posting.recording));
  }
  const commit: { from: string; to: string }[] = [];
  for (const file of staged) {
    if (file.staged !== undefined) {
      io.fsync(file.staged);
      commit.push({ from: file.staged, to: file.path });
    }
  }
  if (input.currentPosting !== undefined) {
    const body = `${JSON.stringify(input.currentPosting)}\n`;
    io.write(CURRENT_TMP, body);
    staged.push({ path: CURRENT, sha256: sha256(body) });
    commit.push({ from: CURRENT_TMP, to: CURRENT });
  }
  const document: CampaignSaveDocument = {
    version: CAMPAIGN_SAVE_VERSION,
    savedAt: input.savedAt ?? new Date().toISOString(),
    state: input.state,
    files: staged
      .map((file) => ({ path: file.path, sha256: file.sha256 }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  const json = `${JSON.stringify(document)}\n`;
  io.write(CAMPAIGN_TMP, json);
  if (input.currentPosting !== undefined) {
    io.fsync(CURRENT_TMP);
  }
  io.fsync(CAMPAIGN_TMP);
  commit.push({ from: CAMPAIGN_TMP, to: CAMPAIGN });
  io.commit(commit);
  return document;
}

/**
 * Restore a campaign directory. A bad hash or an unsupported version returns
 * an error and no state. A manifest mismatch restores the state and refuses
 * the in-progress posting.
 */
export function loadCampaign(
  io: CampaignSaveIo,
  loadedManifest?: ContentManifest,
): { readonly ok: true; readonly value: LoadedCampaign } | { readonly ok: false; readonly error: CampaignLoadError } {
  let text: string;
  try {
    text = io.read(CAMPAIGN);
  } catch {
    return { ok: false, error: { kind: 'unreadable', file: CAMPAIGN } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: { kind: 'unreadable', file: CAMPAIGN } };
  }
  if (parsed === null || typeof parsed !== 'object' || !('version' in parsed)) {
    return { ok: false, error: { kind: 'unreadable', file: CAMPAIGN } };
  }
  const version = parsed.version;
  if (typeof version !== 'number') {
    return { ok: false, error: { kind: 'unreadable', file: CAMPAIGN } };
  }
  const migrated = migrate(parsed);
  if (!migrated.ok) {
    return migrated;
  }
  const document = migrated.value;
  if (!Array.isArray(document.files) || document.state === null || typeof document.state !== 'object') {
    return { ok: false, error: { kind: 'unreadable', file: CAMPAIGN } };
  }
  for (const file of document.files) {
    let body: string;
    try {
      body = io.read(file.path);
    } catch {
      return { ok: false, error: { kind: 'hash-mismatch', file: file.path } };
    }
    if (sha256(body) !== file.sha256) {
      return { ok: false, error: { kind: 'hash-mismatch', file: file.path } };
    }
  }
  const current = document.files.find((file) => file.path === CURRENT);
  if (current === undefined) {
    return { ok: true, value: { state: document.state, savedAt: document.savedAt } };
  }
  const snapshot = JSON.parse(io.read(CURRENT)) as unknown;
  const savedManifest = manifestOf(snapshot);
  if (loadedManifest !== undefined && savedManifest !== undefined) {
    const differing = diffManifests(savedManifest, loadedManifest);
    if (differing.length > 0) {
      return {
        ok: true,
        value: { state: document.state, savedAt: document.savedAt, postingRefusal: { kind: 'manifest-mismatch', differing } },
      };
    }
  }
  return { ok: true, value: { state: document.state, savedAt: document.savedAt, currentPosting: snapshot } };
}

interface StagedFile extends CampaignFileHash {
  readonly staged?: string;
}

/**
 * A new archive file can be written in place: the previous `campaign.json`
 * does not hash it. A changed one is staged beside it and renamed only when
 * the new manifest commits, so a failed save cannot break the previous hashes.
 */
function store(io: CampaignSaveIo, path: string, data: string): StagedFile {
  const digest = sha256(data);
  if (io.exists(path)) {
    if (io.read(path) === data) {
      return { path, sha256: digest };
    }
    const staged = `${path}.tmp`;
    io.write(staged, data);
    return { path, sha256: digest, staged };
  }
  io.write(path, data);
  return { path, sha256: digest };
}

function manifestOf(snapshot: unknown): ContentManifest | undefined {
  if (snapshot === null || typeof snapshot !== 'object' || !('content' in snapshot)) {
    return undefined;
  }
  const content = snapshot.content;
  if (content === null || typeof content !== 'object' || !('packs' in content)) {
    return undefined;
  }
  const packs = content.packs;
  if (!Array.isArray(packs)) {
    return undefined;
  }
  return content as ContentManifest;
}

function diffManifests(saved: ContentManifest, loaded: ContentManifest): ManifestDifference[] {
  const savedById = new Map(saved.packs.map((pack) => [pack.id, pack]));
  const loadedById = new Map(loaded.packs.map((pack) => [pack.id, pack]));
  const ids = [...new Set([...savedById.keys(), ...loadedById.keys()])].sort();
  const differing: ManifestDifference[] = [];
  for (const id of ids) {
    const left = savedById.get(id);
    const right = loadedById.get(id);
    if (left !== undefined && right !== undefined && left.version === right.version && left.hash === right.hash) {
      continue;
    }
    differing.push({ id, saved: left?.version, loaded: right?.version });
  }
  return differing;
}

type MigrationResult =
  | { readonly ok: true; readonly value: CampaignSaveDocument }
  | { readonly ok: false; readonly error: CampaignLoadError };

/**
 * Bring a campaign save up to `current`. The shipped table is empty, so a
 * schema-1 save is checked and returned unchanged. An older save runs each
 * `up` in order, validated with `from` before the step and `to` after it.
 * A newer version or a failed step returns an error. The input is never mutated.
 */
export function migrate(
  raw: unknown,
  current: number = CAMPAIGN_SAVE_VERSION,
  table: Readonly<Record<number, CampaignMigration>> = migrations,
): MigrationResult {
  const version = documentVersion(raw);
  if (version === undefined) {
    return { ok: false, error: { kind: 'unreadable', file: CAMPAIGN } };
  }
  if (version > current) {
    return { ok: false, error: { kind: 'campaign-version', saved: version, supported: current } };
  }
  let value: unknown;
  try {
    value = structuredClone(raw);
  } catch {
    return { ok: false, error: { kind: 'unreadable', file: CAMPAIGN } };
  }
  if (version === current) {
    return acceptCurrent(value, current, table);
  }
  let at = version;
  while (at < current) {
    const step = table[at];
    if (step === undefined) {
      return { ok: false, error: { kind: 'migration-failed', from: at, issues: ['missing migration'] } };
    }
    const before = step.from.safeParse(value);
    if (!before.success) {
      return { ok: false, error: { kind: 'migration-failed', from: at, issues: issuePaths(before.error) } };
    }
    let produced: unknown;
    try {
      produced = step.up(structuredClone(value));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'migration failed';
      return { ok: false, error: { kind: 'migration-failed', from: at, issues: [message] } };
    }
    const after = step.to.safeParse(produced);
    if (!after.success) {
      return { ok: false, error: { kind: 'migration-failed', from: at, issues: issuePaths(after.error) } };
    }
    const next = documentVersion(produced);
    if (next !== at + 1) {
      return { ok: false, error: { kind: 'migration-failed', from: at, issues: ['version'] } };
    }
    value = produced;
    at = next;
  }
  return { ok: true, value: value as CampaignSaveDocument };
}

function acceptCurrent(
  value: unknown,
  current: number,
  table: Readonly<Record<number, CampaignMigration>>,
): MigrationResult {
  const schema = schemaFor(current, table);
  if (schema === undefined) {
    return { ok: false, error: { kind: 'migration-failed', from: current, issues: ['missing migration'] } };
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: { kind: 'migration-failed', from: current, issues: issuePaths(parsed.error) } };
  }
  return { ok: true, value: value as CampaignSaveDocument };
}

function schemaFor(
  current: number,
  table: Readonly<Record<number, CampaignMigration>>,
): ZodType | undefined {
  const previous = table[current - 1];
  if (previous !== undefined) {
    return previous.to;
  }
  if (current === CAMPAIGN_SAVE_VERSION) {
    return campaignSaveSchema;
  }
  return undefined;
}

function documentVersion(value: unknown): number | undefined {
  if (value === null || typeof value !== 'object' || !('version' in value)) {
    return undefined;
  }
  const version = value.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return undefined;
  }
  return version;
}

function issuePaths(error: z.ZodError): string[] {
  return error.issues.map((issue) => issue.path.map((part) => String(part)).join('.'));
}
