/**
 * Campaign API (design, "Campaign API"; Requirements 5.1, 5.3, 7.3, 20.6).
 *
 * The TUI imports this from player-view and never from the campaign package.
 * Campaign Truth stays inside the career state this module holds. Every method
 * the UI calls returns a view, a quote, or a load error.
 */

import { readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import {
  archiveView,
  buildPostingContext,
  campaignView,
  hqStepView,
  knownEnemiesView,
  legendCity,
  loadCampaign,
  nodeSaveIo,
  officerView,
  quoteChoice,
  requiresMedicalLeave,
  saveCampaign,
  step,
  type ArchiveView,
  type CampaignChoice,
  type CampaignConfig,
  type CampaignContent,
  type CampaignError,
  type CampaignLoadError,
  type CampaignState,
  type ChoiceQuote,
  type HqStepView,
  type KnownEnemyView,
  type OfficerView,
  type PostingArchive,
  type PostingContext,
  type PostingResult,
  type RecruitmentWeights,
} from '@tradecraft/campaign';

import type { Result } from '@tradecraft/engine';

import type { EngineApi, TurnChunk, TurnStream } from '../api/types.js';

export type {
  ArchiveView,
  CampaignChoice,
  CampaignError,
  CampaignLoadError,
  ChoiceQuote,
  HqStepView,
  KnownEnemyView,
  OfficerView,
} from '@tradecraft/campaign';

export interface HqOptionView {
  readonly choice: CampaignChoice;
  readonly quote: ChoiceQuote;
}

/** Officer, calendar, current step, and the alerts HQ would show. */
export interface CampaignApiView {
  readonly officer: CampaignState['view']['officer'];
  readonly offers: CampaignState['view']['offers'];
  readonly calendar: CampaignState['calendar'];
  readonly step: CampaignState['step']['kind'];
  readonly alerts: readonly string[];
}

export interface CampaignSaveInfo {
  readonly id: string;
  readonly savedAt: string;
  readonly year: number;
}

export interface CampaignRuntime {
  readonly content: CampaignContent;
  readonly config: CampaignConfig;
  readonly weights: RecruitmentWeights;
  /** Directory whose children are one folder per campaign id. */
  readonly saveRoot: string;
  /** Start the slice game for a posting. An optional snapshot resumes one. */
  startPosting(context: PostingContext, snapshot?: unknown): EngineApi;
  /** Build the Posting Result when the slice reports that the posting ended. */
  finishPosting(api: EngineApi, index: number): PostingResult;
  /** Action log and model recording for the posting that just ended. */
  postingLog?(api: EngineApi): { readonly actions: string; readonly recording: string };
  /** Slice save snapshot to store while a posting is in progress. */
  postingSnapshot?(api: EngineApi): unknown;
}

export interface CampaignApi {
  newCampaign(choice: Extract<CampaignChoice, { kind: 'create' }>): Promise<CampaignApiView>;
  view(): CampaignApiView;
  readonly hq: {
    step(): HqStepView;
    options(): HqOptionView[];
    quote(choice: CampaignChoice): ChoiceQuote;
    choose(choice: CampaignChoice): Result<HqStepView, CampaignError>;
  };
  /** The slice API for the posting in progress, or null during HQ. */
  posting(): EngineApi | null;
  archive(): ArchiveView;
  officer(): OfficerView;
  enemies(): readonly KnownEnemyView[];
  readonly saves: {
    list(): CampaignSaveInfo[];
    save(): Promise<CampaignSaveInfo>;
    load(id: string): Promise<Result<CampaignApiView, CampaignLoadError>>;
  };
}

const DECISIONS = ['handover', 'exfiltrate', 'bring'] as const;

export function createCampaignApi(runtime: CampaignRuntime): CampaignApi {
  let state: CampaignState | undefined;
  let slice: EngineApi | null = null;
  let archives: PostingArchive[] = [];

  function requireState(): CampaignState {
    if (state === undefined) {
      throw new Error('No campaign is open.');
    }
    return state;
  }

  function screen(current: CampaignState): CampaignApiView {
    const alerts: string[] = [];
    if (requiresMedicalLeave(current.view.officer.stress)) {
      alerts.push('Medical leave is required.');
    }
    if (current.step.kind === 'ended') {
      alerts.push('The career has ended.');
    }
    return {
      ...campaignView(current),
      calendar: current.calendar,
      step: current.step.kind,
      alerts,
    };
  }

  function persist(snapshot?: unknown): CampaignSaveInfo {
    const current = requireState();
    const io = nodeSaveIo(campaignDir(runtime.saveRoot, current.id));
    const saved = saveCampaign(io, {
      state: current,
      postings: archives,
      ...(snapshot === undefined ? {} : { currentPosting: snapshot }),
    });
    return { id: current.id, savedAt: saved.savedAt, year: current.calendar.year };
  }

  function openSlice(current: CampaignState, snapshot?: unknown): void {
    if (current.step.kind !== 'posting') {
      slice = null;
      return;
    }
    const offer = current.view.offers.find((row) => row.id === current.view.chosen);
    if (offer === undefined) {
      throw new Error('The posting has no chosen offer.');
    }
    const built = buildPostingContext(current, offer, runtime.content, {
      config: runtime.config,
      weights: runtime.weights,
    });
    if (!built.ok) {
      throw new Error(built.error);
    }
    const started = runtime.startPosting(built.value, snapshot);
    slice = watchEnded(started, () => finishSlice(started));
  }

  function finishSlice(api: EngineApi): void {
    const current = requireState();
    if (current.step.kind !== 'posting') {
      return;
    }
    const index = current.step.ctx.index;
    const result = runtime.finishPosting(api, index);
    const log = runtime.postingLog?.(api) ?? { actions: '', recording: '' };
    const folded = step(
      current,
      { kind: 'posting-result', index, result, actions: log.actions, recording: log.recording },
      runtime.content,
      runtime.config,
    );
    if (!folded.ok) {
      throw new Error(folded.error.reason);
    }
    state = folded.value;
    slice = null;
    archives = [
      ...archives,
      { index, result, actions: log.actions, recording: log.recording },
    ];
    persist();
  }

  return {
    async newCampaign(choice) {
      const created = step(undefined, { kind: 'choice', choice }, runtime.content, runtime.config);
      if (!created.ok) {
        throw new Error(created.error.reason);
      }
      state = created.value;
      slice = null;
      archives = [];
      return screen(created.value);
    },
    view() {
      return screen(requireState());
    },
    hq: {
      step() {
        const current = requireState();
        return hqStepView(current);
      },
      options() {
        const current = requireState();
        return candidates(current, runtime.content).map((choice) => ({
          choice,
          quote: quoteChoice(current, choice, runtime.content),
        }));
      },
      quote(choice) {
        return quoteChoice(requireState(), choice, runtime.content);
      },
      choose(choice) {
        const current = requireState();
        const next = step(current, { kind: 'choice', choice }, runtime.content, runtime.config);
        if (!next.ok) {
          return next;
        }
        if (next.value.step.kind === 'posting') {
          const offer = next.value.view.offers.find((row) => row.id === next.value.view.chosen);
          if (offer === undefined) {
            return { ok: false, error: { kind: 'rejected', reason: 'The posting has no chosen offer.' } };
          }
          const built = buildPostingContext(next.value, offer, runtime.content, {
            config: runtime.config,
            weights: runtime.weights,
          });
          if (!built.ok) {
            return { ok: false, error: { kind: 'rejected', reason: built.error } };
          }
        }
        state = next.value;
        if (state.step.kind === 'posting') {
          openSlice(state);
        } else {
          slice = null;
        }
        return { ok: true, value: hqStepView(state) };
      },
    },
    posting() {
      return slice;
    },
    archive() {
      return archiveView(requireState());
    },
    officer() {
      const current = requireState();
      return officerView({
        officer: current.view.officer,
        carries: current.archive.visible.map((entry) => entry.carry),
      });
    },
    enemies() {
      return knownEnemiesView(requireState());
    },
    saves: {
      list() {
        return listSaves(runtime.saveRoot);
      },
      async save() {
        const snapshot =
          slice === null || runtime.postingSnapshot === undefined
            ? undefined
            : runtime.postingSnapshot(slice);
        return persist(snapshot);
      },
      async load(id) {
        const io = nodeSaveIo(campaignDir(runtime.saveRoot, id));
        const loaded = loadCampaign(io, runtime.content.set.manifest);
        if (!loaded.ok) {
          return loaded;
        }
        let restored: PostingArchive[];
        try {
          restored = readArchives(io);
        } catch {
          return { ok: false, error: { kind: 'unreadable', file: 'postings' } };
        }
        state = loaded.value.state;
        archives = restored;
        slice = null;
        if (state.step.kind === 'posting' && loaded.value.postingRefusal === undefined) {
          openSlice(state, loaded.value.currentPosting);
        }
        return { ok: true, value: screen(state) };
      },
    },
  };
}

function candidates(state: CampaignState, content: CampaignContent): CampaignChoice[] {
  const choices: CampaignChoice[] = [
    { kind: 'advance' },
    { kind: 'leave' },
    { kind: 'retire' },
    { kind: 'defect' },
    { kind: 'decline-end-offer' },
  ];
  for (const offer of state.view.offers) {
    choices.push({ kind: 'accept-offer', offer: offer.id });
  }
  for (const skill of content.skills) {
    choices.push({ kind: 'train', skill: skill.id });
  }
  for (const item of content.requisitions) {
    choices.push({ kind: 'requisition', id: item.id });
  }
  for (const cover of legendCity(state, content).covers) {
    choices.push({ kind: 'legend', cover, name: state.view.officer.name });
  }
  for (const asset of state.view.staged.assets) {
    for (const decision of DECISIONS) {
      choices.push({ kind: 'asset-decision', asset: asset.id, decision });
    }
  }
  for (const figure of state.view.hqCast) {
    choices.push({ kind: 'accuse', figure: figure.id });
  }
  return choices;
}

function watchEnded(api: EngineApi, onEnded: () => void): EngineApi {
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (
        (prop === 'act' || prop === 'say' || prop === 'endScene' || prop === 'retry') &&
        typeof value === 'function'
      ) {
        return (...args: unknown[]) => watch(Reflect.apply(value, target, args) as TurnStream, onEnded);
      }
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}

async function* watch(stream: TurnStream, onEnded: () => void): AsyncGenerator<TurnChunk> {
  for await (const chunk of stream) {
    yield chunk;
    if (chunk.kind === 'ended') {
      onEnded();
    }
  }
}

function campaignDir(root: string, id: string): string {
  const dir = resolve(root, id);
  const base = resolve(root);
  if (dir !== base && !dir.startsWith(base + sep)) {
    throw new Error('Campaign id escapes the save directory.');
  }
  return dir;
}

function listSaves(root: string): CampaignSaveInfo[] {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const listed: CampaignSaveInfo[] = [];
  for (const name of names) {
    const loaded = loadCampaign(nodeSaveIo(join(root, name)));
    if (!loaded.ok) {
      continue;
    }
    listed.push({
      id: loaded.value.state.id,
      savedAt: loaded.value.savedAt,
      year: loaded.value.state.calendar.year,
    });
  }
  return listed.sort((left, right) => left.id.localeCompare(right.id));
}

function readArchives(io: ReturnType<typeof nodeSaveIo>): PostingArchive[] {
  let text: string;
  try {
    text = io.read('campaign.json');
  } catch {
    return [];
  }
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || !('files' in parsed)) {
    return [];
  }
  const files = parsed.files;
  if (!Array.isArray(files)) {
    return [];
  }
  const archives: PostingArchive[] = [];
  for (const file of files) {
    if (file === null || typeof file !== 'object' || !('path' in file) || typeof file.path !== 'string') {
      continue;
    }
    const match = /^postings\/(\d+)\/result\.json$/.exec(file.path);
    if (match === null) {
      continue;
    }
    const index = Number(match[1]);
    archives.push({
      index,
      result: JSON.parse(io.read(file.path)) as PostingResult,
      actions: io.read(`postings/${index}/actions.jsonl`),
      recording: io.read(`postings/${index}/recording.jsonl`),
    });
  }
  return archives.sort((left, right) => left.index - right.index);
}
