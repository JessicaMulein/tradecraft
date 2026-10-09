/**
 * Fixed-length features for the neural player.
 *
 * The state vector is the Player View plus a little memory the player would
 * keep (where they have already watched, whether they have cabled for a file,
 * how long the open conversation has run). Each legal action has its own
 * vector. The network scores `(state, action)` pairs, so the action list can
 * change from turn to turn.
 */

export const PRESETS = ['easy', 'standard', 'hard'] as const;
export type PresetName = (typeof PRESETS)[number];

export const CROWDS = ['empty', 'sparse', 'busy', 'packed'] as const;
export type CrowdName = (typeof CROWDS)[number];

/** Catalogue action kinds, in one-hot order. */
export const CATALOGUE_KINDS = [
  'talk',
  'approach',
  'travel',
  'arrange-meeting',
  'surveil',
  'follow',
  'service-drop',
  'intercept',
  'decrypt',
  'read',
  'cable',
  'task',
  'pay',
  'confront',
  'arrest',
  'turn-agent',
  'feed',
  'attend-duty',
  'depart',
  'request-papers',
  'apply-visa',
  'liaison-request',
  'wait',
] as const;

/** Dialogue lines the player can say while a talk scene is open. */
export const SAY_INTENTS = [
  'ask',
  'reassure',
  'probe',
  'small-talk',
  'pitch-money',
  'pitch-ideology',
  'pitch-coercion',
  'pitch-ego',
] as const;

export type SayIntent = (typeof SAY_INTENTS)[number];

export const MOVE_KINDS = [
  ...CATALOGUE_KINDS,
  'say-ask',
  'say-reassure',
  'say-probe',
  'say-small-talk',
  'say-pitch-money',
  'say-pitch-ideology',
  'say-pitch-coercion',
  'say-pitch-ego',
  'end-scene',
] as const;

const KIND_INDEX = new Map<string, number>(
  MOVE_KINDS.map((kind, i) => [kind, i]),
);

/** Scalar tails after the action-kind one-hot. Keep in lockstep with {@link encodeAction}. */
const ACTION_SCALARS = 20;

/** Scalar tails after the preset and crowd one-hots. Keep in lockstep with {@link encodeState}. */
const STATE_SCALARS = 26;

export const STATE_DIM = PRESETS.length + CROWDS.length + STATE_SCALARS;
export const ACTION_DIM = MOVE_KINDS.length + ACTION_SCALARS;

/** What the player can see, plus the memory features the driver tracks. */
export interface StateContext {
  readonly preset: PresetName;
  readonly day: number;
  readonly phase: number;
  readonly budget: number;
  readonly standing: number;
  readonly hereRisk: number;
  readonly crowd: CrowdName;
  readonly atStation: boolean;
  readonly sceneOpen: boolean;
  readonly linesInScene: number;
  readonly unread: number;
  readonly claims: number;
  readonly maxEvidence: number;
  readonly arrestThreshold: number;
  readonly evidenceHolders: number;
  readonly corroborated: number;
  readonly intercepts: number;
  readonly breakable: number;
  readonly assets: number;
  readonly people: number;
  readonly visible: number;
  readonly journal: number;
  readonly hereInClaims: boolean;
  readonly hereSurveilledRecently: boolean;
  readonly phasesSinceIntercept: number;
  readonly topSuspectTraced: boolean;
  readonly approachesToday: number;
}

/** One legal action, described the way the scorer sees it. */
export interface ActionContext {
  readonly kind: string;
  readonly phases: number;
  readonly money: number;
  readonly countersurveillance: boolean;
  readonly destRisk: number;
  readonly destStation: boolean;
  /** Share of the most-mentioned claim location this destination has, in `[0, 1]`. */
  readonly destClaimWeight: number;
  readonly destSurveilledRecently: boolean;
  readonly targetEvidence: number;
  readonly targetIsBest: boolean;
  readonly targetClaims: number;
  readonly targetAsset: boolean;
  readonly targetRapport: number;
  readonly targetVisible: boolean;
  readonly targetHostile: boolean;
  readonly unreadRead: boolean;
  readonly breakableDecrypt: boolean;
  readonly cableTraceBest: boolean;
  readonly cableFunds: boolean;
  readonly riskyDirectTravel: boolean;
  readonly waitPhases: number;
}

function bit(value: boolean): number {
  return value ? 1 : 0;
}

