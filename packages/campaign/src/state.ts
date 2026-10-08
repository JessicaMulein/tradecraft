/**
 * Campaign state (design, "Data models"; Requirements 2.1, 2.2, 7.1).
 *
 * Ground truth — allegiances, hostile control, the HQ mole, dossiers, arc
 * bindings — lives only inside `truth`. `view` and `archive.visible` are what
 * an HQ screen may render. This module does not import player-view or tui.
 * The debrief stored in truth is a plain snapshot, not the player-view type.
 */

import type { ContentManifest } from '@tradecraft/content';
import type {
  AdmiraltyGrade,
  Alias,
  Channel,
  DifficultyPreset,
  GameTime,
  HostileDoctrine,
  MiceLever,
  Npc,
  NpcId,
  OutcomeRecord,
  PrngState,
  Proposition,
  Relationship,
  ScenarioConfig,
  Truth,
} from '@tradecraft/engine';

import type { RankId, Requisition } from './content/schemas.js';

/** Stable id of one person the campaign minted (`cp-n`). */
export type CampaignPersonId = `cp-${number}`;

/** Stable id of one legend (`lg-n`). */
export type LegendId = `lg-${number}`;

export type SkillId = string;
export type TraitId = string;
export type FactionId = string;
export type BackgroundId = string;
export type CityPackId = string;
export type ServiceId = string;
export type CoverIdentityId = string;
export type OfferId = string;
export type DirectiveThemeId = string;
export type RequisitionId = string;
export type ArcId = string;
export type EpochId = string;
export type ClueId = string;
export type PlotTemplateId = string;
export type ThreadTemplateId = string;
export type ArchetypeId = string;
export type LocationTypeId = string;

/** A player-facing token for an unidentified subject. Not a truth id. */
export type CampaignUnkRef = string;

/** An organisation or service reference carried between postings. */
export type OrgOrServiceRef = string;

export type Rank = RankId;

export type SkillLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type RequisitionEffect = Requisition['effect'];

