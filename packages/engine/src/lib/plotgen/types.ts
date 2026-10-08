/**
 * Plot-library world additions. Kept free of {@link WorldState} so the state
 * module can name them without a cycle.
 */

/** A trace the slice clock can render from a library stage. */
export interface LibraryTrace {
  readonly kind: 'meeting' | 'transmission' | 'drop-loaded' | 'drop-emptied' | 'npc-moved';
  readonly roles: readonly string[];
  readonly text: string;
  readonly evidences: readonly string[];
  readonly channel?: 'radio' | 'numbers' | 'courier';
  readonly materiel?: string;
}

export interface LibraryStage {
  readonly id: string;
  readonly status: 'pending' | 'executed' | 'disrupted';
  readonly deadlineDay: number;
  readonly offMap: boolean;
  readonly facade: boolean;
  readonly branch?: string;
  readonly alt?: string;
  readonly roles: readonly string[];
  /** Present on on-map stages so the slice clock can emit them. */
  readonly traces?: readonly LibraryTrace[];
  readonly onDisrupted?: { readonly delay: number; readonly reroute: number; readonly abort: number };
  /** Phase index after a consistency reschedule. Absent when the stage kept its deadline. */
  readonly traceAt?: number;
  /** Predecessors, including a local `handoff` folded in as a requires edge. */
  readonly requires?: readonly string[];
  /** Cross-city hook fields, kept so multi-city can read the single-city plot. */
  readonly city?: string;
  readonly fallback?: string;
  readonly handoff?: {
    readonly from: string;
    readonly carrier?: string;
    readonly modes?: readonly string[];
  };
}

export interface LibraryBranch {
  readonly id: string;
  readonly after: readonly string[];
  readonly alternatives: readonly {
    readonly id: string;
    readonly when: readonly { readonly kind: string; readonly negate?: boolean; readonly value?: number; readonly stage?: string; readonly role?: string; readonly status?: string; readonly pattern?: string; readonly weight?: number }[];
    readonly stageIds: readonly string[];
  }[];
  readonly resolved?: { readonly alt: string; readonly cause: string; readonly at: { readonly day: number; readonly phase: 0 | 1 | 2 | 3 } };
}

export interface PlotStateV2 {
  readonly id: string;
  readonly templateId: string;
  readonly displayName: string;
  readonly archetype: string;
  readonly role: 'primary' | 'secondary';
  readonly variantKey: string;
  readonly cells: readonly { readonly org: string; readonly spec: string; readonly security: number; readonly members: readonly string[] }[];
  readonly cutouts: readonly string[];
  readonly bindings: Readonly<Record<string, string>>;
  /** Role slot → NPC id, for identification reports. */
  readonly roleHolders: Readonly<Record<string, string>>;
  /** NPC id → stage ids and member ids that NPC knows. */
  readonly knowledge: Readonly<Record<string, readonly string[]>>;
  readonly runtimeBranches: readonly LibraryBranch[];
  readonly twist?: {
    readonly kind: 'false-flag' | 'facade' | 'inside-man';
    readonly facadeStages: readonly string[];
    readonly decoy?: string;
    readonly inside?: string;
    /** Cell members whose cover story claims membership of the decoy. */
    readonly cover?: readonly { readonly npc: string; readonly org: string }[];
    /** A planted document and a rumour that repeat the decoy membership. */
    readonly plants?: readonly { readonly kind: 'document' | 'rumour'; readonly org: string }[];
    readonly trueAllegiance?: 'hostile';
    readonly apparentAllegiance?: 'station';
    readonly propositions: readonly string[];
  };
  readonly outcomes: {
    readonly success: readonly { readonly kind: string; readonly role?: string; readonly item?: string; readonly entity?: string; readonly stage?: string; readonly status?: string }[];
    readonly failure: readonly { readonly kind: string; readonly role?: string; readonly item?: string; readonly entity?: string; readonly stage?: string; readonly status?: string }[];
  };
  readonly offMap: readonly string[];
  /** City roles declared on the template. The first key is the local role. */
  readonly cityRoles?: Readonly<Record<string, { readonly not?: string }>>;
  /** Every stage hook, including stages replaced by a local fallback. */
  readonly cityHooks?: readonly {
    readonly id: string;
    readonly city?: string;
    readonly fallback?: string;
    readonly handoff?: {
      readonly from: string;
      readonly carrier?: string;
      readonly modes?: readonly string[];
    };
  }[];
  readonly stages: readonly LibraryStage[];
  readonly subPlots: readonly string[];
  readonly standingPenalty: number;
  readonly standingReward: number;
  /** Bound item id → who holds it before any HANDS_OVER. */
  readonly itemOrigins?: Readonly<Record<string, string>>;
  /** Disruptions that count toward this plot's abort, facade stages excluded. */
  readonly abortCount?: number;
  readonly damageReport?: string;
  readonly resolution?: {
    readonly result: 'disrupted' | 'succeeded';
    readonly at: { readonly day: number; readonly phase: 0 | 1 | 2 | 3 };
    readonly by: string;
  };
}

export interface LibrarySelection {
  readonly primary: string;
  readonly secondaries: readonly string[];
  readonly historyHash: string;
}