function clip(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/** A neutral state a test or a blank action can start from. */
export function baseState(patch: Partial<StateContext> = {}): StateContext {
  return {
    preset: 'standard',
    day: 0,
    phase: 0,
    budget: 40,
    standing: 0,
    hereRisk: 0,
    crowd: 'empty',
    atStation: false,
    sceneOpen: false,
    linesInScene: 0,
    unread: 0,
    claims: 0,
    maxEvidence: 0,
    arrestThreshold: 7,
    evidenceHolders: 0,
    corroborated: 0,
    intercepts: 0,
    breakable: 0,
    assets: 0,
    people: 0,
    visible: 0,
    journal: 0,
    hereInClaims: false,
    hereSurveilledRecently: false,
    phasesSinceIntercept: 0,
    topSuspectTraced: false,
    approachesToday: 0,
    ...patch,
  };
}

/** A neutral action. `patch` overrides the fields a test cares about. */
export function baseAction(
  kind: string,
  patch: Partial<ActionContext> = {},
): ActionContext {
  return {
    kind,
    phases: 1,
    money: 0,
    countersurveillance: false,
    destRisk: 0,
    destStation: false,
    destClaimWeight: 0,
    destSurveilledRecently: false,
    targetEvidence: 0,
    targetIsBest: false,
    targetClaims: 0,
    targetAsset: false,
    targetRapport: 0.45,
    targetVisible: false,
    targetHostile: false,
    unreadRead: false,
    breakableDecrypt: false,
    cableTraceBest: false,
    cableFunds: false,
    riskyDirectTravel: false,
    waitPhases: kind === 'wait' ? 1 : 0,
    ...patch,
  };
}

/** Encode the player-visible state. Length is always {@link STATE_DIM}. */
export function encodeState(state: StateContext): Float64Array {
  const v: number[] = [];
  for (const preset of PRESETS) v.push(state.preset === preset ? 1 : 0);
  for (const crowd of CROWDS) v.push(state.crowd === crowd ? 1 : 0);
  v.push(
    clip(state.day / 48, 0, 1.5),
    state.phase / 3,
    clip(state.budget / 100, 0, 2),
    clip(state.standing / 10, -1, 1),
    clip(state.hereRisk, 0, 1),
    bit(state.atStation),
    bit(state.sceneOpen),
    clip(state.linesInScene / 4, 0, 2),
    clip(state.unread / 6, 0, 2),
    clip(state.claims / 20, 0, 2),
    clip(state.maxEvidence / 8, 0, 2),
    clip(state.arrestThreshold / 8, 0, 2),
    clip(state.evidenceHolders / 4, 0, 2),
    clip(state.corroborated / 10, 0, 2),
    clip(state.intercepts / 6, 0, 2),
    clip(state.breakable / 4, 0, 2),
    clip(state.assets / 3, 0, 2),
    clip(state.people / 20, 0, 2),
    clip(state.visible / 8, 0, 2),
    clip(state.journal / 40, 0, 2),
    bit(state.hereInClaims),
    bit(state.hereSurveilledRecently),
    clip(state.phasesSinceIntercept / 16, 0, 4),
    bit(state.topSuspectTraced),
    clip(state.approachesToday / 3, 0, 2),
    clip(Math.max(0, state.arrestThreshold - state.maxEvidence) / 8, 0, 2),
  );
  if (v.length !== STATE_DIM) {
    throw new Error(
      `state features are ${v.length} long, expected ${STATE_DIM}`,
    );
  }
  return Float64Array.from(v);
}

/** Encode one legal action. Length is always {@link ACTION_DIM}. */
export function encodeAction(action: ActionContext): Float64Array {
  const v = new Array<number>(MOVE_KINDS.length).fill(0);
  const index = KIND_INDEX.get(action.kind);
  if (index !== undefined) v[index] = 1;
  v.push(
    clip(action.phases / 4, 0, 2),
    clip(action.money / 40, 0, 2),
    bit(action.countersurveillance),
    clip(action.destRisk, 0, 1),
    bit(action.destStation),
    clip(action.destClaimWeight, 0, 1),
    bit(action.destSurveilledRecently),
    clip(action.targetEvidence / 8, 0, 2),
    bit(action.targetIsBest),
    clip(action.targetClaims / 8, 0, 2),
    bit(action.targetAsset),
    clip(action.targetRapport, 0, 1),
    bit(action.targetVisible),
    bit(action.targetHostile),
    bit(action.unreadRead),
    bit(action.breakableDecrypt),
    bit(action.cableTraceBest),
    bit(action.cableFunds),
    bit(action.riskyDirectTravel),
    bit(action.waitPhases === 1),
  );
  if (v.length !== ACTION_DIM) {
    throw new Error(
      `action features are ${v.length} long, expected ${ACTION_DIM}`,
    );
  }
  return Float64Array.from(v);
}