export type DeepPartial<T> = {
  readonly [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export type HqStep = {
  readonly kind:
    | 'creation'
    | 'offers'
    | 'prepare'
    | 'debrief'
    | 'review'
    | 'capture'
    | 'assets'
    | 'arcs'
    | 'end-offers';
};

/** Enough to rebuild a posting; the world seed is `postingSeed(campaignSeed, index)`. */
export interface PostingContextRef {
  readonly index: number;
  readonly seed: string;
}

export type CampaignStep =
  | HqStep
  | { readonly kind: 'posting'; readonly ctx: PostingContextRef }
  | { readonly kind: 'ended'; readonly end: CampaignEnd };

export interface OfficerLegend {
  readonly id: LegendId;
  readonly cover: CoverIdentityId;
  readonly name: string;
  readonly official: boolean;
  readonly posting: number;
  /** Services that saw this legend burn. The true burn set is in the dossiers. */
  readonly observedBurnedBy: readonly ServiceId[];
}

export interface Officer {
  readonly name: string;
  readonly background: BackgroundId;
  readonly rank: Rank;
  readonly skills: Readonly<
    Record<SkillId, { readonly level: SkillLevel; readonly xp: number }>
  >;
  readonly traits: readonly TraitId[];
  readonly stress: number;
  readonly reprimands: number;
  readonly legends: readonly OfficerLegend[];
  readonly careerStanding: number;
  readonly careerPoints: number;
  readonly factions: Readonly<Record<FactionId, number>>;
}

/** An asset as the player may see it. Hostile control is not on this shape. */
export interface CarriedAssetView {
  readonly id: CampaignPersonId;
  readonly name: string;
  readonly apparentAffiliation?: string;
  readonly rapport: string;
  readonly history: string;
}

export interface PostingOffer {
  readonly id: OfferId;
  readonly city: CityPackId;
  readonly service: ServiceId;
  readonly year: number;
  readonly tourYears: 1 | 2 | 3;
  readonly tier: 'quiet' | 'standard' | 'hot';
  readonly theme: DirectiveThemeId;
  readonly assigned: boolean;
}

export interface ReviewOutcomeView {
  readonly score: number;
  readonly decision: 'promote' | 'hold' | 'demote' | 'reprimand' | 'dismiss';
  readonly text: string;
}

export type CaptureView =
  | {
      readonly kind: 'exchange' | 'imprisonment';
      readonly yearsLost: number;
      readonly defectionOffer: boolean;
    }
  | { readonly kind: 'death' };

export interface HqCastView {
  readonly id: CampaignPersonId;
  readonly name: string;
  readonly faction: FactionId;
  readonly role: string;
}

/** An arc as the HQ screen may show it: stage id and status, no bindings. */
export interface ArcView {
  readonly id: ArcId;
  readonly stage: string;
  readonly status: 'active' | 'resolved';
}

export interface CampaignView {
  readonly officer: Officer;
  readonly offers: readonly PostingOffer[];
  readonly chosen?: OfferId;
  readonly pendingRequisitions: readonly RequisitionId[];
  /** Training and leave choices already spent this HQ phase. Two slots in all. */
  readonly trainingUsed?: number;
  /** Set when the officer accepts retirement or defection. `endTrigger` reads it. */
  readonly acceptedEnd?: 'retire' | 'defect';
  readonly staged: {
    readonly review?: ReviewOutcomeView;
    readonly assets: readonly CarriedAssetView[];
    readonly capture?: CaptureView;
    readonly endOffers: readonly ('retire' | 'defect')[];
    /** The accusation cable. It names only the accused officer. */
    readonly accusation?: { readonly text: string };
  };
  readonly hqCast: readonly HqCastView[];
  readonly arcs: readonly ArcView[];
  readonly unk: Readonly<
    Record<
      CampaignUnkRef,
      {
        readonly descriptor: string;
        readonly sightings: readonly { readonly city: CityPackId; readonly year: number }[];
      }
    >
  >;
}

export interface CarriedNpc {
  readonly id: CampaignPersonId;
  readonly archetype: ArchetypeId;
  readonly name: string;
  readonly aliases: readonly Alias[];
  readonly persona: Npc['persona'];
  readonly descriptor: string;
  readonly allegiance: {
    readonly true: OrgOrServiceRef;
    readonly apparent: OrgOrServiceRef;
  };
  readonly mice: Npc['mice'];
  readonly loyalty: number;
  readonly service?: ServiceId;
  readonly rank?: number;
  /** Doctrine skills. A nemesis raises both by a tenth, capped at 0.9. Absent means 0. */
  readonly securityConsciousness?: number;
  readonly tradecraft?: number;
  readonly status: 'at-large' | 'arrested' | 'dead' | 'turned';
  readonly seen: readonly { readonly posting: number; readonly city: CityPackId }[];
}

export interface CarriedAsset {
  readonly person: CarriedNpc;
  readonly trust: number;
  readonly exposure: number;
  readonly reliability: number;
  readonly hostileControlled: boolean;
  readonly turned: boolean;
  readonly lever: MiceLever;
  readonly city: CityPackId;
  readonly leftYear: number;
}

export interface CarryModifiers {
  readonly coverSuspicion: number;
  readonly tailed: boolean;
  readonly doctrineShift: Partial<HostileDoctrine>;
  readonly patternDetection: Readonly<Record<string, number>>;
}

/** Built from Player Carry only. Placement does not change what it asserts. */
export interface PersonalFileSpec {
  readonly title: string;
  readonly body: string;
  readonly asserts: readonly Proposition[];
  /** Persons the file lists, registered as known whether or not they are placed. */
  readonly persons: readonly string[];
}

export interface CarryIn {
  readonly placements: readonly {
    readonly person: CarriedNpc;
    readonly as: 'asset' | 'handed-over' | 'recogniser' | 'nemesis' | 'arc' | 'hq-visitor';
    readonly trust?: number;
    readonly contact: boolean;
    readonly hostileControlled?: boolean;
    readonly optional: boolean;
    readonly priority: number;
  }[];
  readonly personalFile: PersonalFileSpec;
  readonly arcThreads: readonly {
    readonly arc: ArcId;
    readonly template: ThreadTemplateId;
    readonly bindings: Readonly<Record<string, CampaignPersonId>>;
    readonly clues: readonly { readonly id: ClueId; readonly prop?: Proposition }[];
    readonly priority: number;
  }[];
  readonly modifiers: CarryModifiers;
  readonly unkPrealloc: readonly {
    readonly ref: CampaignUnkRef;
    readonly person: CampaignPersonId;
    readonly sightings?: readonly { readonly city: CityPackId; readonly year: number }[];
  }[];
  readonly requisitions: readonly RequisitionEffect[];
  /** The campaign config amount a recogniser hit adds to Cover Suspicion. */
  readonly recogniserSuspicion?: number;
}

export interface PostingContext {
  readonly campaignId: string;
  readonly index: number;
  readonly seed: string;
  readonly city: CityPackId;
  readonly service: ServiceId;
  readonly year: number;
  readonly tension: number;
  readonly epoch: EpochId;
  readonly epochFlags: readonly string[];
  readonly presetOverrides: DeepPartial<DifficultyPreset>;
  readonly scenarioOverrides: DeepPartial<ScenarioConfig['recruitment']>;
  readonly legend: { readonly cover: CoverIdentityId; readonly name: string; readonly official: boolean };
  readonly carry: Truth<CarryIn>;
  readonly history: PlayerHistory;
}

export interface PostingStats {
  readonly decrypts: number;
  readonly recruits: number;
  readonly turned: number;
  readonly surveilObservations: number;
  readonly followsCompleted: number;
  readonly arrestsCorrect: number;
  readonly arrestsWrongful: number;
  readonly madeFactLines: number;
  readonly meetingsHeld: number;
  readonly dropsServiced: number;
}

/**
 * A claim carried between postings. Same fields the Personal File and the
 * Mole Hunt gate need; the player-view Claim type stays in that package.
 */
export interface CarryClaim {
  readonly id: string;
  readonly prop: Proposition;
  readonly text: string;
  readonly relation: 'none' | 'corroborated' | 'conflicted';
}

/** A journal note carried between postings. Same fields as the player journal. */
export interface CarryNote {
  readonly seq: number;
  readonly at: GameTime;
  readonly attachTo: number | string;
  readonly text: string;
}

export interface PlayerCarry {
  readonly identified: readonly {
    readonly person: CampaignPersonId | NpcId;
    readonly name: string;
    readonly aliases: readonly string[];
    readonly apparentAffiliation?: string;
  }[];
  readonly unidentified: readonly {
    readonly person: CampaignUnkRef;
    readonly descriptor: string;
    readonly sightings: readonly { readonly city: CityPackId; readonly year: number }[];
  }[];
  readonly heldClaims: readonly CarryClaim[];
  readonly grades: readonly { readonly source: string; readonly grade: AdmiraltyGrade }[];
  readonly notes: readonly CarryNote[];
  readonly observedBurns: readonly LegendId[];
}

/**
 * One selector history row. Same fields as plotgen `TemplateHistoryEntry`;
 * campaign does not import the plotgen module.
 */
export interface TemplateHistoryEntry {
  readonly templateId: string;
  readonly variantKey: string;
  readonly archetype: string;
  readonly outcome: string;
}

export interface PlayerHistory {
  readonly campaignId: string;
  readonly postingIndex: number;
  readonly city: CityPackId;
  readonly templateHistory: readonly TemplateHistoryEntry[];
  readonly context: {
    readonly year: number;
    readonly skills: Readonly<Record<SkillId, number>>;
    readonly tension?: number;
    readonly epochFlags?: readonly string[];
    readonly rank?: string;
    readonly scaling?: number;
  };
}

export interface HostileDossier {
  readonly service: ServiceId;
  readonly notoriety: number;
  readonly descriptorKnown: boolean;
  readonly burnedLegends: readonly LegendId[];
  readonly patterns: readonly { readonly locType: LocationTypeId; readonly uses: number }[];
  readonly channelKinds: readonly { readonly kind: Channel['kind']; readonly uses: number }[];
  readonly suspectedAssets: readonly CampaignPersonId[];
  readonly doctrineShift: Partial<HostileDoctrine>;
}

export interface CampaignEnd {
  readonly kind: 'retirement' | 'death' | 'disgrace' | 'defection';
  readonly at: { readonly year: number; readonly posting: number };
  readonly cause: string;
}

/** A debrief item, either shown or replaced by a stable redaction reference. */
export type RedactedDebriefItem =
  | { readonly kind: 'shown'; readonly item: { readonly text: string } }
  | { readonly kind: 'redacted'; readonly ref: string };

export interface RedactedDebrief {
  readonly sections: readonly {
    readonly id: string;
    readonly items: readonly RedactedDebriefItem[];
  }[];
}

/**
 * The full debrief stored inside Campaign Truth until the archive reveal.
 * Plain data, so this package does not import player-view.
 */
export interface DebriefSnapshot {
  readonly outcome: string;
  readonly cause: string;
  readonly sections: readonly { readonly id: string; readonly text: string }[];
}

export interface PostingTruthExtract {
  readonly survivingHostiles: readonly CarriedNpc[];
  readonly assets: readonly { readonly person: CampaignPersonId; readonly npc: Npc; readonly rel: Relationship }[];
  readonly arcClues: readonly { readonly clue: ClueId; readonly present: boolean }[];
  readonly service: ServiceId;
  readonly cityId: CityPackId;
}

export interface PostingResult {
  readonly schema: 1;
  readonly index: number;
  readonly outcome: OutcomeRecord;
  readonly plots: OutcomeRecord['plots'];
  readonly stats: PostingStats;
  readonly carry: PlayerCarry;
  readonly debrief: { readonly full: Truth<DebriefSnapshot>; readonly redacted: RedactedDebrief };
  readonly extract: Truth<PostingTruthExtract>;
  readonly plotTemplate: PlotTemplateId;
}

/** One HQ figure as Campaign Truth knows them. The view copy omits `access`. */
export interface HqFigure {
  readonly id: CampaignPersonId;
  readonly template: string;
  readonly access: readonly ('cables' | 'directives' | 'personnel' | 'legends')[];
}

export interface CampaignTruth {
  readonly dossiers: Readonly<Record<ServiceId, HostileDossier>>;
  readonly carriedHostiles: readonly CarriedNpc[];
  readonly nemesis?: CampaignPersonId;
  readonly hqMole: CampaignPersonId;
  /** The drawn cast, including who can see cables and legends. The mole is `hqMole`. */
  readonly hqFigures: readonly HqFigure[];
  readonly cities: Readonly<
    Record<CityPackId, { readonly handedOver: readonly CarriedAsset[] }>
  >;
  readonly stagedAssets: readonly CarriedAsset[];
  readonly brought: readonly CarriedAsset[];
  /** Extra leads from exfiltration, for the next Personal File. Absent means none. */
  readonly extraLeads?: number;
  readonly arcs: Readonly<
    Record<
      ArcId,
      {
        readonly bindings: Readonly<Record<string, CampaignPersonId>>;
        readonly stage: string;
        readonly clues: Readonly<Record<ClueId, boolean>>;
      }
    >
  >;
  readonly unkMap: Readonly<Record<CampaignUnkRef, CampaignPersonId>>;
  readonly tensionByYear: Readonly<Record<number, number>>;
  readonly archive: readonly {
    readonly debrief: DebriefSnapshot;
    readonly extract: PostingTruthExtract;
  }[];
}

export interface ArchiveVisibleEntry {
  readonly index: number;
  readonly city: CityPackId;
  readonly year: number;
  readonly legend: LegendId;
  readonly rankAtStart: Rank;
  readonly outcome: OutcomeRecord['outcome'];
  readonly redacted: RedactedDebrief;
  readonly stats: PostingStats;
  readonly carry: PlayerCarry;
  readonly caseFileRef: string;
  readonly plotTemplate: PlotTemplateId;
  readonly plots: OutcomeRecord['plots'];
}

/** Copied out of Campaign Truth only when the campaign has ended. */
export interface ArchiveReveal {
  readonly debriefs: readonly DebriefSnapshot[];
  readonly hqMole: CampaignPersonId;
  readonly arcs: CampaignTruth['arcs'];
  readonly dossiers: CampaignTruth['dossiers'];
}

export interface CampaignArchive {
  readonly visible: readonly ArchiveVisibleEntry[];
  readonly reveal?: ArchiveReveal;
}

/**
 * Campaign state, schema 1. `view` is renderable. `truth` is branded and
 * stays inside this package. `archive.visible` is what a save may show
 * before the end-of-campaign reveal.
 */
export interface CampaignState {
  readonly schema: 1;
  readonly id: string;
  readonly seed: string;
  readonly preset: string;
  readonly manifests: readonly ContentManifest[];
  readonly calendar: { readonly year: number };
  readonly postings: number;
  readonly step: CampaignStep;
  readonly view: CampaignView;
  readonly truth: Truth<CampaignTruth>;
  readonly archive: CampaignArchive;
  readonly rng: PrngState;
  readonly log: readonly CampaignLogEntry[];
}

export type CampaignChoice =
  | {
      readonly kind: 'create';
      readonly seed?: string;
      readonly preset: string;
      readonly officerName: string;
      readonly background: BackgroundId;
      readonly startYear: number;
    }
  | { readonly kind: 'accept-offer'; readonly offer: OfferId }
  | {
      readonly kind: 'asset-decision';
      readonly asset: CampaignPersonId;
      readonly decision: 'handover' | 'exfiltrate' | 'bring';
    }
  | { readonly kind: 'train'; readonly skill: SkillId }
  | { readonly kind: 'leave' }
  | { readonly kind: 'requisition'; readonly id: RequisitionId }
  | { readonly kind: 'legend'; readonly cover: CoverIdentityId; readonly name: string }
  | { readonly kind: 'accuse'; readonly figure: CampaignPersonId }
  | { readonly kind: 'adopt-manifest'; readonly manifest: ContentManifest }
  | { readonly kind: 'retire' }
  | { readonly kind: 'defect' }
  | { readonly kind: 'decline-end-offer' }
  | { readonly kind: 'advance' };

export type CampaignLogEntry = { readonly seq: number } & (
  | { readonly kind: 'choice'; readonly choice: CampaignChoice }
  | {
      readonly kind: 'posting';
      readonly index: number;
      readonly seed: string;
      readonly manifest: ContentManifest;
      readonly actions: string;
      readonly recording: string;
      readonly resultHash: string;
    }
);
