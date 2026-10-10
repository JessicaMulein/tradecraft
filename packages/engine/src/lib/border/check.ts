/**
 * Border checks (multi-city task 6.2; Requirement 3).
 *
 * `borderCheck` is pure: one outcome, one suspicion delta, and the phases a
 * secondary inspection or a detention adds. The fact line names only the
 * outcome and the post, never the watch list.
 */

import { revealTruth, type GameTime, type Truth } from '../model/core.js';
import type { Prng } from '../prng/prng.js';
import type { WatchList } from '../region/services.js';
import type { TravelDocument } from '../region/world.js';

export const BORDER_OUTCOMES = ['pass', 'secondary', 'seizure', 'refused', 'detained'] as const;
export type BorderOutcome = (typeof BORDER_OUTCOMES)[number];

/** Lower is a better outcome for the traveller. `refused` sits with the document failures. */
export const BORDER_OUTCOME_RANK: Readonly<Record<BorderOutcome, number>> = {
  pass: 0,
  secondary: 1,
  seizure: 2,
  detained: 3,
  refused: 4,
};

export interface BorderItem {
  readonly id: string;
  readonly kind: string;
  readonly cash?: number;
}

export interface BorderPostInput {
  readonly id: string;
  readonly name: string;
  readonly strictness: number;
  /** Every entry is a required document kind. */
  readonly documents: readonly string[];
}

export interface BorderTraveller {
  readonly identity: string;
  readonly descriptor: string;
  /** False when the cover has no business across this border. */
  readonly coverFits?: boolean;
  /** Set when the traveller is in a car. The street-ops extension then runs the vehicle check. */
  readonly vehicle?: { readonly plate: string };
}

export interface BorderRules {
  readonly watchListSensitivity: number;
  readonly detentionPhases: number;
  readonly contrabandCashThreshold: number;
}

export interface BorderInput {
  readonly post: BorderPostInput;
  readonly at: GameTime;
  readonly traveller: BorderTraveller;
  readonly papers: readonly TravelDocument[];
  readonly items: readonly BorderItem[];
  readonly watch: Truth<WatchList> | WatchList;
  readonly rules: BorderRules;
}

export interface BorderResult {
  readonly outcome: BorderOutcome;
  readonly seized: readonly string[];
  readonly suspicionDelta: number;
  readonly phasesAdded: number;
  readonly detail?: unknown;
}

export interface BorderExtension {
  readonly id: string;
  applies(traveller: BorderTraveller): boolean;
  check(input: BorderInput, rng: Prng): BorderResult;
}

const FACT_LINES: Readonly<Record<BorderOutcome, string>> = {
  pass: 'waves the traveller through',
  secondary: 'holds the traveller for a second look',
  seizure: 'seizes an item from the traveller',
  refused: 'refuses entry',
  detained: 'detains the traveller',
};

/** A fact line that depends only on the outcome and the post's name. */
export function borderFactLine(outcome: BorderOutcome, postName: string): string {
  return `The ${postName} border post ${FACT_LINES[outcome]}.`;
}

function timeAtOrAfter(at: GameTime, bound: GameTime): boolean {
  if (at.day !== bound.day) {
    return at.day > bound.day;
  }
  return at.phase >= bound.phase;
}

function paperCovers(paper: TravelDocument, kind: string, at: GameTime, identity: string): boolean {
  const kindMatches = paper.kind === kind || paper.kind.endsWith(`/${kind}`);
  if (!kindMatches) {
    return false;
  }
  const holderMatches = paper.holder === identity || (paper.holder === 'player' && identity === 'player');
  if (!holderMatches) {
    return false;
  }
  if (paper.valid === undefined) {
    return true;
  }
  return timeAtOrAfter(at, paper.valid.from) && timeAtOrAfter(paper.valid.to, at);
}

function watchOf(watch: Truth<WatchList> | WatchList): WatchList {
  return revealTruth(watch as Truth<WatchList>);
}

function onWatch(watch: WatchList, traveller: BorderTraveller): 'identity' | 'descriptor' | 'none' {
  if (watch.persons.includes(traveller.identity as WatchList['persons'][number])) {
    return 'identity';
  }
  if (watch.descriptors.includes(traveller.descriptor)) {
    return 'descriptor';
  }
  return 'none';
}

function contraband(item: BorderItem, threshold: number): boolean {
  if (item.kind === 'radio' || item.kind === 'cipher' || item.kind === 'seized') {
    return true;
  }
  return item.cash !== undefined && item.cash > threshold;
}

/** True when a required document is missing or out of date. */
export function requiredPapersMissing(input: BorderInput): boolean {
  return input.post.documents.some(
    (kind) => !input.papers.some((paper) => paperCovers(paper, kind, input.at, input.traveller.identity)),
  );
}

/**
 * One border check. A registered extension replaces the four steps and still
 * returns one outcome from the fixed set.
 */
export function borderCheck(
  input: BorderInput,
  rng: Prng,
  extension?: BorderExtension,
): BorderResult {
  if (extension !== undefined && extension.applies(input.traveller)) {
    const extended = extension.check(input, rng);
    return { ...extended, outcome: extended.outcome };
  }
  const watch = watchOf(input.watch);
  const listed = onWatch(watch, input.traveller);
  const missing = requiredPapersMissing(input);
  if (missing) {
    if (listed === 'identity') {
      return detained(input, []);
    }
    return { outcome: 'refused', seized: [], suspicionDelta: 0, phasesAdded: 0 };
  }

  const matched = input.papers.filter((paper) =>
    input.post.documents.length === 0
      || input.post.documents.some((kind) => paperCovers(paper, kind, input.at, input.traveller.identity)),
  );
  const qualities = matched.map((paper) => revealTruth(paper.quality));
  const mean = qualities.length === 0 ? 1 : qualities.reduce((sum, quality) => sum + quality, 0) / qualities.length;
  const watchMatch = listed === 'identity' ? 1 : listed === 'descriptor' ? 0.5 : 0;
  const coverMismatch = input.traveller.coverFits === false ? 0.25 : 0;
  const score =
    input.post.strictness * (1 - mean) +
    watchMatch * input.rules.watchListSensitivity +
    coverMismatch;
  const draw = rng.next();
  if (listed === 'identity' || draw < score * score) {
    return detained(input, []);
  }
  if (draw < score) {
    rng.next();
    const seized = input.items.filter((item) => contraband(item, input.rules.contrabandCashThreshold)).map((item) => item.id);
    if (seized.length > 0) {
      return { outcome: 'seizure', seized, suspicionDelta: 0.2, phasesAdded: 1 };
    }
    return { outcome: 'secondary', seized: [], suspicionDelta: 0, phasesAdded: 1 };
  }
  return { outcome: 'pass', seized: [], suspicionDelta: 0, phasesAdded: 0 };
}

function detained(input: BorderInput, seized: readonly string[]): BorderResult {
  return {
    outcome: 'detained',
    seized,
    suspicionDelta: 0.3,
    phasesAdded: input.rules.detentionPhases,
  };
}
