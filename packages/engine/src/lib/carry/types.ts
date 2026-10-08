/**
 * Posting carry-in (campaign-career design, "Posting Context and generator
 * extension"). These shapes live in the engine so a posting can be generated
 * without the campaign package. A campaign `PostingContext` assigns to them.
 */

import type { Persona, MiceProfile } from '../city/npc.js';
import type { Doctrine } from '../hostile/doctrine.js';
import type { Proposition } from '../model/core.js';
import type { NpcId, UnkId } from '../model/core.js';
import type { TemplateHistoryEntry } from '../plotgen/select.js';

export interface CarriedPerson {
  readonly id: string;
  readonly archetype: string;
  readonly name: string;
  readonly persona: Persona;
  readonly descriptor: string;
  readonly allegiance: { readonly true: string; readonly apparent: string };
  readonly mice: MiceProfile;
  readonly loyalty: number;
  readonly securityConsciousness?: number;
  readonly tradecraft?: number;
  readonly status: 'at-large' | 'arrested' | 'dead' | 'turned';
}

export type PlacementRole =
  | 'asset'
  | 'handed-over'
  | 'recogniser'
  | 'nemesis'
  | 'arc'
  | 'hq-visitor';

export interface CarriedPlacement {
  readonly person: CarriedPerson;
  readonly as: PlacementRole;
  readonly trust?: number;
  readonly contact: boolean;
  readonly hostileControlled?: boolean;
  readonly optional: boolean;
  readonly priority: number;
}

export interface ArcClueSpec {
  readonly id: string;
  readonly prop?: Proposition;
}

export interface ArcThreadSpec {
  readonly arc: string;
  readonly template: string;
  readonly bindings: Readonly<Record<string, string>>;
  readonly clues: readonly ArcClueSpec[];
  readonly priority: number;
}

export interface CarryModifiers {
  readonly coverSuspicion: number;
  readonly tailed: boolean;
  readonly doctrineShift: Partial<Doctrine>;
  readonly patternDetection: Readonly<Record<string, number>>;
}

export type RequisitionEffect =
  | { readonly kind: 'budget-credit'; readonly amount: number }
  | { readonly kind: 'extra-player-drop' }
  | { readonly kind: 'trace-priority' }
  | { readonly kind: 'cipher-aid' }
  | { readonly kind: 'prepared-legend' }
  | { readonly kind: 'language-crash-course'; readonly skill: string };

export interface PersonalFileInput {
  readonly title: string;
  readonly body: string;
  readonly asserts: readonly Proposition[];
  /** Persons the file lists, registered as known whether or not they are placed. */
  readonly persons?: readonly string[];
}

export interface CarryIn {
  readonly placements: readonly CarriedPlacement[];
  readonly personalFile: PersonalFileInput;
  readonly arcThreads: readonly ArcThreadSpec[];
  readonly modifiers: CarryModifiers;
  readonly unkPrealloc: readonly {
    readonly ref: string;
    readonly person: string;
    readonly sightings?: readonly { readonly city: string; readonly year: number }[];
  }[];
  readonly requisitions: readonly RequisitionEffect[];
  /** Added to Cover Suspicion when a recogniser's own check hits. Absent means 0. */
  readonly recogniserSuspicion?: number;
}

export interface PlayerHistoryInput {
  readonly templateHistory: readonly TemplateHistoryEntry[];
  readonly context: {
    readonly year: number;
    readonly skills?: Readonly<Record<string, number>>;
    readonly tension?: number;
    readonly epochFlags?: readonly string[];
    readonly rank?: string;
    readonly scaling?: number;
  };
}

export interface PostingContext {
  readonly campaignId: string;
  readonly index: number;
  readonly seed: string;
  readonly city: string;
  readonly service: string;
  readonly year: number;
  readonly tension: number;
  readonly epoch: string;
  readonly epochFlags: readonly string[];
  readonly presetOverrides: Readonly<Record<string, unknown>>;
  readonly scenarioOverrides: Readonly<Record<string, unknown>>;
  readonly legend: { readonly cover: string; readonly name: string; readonly official: boolean };
  readonly carry: CarryIn;
  readonly history: PlayerHistoryInput;
}

/**
 * What a posting added, branded as truth on `WorldState.carry`. The player
 * view does not read it.
 */
export interface CarryState {
  readonly placements: readonly {
    readonly npc: NpcId;
    readonly as: PlacementRole;
    readonly optional: boolean;
    readonly priority: number;
  }[];
  readonly recognisers: readonly NpcId[];
  readonly unk: Readonly<
    Record<
      string,
      {
        readonly unk: UnkId;
        readonly npc: NpcId;
        readonly sightings: readonly { readonly city: string; readonly year: number }[];
      }
    >
  >;
  readonly patternDetection: Readonly<Record<string, number>>;
  readonly requisitions: readonly RequisitionEffect[];
  readonly dropped: readonly string[];
  readonly legendOfficial: boolean;
  readonly recogniserSuspicion: number;
  /** Pre-allocated subjects whose "seen before" line has already been shown. */
  readonly seen: readonly NpcId[];
  /** Fact lines a clock step queued for the action that advanced it. */
  readonly pendingLines: readonly string[];
}

/** The next optional piece to remove when carry verification fails. */
export function nextCarryDrop(
  carry: CarryIn,
  dropped: ReadonlySet<string>,
): string | undefined {
  const optional = carry.placements.filter(
    (placement) => placement.optional && !dropped.has(placement.person.id) && canPlace(placement),
  );
  const recogniser = sortPlacements(optional.filter((placement) => placement.as === 'recogniser'))[0];
  if (recogniser !== undefined) {
    return recogniser.person.id;
  }
  const nemesis = sortPlacements(optional.filter((placement) => placement.as === 'nemesis'))[0];
  if (nemesis !== undefined) {
    return nemesis.person.id;
  }
  const threads = [...carry.arcThreads]
    .filter((thread) => !dropped.has(arcDropId(thread.arc)))
    .sort((a, b) => a.priority - b.priority || (a.arc < b.arc ? -1 : a.arc > b.arc ? 1 : 0));
  return threads[0] === undefined ? undefined : arcDropId(threads[0].arc);
}

export function arcDropId(arc: string): string {
  return `arc:${arc}`;
}

function canPlace(placement: CarriedPlacement): boolean {
  return placement.person.status === 'at-large' || placement.person.status === 'turned';
}

function sortPlacements(placements: readonly CarriedPlacement[]): CarriedPlacement[] {
  return [...placements].sort(
    (a, b) => a.priority - b.priority || (a.person.id < b.person.id ? -1 : a.person.id > b.person.id ? 1 : 0),
  );
}
