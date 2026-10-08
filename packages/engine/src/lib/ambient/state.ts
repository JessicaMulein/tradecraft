/**
 * Ambient world state (ambient-world design, Data Models). Hidden fields are
 * Truth-branded. The slice world omits `ambient` entirely when the scenario
 * leaves the block off.
 */

import type { AmbientCoupling } from '../fidelity/types.js';
import type { RegionGraph } from '../region/verify.js';
import type { EvtId, LocId, NpcId, OrgId, Phase, Proposition, Truth } from '../model/core.js';
import type { METRIC_IDS } from './content.js';
import type { Overlay } from './locations.js';
import type { StoredWitness } from './solvability.js';

/** A proposition an NPC may mention, with the salience used to rank it. */
export interface AmbientPromptFact {
  readonly proposition: Proposition;
  readonly salience: number;
}

export type MetricId = (typeof METRIC_IDS)[number];
export type Density = 'sparse' | 'standard' | 'rich';

export interface Metrics {
  readonly exo: Record<MetricId, number>;
  readonly react: Record<MetricId, number>;
}

export interface Townsfolk {
  readonly id: NpcId;
  readonly archetype: string;
  readonly descriptor: string;
  readonly schedule: string;
  readonly recollections: readonly unknown[];
  readonly regard: {
    readonly warmth: number;
    readonly wariness: number;
    readonly familiarity: number;
  };
  readonly informant: Truth<false | 'police' | 'hostile'>;
}

export type TieKind = 'kin' | 'friend' | 'colleague' | 'romantic' | 'rival' | 'creditor';

export interface NpcTie {
  readonly a: NpcId;
  readonly b: NpcId;
  readonly affinity: number;
  /** Absent on ties minted at init; those read as `friend`. */
  readonly kind?: TieKind;
  readonly prop?: string;
}

export interface LifeDrift {
  readonly day: number;
  readonly lever: 'money' | 'ideology' | 'coercion' | 'ego' | 'moneyNeed';
  readonly amount: number;
}

export interface LifeDeviation {
  readonly untilDay: number;
  readonly weekday: number;
  readonly phase: Phase;
  readonly loc: LocId;
}

export interface LifeState {
  readonly needs: { readonly money: number; readonly social: number; readonly work: number };
  readonly mood: number;
  readonly work: 'employed' | 'unemployed' | 'sick' | 'on-leave';
  readonly lastLifeEvent?: number;
  readonly deviations: readonly LifeDeviation[];
  readonly drift: readonly LifeDrift[];
  readonly removed?: 'removed' | 'detained' | 'dead';
  readonly facts: readonly Proposition[];
}

export type CivicOrgKind =
  | 'police'
  | 'press'
  | 'union'
  | 'party'
  | 'employer'
  | 'cover-employer';

export interface CivicOrg {
  readonly id: OrgId;
  readonly name: string;
  readonly kind: CivicOrgKind;
  readonly templateId: string;
}

export interface AmbientOutlet {
  readonly id: string;
  readonly name: string;
  readonly slant: 'government' | 'opposition' | 'commercial' | 'church';
  /** Share of slant-disfavoured articles this outlet distorts. */
  readonly distortion?: number;
  /** Story keys this outlet prints. Empty or absent means every story. */
  readonly covers?: readonly string[];
}

export interface StoryBeat {
  readonly beat: string;
  readonly day: number;
  readonly props: readonly string[];
}

export interface StoryState {
  readonly id: string;
  readonly key: string;
  readonly source: string;
  readonly chain: readonly string[];
  readonly beats: readonly StoryBeat[];
  readonly lastDevelopment: number;
  readonly status: 'active' | 'closed';
  readonly priority: number;
}

export interface CoverDuty {
  readonly id: string;
  readonly template: string;
  readonly loc: LocId;
  readonly slot: { readonly day: number; readonly phase: 1 | 2 };
  readonly phases: 1 | 2;
  readonly mandatory: boolean;
  readonly standingGain: number;
  readonly suspicionDelta: number;
  readonly attendees: readonly NpcId[];
  readonly status: 'pending' | 'attended' | 'missed';
}

export type AmbientInboxOp =
  | {
      readonly op: 'news-development';
      readonly story: string;
      readonly beat: string;
      readonly chain?: readonly string[];
    }
  | {
      readonly op: 'post-notice';
      readonly template: string;
      readonly target: string;
      readonly title?: string;
      readonly body?: string;
      readonly days?: number;
    }
  | { readonly op: 'spawn-thread'; readonly tags: readonly string[]; readonly template?: string };

export interface PreparedEdition {
  readonly outlet: string;
  readonly items: readonly {
    readonly id: string;
    readonly source: 'city-event';
    readonly headline: string;
    readonly summary: string;
    readonly asserts: readonly Proposition[];
  }[];
}

export interface DutyAlert {
  readonly duty: string;
  readonly kind: 'due' | 'missed';
  readonly day: number;
  readonly phase: number;
}

export interface CoverMessage {
  readonly day: number;
  readonly phase: number;
  readonly text: string;
}

export interface DayCounters {
  readonly starts: number;
  readonly incidents: number;
  readonly lifeEvents: number;
  readonly gossip: number;
  readonly promotions: number;
  readonly threads: number;
}

