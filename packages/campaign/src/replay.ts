/**
 * Campaign replay (design, "Campaign reducer"; Requirements 2.3, 2.4).
 *
 * The choice log is folded with `step`. Each posting entry is rebuilt by
 * `postingResult`, which replays that posting's action log through the slice
 * `ReplayGateway` against its recording, and the rebuilt Posting Result is
 * kept only when its hash matches the log.
 */

import { createHash } from 'node:crypto';

import { canonicalJson, type ContentManifest } from '@tradecraft/content';

import { carryOver } from './carry-over.js';
import type { CampaignConfig } from './config.js';
import type { CampaignContent } from './content/library.js';
import { step } from './reducer.js';
import type { CampaignLogEntry, CampaignState, PostingResult } from './state.js';

export type PostingLogEntry = Extract<CampaignLogEntry, { kind: 'posting' }>;

/** SHA-256 of the Posting Result in canonical JSON. This is the logged `resultHash`. */
export function postingResultHash(result: PostingResult): string {
  return createHash('sha256').update(canonicalJson(result)).digest('hex');
}

export class ReplayFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayFailed';
  }
}

/**
 * Fold `log` from the campaign seed. `content` loads the manifest in force.
 * `postingResult` rebuilds one posting, ReplayGateway and all, from its log entry.
 * A rejected choice, a hash mismatch, or an invalid result throws and yields no state.
 */
export function replayCampaign(
  seed: string,
  log: readonly CampaignLogEntry[],
  content: (manifest: ContentManifest) => CampaignContent,
  postingResult: (entry: PostingLogEntry) => PostingResult,
  options: { readonly manifest: ContentManifest; readonly config: CampaignConfig },
): CampaignState {
  if (log.length === 0) {
    throw new ReplayFailed('The campaign log is empty.');
  }
  let manifest = options.manifest;
  let state: CampaignState | undefined;
  for (const entry of log) {
    if (entry.kind === 'choice') {
      state = foldChoice(state, entry, seed, content(manifest));
      if (entry.choice.kind === 'adopt-manifest') {
        manifest = entry.choice.manifest;
      }
      continue;
    }
    state = foldPosting(state, entry, content(manifest), postingResult, options.config);
  }
  if (state === undefined || state.seed !== seed) {
    throw new ReplayFailed('Campaign seed does not match the log.');
  }
  return state;
}

function foldChoice(
  state: CampaignState | undefined,
  entry: Extract<CampaignLogEntry, { kind: 'choice' }>,
  seed: string,
  loaded: CampaignContent,
): CampaignState {
  if (entry.choice.kind === 'create' && entry.choice.seed !== seed) {
    throw new ReplayFailed('Campaign seed does not match the log.');
  }
  const next = step(state, { kind: 'choice', choice: entry.choice }, loaded);
  if (!next.ok) {
    throw new ReplayFailed(`Log entry ${entry.seq} was rejected: ${next.error.reason}`);
  }
  const appended = next.value.log[next.value.log.length - 1];
  if (
    appended === undefined ||
    appended.kind !== 'choice' ||
    appended.seq !== entry.seq ||
    JSON.stringify(appended.choice) !== JSON.stringify(entry.choice)
  ) {
    throw new ReplayFailed(`Log entry ${entry.seq} did not replay.`);
  }
  return next.value;
}

function foldPosting(
  state: CampaignState | undefined,
  entry: PostingLogEntry,
  loaded: CampaignContent,
  postingResult: (entry: PostingLogEntry) => PostingResult,
  config: CampaignConfig,
): CampaignState {
  if (state === undefined || state.step.kind !== 'posting') {
    throw new ReplayFailed(`Posting ${entry.index} is not in progress.`);
  }
  if (state.step.ctx.index !== entry.index || state.step.ctx.seed !== entry.seed) {
    throw new ReplayFailed(`Posting ${entry.index} does not match the campaign.`);
  }
  const result = postingResult(entry);
  if (result.index !== entry.index) {
    throw new ReplayFailed(`Posting ${entry.index} was rebuilt as ${result.index}.`);
  }
  if (postingResultHash(result) !== entry.resultHash) {
    throw new ReplayFailed(`Posting ${entry.index} result hash does not match.`);
  }
  const folded = carryOver(state, result, loaded, config);
  if (!folded.ok) {
    throw new ReplayFailed(`Posting ${entry.index} result is invalid.`);
  }
  return { ...folded.value, log: [...folded.value.log, entry] };
}
