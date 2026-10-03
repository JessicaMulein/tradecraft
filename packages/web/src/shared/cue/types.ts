/**
 * Cue Director types (design, "Cue Director"; Requirement 15). Shared by the
 * server (which validates the Cue Map and builds the Manifest) and the browser
 * (which runs `decide`). No imports, so it compiles into both.
 */

export type CueId = string;

/**
 * The whole input of the Director. It is filled only from API responses the
 * player could already see, which is the structural guarantee behind the
 * non-oracle rule (Requirement 15.2): nothing else can reach `decide`.
 */
export interface CueInputs {
  readonly screen: 'title' | 'opening' | 'city' | 'talk' | 'workbench' | 'intercept' | 'gameover';
  readonly district?: string;
  readonly locationType?: string;
  /** Public tags only, e.g. `sector:soviet`, `type:kaffeehaus`. */
  readonly locationTags: readonly string[];
  readonly phase: string;
  /** The player's own action kind. */
  readonly lastActionKind?: string;
  /** The player's own classified intent in an open scene. */
  readonly lastIntent?: string;
  /** Fact kinds shown this turn, e.g. `border-outcome:detained`. */
  readonly factKinds: readonly string[];
  /** Notification kinds currently shown. */
  readonly alerts: readonly string[];
  readonly dialogueStreaming: boolean;
  readonly gameOver?: 'success' | 'burned' | 'plot-completes';
  /** Minutes the Director has spent in its current decision (browser clock). */
  readonly minutesInState: number;
}

export const INPUT_KEYS = [
  'screen',
  'district',
  'locationType',
  'locationTags',
  'phase',
  'lastActionKind',
  'lastIntent',
  'factKinds',
  'alerts',
  'dialogueStreaming',
  'gameOver',
  'minutesInState',
] as const satisfies readonly (keyof CueInputs)[];

export type InputKey = (typeof INPUT_KEYS)[number];

/** Keys whose value is a list of strings. */
export const LIST_KEYS: readonly InputKey[] = ['locationTags', 'factKinds', 'alerts'];
/** Keys whose value is a number. */
export const NUMBER_KEYS: readonly InputKey[] = ['minutesInState'];

/** Besides the inputs, a rule may read which cue the Director is in now. */
export const STATE_KEY = 'current';

export type Scalar = string | number | boolean;

export type Operator =
  | { readonly has: string }
  | { readonly hasPrefix: string }
  | { readonly in: readonly Scalar[] }
  | { readonly gt: number }
  | { readonly gte: number }
  | { readonly lt: number }
  | { readonly lte: number };

export type Predicate =
  | { readonly all: readonly Predicate[] }
  | { readonly any: readonly Predicate[] }
  | { readonly not: Predicate }
  | { readonly [key: string]: Scalar | Operator | readonly Predicate[] | Predicate };

export type Transition =
  | { readonly type: 'crossfade'; readonly seconds: number; readonly boundary?: 'phrase' | 'immediate' }
  | { readonly type: 'cut' }
  | { readonly type: 'after-stinger' };

export interface Slice {
  readonly section?: string;
  readonly start?: number;
  readonly end?: number;
}

export interface CueDef {
  readonly kind: 'music' | 'stinger' | 'ambience';
  /** File stem in the soundtrack directory (`Café` for `Café.mp3`, `Café 2.mp3`). */
  readonly file?: string;
  /** A Derived Cue plays a slice of one Take of another Cue. */
  readonly from?: CueId;
  readonly take?: number;
  readonly slice?: Slice;
  /** `none`, or a named section to loop (the Take's metadata supplies its points). */
  readonly loop?: 'none' | { readonly section: string };
  readonly duck?: boolean;
  readonly fadeOut?: number;
  readonly gain?: number;
}

export interface Rule {
  readonly name?: string;
  readonly when: Predicate;
  readonly music?: CueId | 'silence';
  readonly stinger?: CueId;
  readonly ambience?: CueId | 'off';
  readonly transition?: Transition;
  readonly duck?: boolean;
  /** Hold the decision for this many seconds, once per time the rule becomes true. */
  readonly holdSeconds?: number;
}

export interface CueMap {
  readonly version: 1;
  readonly cues: Readonly<Record<CueId, CueDef>>;
  readonly rules: readonly Rule[];
}

export interface TakeMeta {
  readonly bpm?: number;
  readonly beatsPerPhrase?: number;
  readonly firstBeatOffset?: number;
  readonly loopStart?: number;
  readonly loopEnd?: number;
  readonly sections?: Readonly<Record<string, readonly [number, number]>>;
}

export type AudioFormatName = 'opus' | 'mp3' | 'wav';

export interface Take {
  /** Stable id: `<stem>#<n>`. */
  readonly id: string;
  readonly number: number;
  readonly files: Readonly<Partial<Record<AudioFormatName, string>>>;
  readonly meta?: TakeMeta;
}

/** What the browser needs to know about the audio on disk. */
export interface CueManifest {
  readonly takes: Readonly<Record<CueId, readonly Take[]>>;
  /** Cues named by the map with no audio. */
  readonly missing: readonly CueId[];
  /** Cues with a single Take (reported, still played). */
  readonly singleTake: readonly CueId[];
}

export interface DirectorState {
  /** The cue currently playing, `silence`, or undefined before the first decision. */
  readonly cue: CueId | 'silence' | undefined;
  readonly hold?: { readonly rule: number; readonly minutes: number };
  /** Hold rules that have fired and whose predicate has not yet gone false. */
  readonly spent: readonly number[];
}

export interface CueDecision {
  /** `undefined` = leave the music unchanged. */
  readonly music: CueId | 'silence' | undefined;
  readonly stinger?: CueId;
  readonly ambience?: CueId | 'off';
  readonly transition: Transition;
  readonly duck: boolean;
}

export const INITIAL_DIRECTOR_STATE: DirectorState = { cue: undefined, spent: [] };