export interface AmbientState {
  readonly schema: 1;
  readonly cityId: string;
  readonly enabled: true;
  readonly density: Density;
  readonly calendar: { readonly startDate: string; readonly holidays: readonly string[] };
  readonly metrics: Metrics;
  readonly events: Readonly<Record<EvtId, unknown>>;
  readonly history: Readonly<Record<string, readonly number[]>>;
  readonly triggers: readonly unknown[];
  readonly overlays: readonly Overlay[];
  /** Location-type tags copied at init, keyed by location id, so later ticks can resolve tag queries. */
  readonly siteTags?: Readonly<Record<string, readonly string[]>>;
  readonly dormant: readonly LocId[];
  readonly life: Readonly<Record<NpcId, LifeState>>;
  readonly ties: readonly NpcTie[];
  readonly tier: Readonly<Record<NpcId, 'full' | 'coarse'>>;
  readonly townsfolk: Readonly<Record<NpcId, Townsfolk>>;
  readonly civicOrgs: readonly CivicOrg[];
  readonly promotionQueue: readonly NpcId[];
  readonly lastInteraction: Readonly<Record<NpcId, unknown>>;
  readonly memory: Truth<Readonly<Record<NpcId, readonly unknown[]>>>;
  readonly regard: Truth<Readonly<Record<NpcId, unknown>>>;
  readonly informants: Truth<Readonly<Record<NpcId, 'police' | 'hostile'>>>;
  readonly stories: Readonly<Record<string, StoryState>>;
  readonly outlets: readonly AmbientOutlet[];
  readonly duties: readonly CoverDuty[];
  /** Ops waiting for the news and thread steps. Absent until an event queues one. */
  readonly inbox?: readonly AmbientInboxOp[];
  /** Today's ranked outlet editions, ready for the newspaper step. */
  readonly preparedEditions?: readonly PreparedEdition[];
  /** Truth of a printed proposition. Distorted asserts hold false. */
  readonly truthRecords?: Readonly<Record<string, { readonly holds: boolean; readonly distorted: boolean }>>;
  /** Notices and the day they come down. */
  readonly notices?: readonly { readonly doc: string; readonly untilDay: number }[];
  readonly threadOrigins?: Readonly<Record<string, 'emergent'>>;
  readonly lastThreadDay?: number;
  readonly dutyAlerts?: readonly DutyAlert[];
  readonly coverMessages?: readonly CoverMessage[];
  /** Public events already announced, so a start day notifies the Station once. */
  readonly announced?: readonly string[];
  /**
   * Location status the player has seen or read. The Map uses this, never the
   * live overlay.
   */
  readonly lastKnownStatus?: Readonly<Record<string, string>>;
  /** Dead drops the player will find disturbed. */
  readonly disturbedDrops?: readonly { readonly drop: string; readonly day: number; readonly phase: number }[];
  /** Propositions an NPC may mention, fixed until the next day boundary. */
  readonly promptCache?: {
    readonly day: number;
    readonly facts: Readonly<Record<string, readonly AmbientPromptFact[]>>;
  };
  /** Hidden incidents drawn for a location and phase. Their fact lines are public. */
  readonly incidentLog?: readonly {
    readonly loc: string;
    readonly phase: number;
    readonly factLine: string;
  }[];
  readonly coverStanding: Truth<number>;
  readonly hookLedger: Truth<readonly unknown[]>;
  readonly ambientDelayDays: number;
  readonly coverDeltaToday: { readonly pos: number; readonly neg: number };
  /** Channel windows moved to an alternate or a courier. Never a compromised-channel mark. */
  readonly channelOutages: readonly {
    readonly channel: string;
    readonly untilDay: number;
    readonly alternate: string;
  }[];
  /** Hidden informant reports waiting for the hostile tailing step. */
  readonly informantReports: readonly {
    readonly visibility: 'hidden';
    readonly informant: NpcId;
    readonly handler: 'police' | 'hostile';
    readonly seenWith?: NpcId;
  }[];
  /** Bonuses the next detection pass consumes, keyed by NPC id. */
  readonly detectionBonuses: Readonly<Record<string, number>>;
  /** RELATED_TO, INVOLVED_WITH and OWES facts held by each participant. */
  readonly tieKnowledge: Readonly<Record<NpcId, readonly Proposition[]>>;
  /** Distorted gossip the receiver believes. These propositions do not hold. */
  readonly falseBeliefs: Readonly<Record<NpcId, readonly Proposition[]>>;
  readonly gate: {
    readonly solvable: readonly string[];
    readonly anchors: readonly string[];
    readonly slowRunsToday: number;
    /** Discovery witnesses. Present after ambient init so an anchor hit can be re-checked. */
    readonly witnesses?: readonly StoredWitness[];
  };
  readonly counters: DayCounters;
  /**
   * Set by the multi-city adapter. While set, hooks queue as couplings and
   * the plot spine is left for applyCouplings.
   */
  readonly multiCity?: true;
  readonly pendingCouplings?: readonly AmbientCoupling[];
  /**
   * Spine placements for the advance in progress. Gossip treats two NPCs at
   * the same location in this city as co-present. Stripped before the step
   * returns, so it is not saved.
   */
  readonly spinePlacements?: Readonly<Record<string, { readonly city: string; readonly loc: string }>>;
  /**
   * Regional learnability graph for the Solvability Gate. Present only while
   * multi-city mode is advancing a world whose generator registered one.
   * Single-city init does not set it.
   */
  readonly region?: RegionGraph;
}
