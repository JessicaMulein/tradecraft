/**
 * The Sim side of a dialogue turn (slice-integration design, "Engine: dialogue
 * turn"; Requirements 15.5, 15.6, 15.7, 15.8; completing slice Req 10.2, 10.3,
 * 10.5 and 28.5).
 *
 * When the player says a line in a Talk Scene, the `fast` role labels it with
 * one {@link Intent}. That label is the only model-derived input the Sim acts
 * on. {@link applyDialogueTurn} applies everything the label causes to the
 * turn's Draft, before the NPC's reply is voiced, so the voice seam sees the
 * updated state:
 *
 * 1. **Intent (Req 15.5).** {@link applyIntent} moves the scene NPC's trust and
 *    suspicion by the Intent's fixed deltas.
 * 2. **Pitch (Req 15.6, 15.7, 15.8).** A `pitch-*` Intent presses one motive.
 *    It is heard only after {@link MEETINGS_BEFORE_PITCH} days of development
 *    and a headquarters trace that approved it. Until then the line raises
 *    suspicion and draws nothing, and no money is paid. Once it is heard,
 *    {@link resolvePitch} draws the recruitment coin once on the runtime PRNG,
 *    against the Relationship as step 1 left it.
 *    - Money. On `pitch-money`, a positive offer debits the Budget by the offer,
 *      tagged `pay` with the NPC as the entry's `ref`, whether or not the pitch
 *      lands. The same offer scales the money lever by `min(1, offer /
 *      moneyNeed)`. An offer attached to any other Intent moves no money and
 *      scales nothing.
 *    - Acceptance. The NPC becomes an Asset: `recruited` is set and the profile
 *      is minted with {@link assetProfileFor}. An NPC who already has a profile
 *      keeps it, so pitching a running Asset never resets a turned or doubled
 *      profile.
 *    - Refusal. The NPC's suspicion rises by the outcome's `suspicionDelta`,
 *      clamped to `[0, 1]` like every dialogue move. When the outcome is
 *      `reported`, the NPC reports the approach to the Hostile Service: they
 *      join `hostile.beliefs.suspectedApproaches`, and the player's Cover
 *      Suspicion rises by {@link PITCH_REPORTED_COVER_SUSPICION}.
 * 3. **Recent turns.** The player's line joins the scene's `recent` turns,
 *    keeping the last {@link RECENT_TURNS} ({@link appendRecentTurn}), and the
 *    updated scene is written to `player.scene`. The Turn Pipeline appends the
 *    NPC's reply the same way after voicing it.
 *
 * ## The scene NPC's Relationship and Contact Channel
 *
 * The turn starts from {@link sceneRelationship}: the NPC's Relationship, or a
 * fresh {@link newRelationship} when there is none yet. Starting-Brief contacts
 * and NPCs met by chance have none until something writes one.
 *
 * The slice records a Contact Channel by putting the NPC in `player.contacts`.
 * The Starting Brief, a successful Cold Approach, an introduction, a Walk-in
 * and an accepted pitch create one (slice Req 22.2): recruiting someone
 * includes agreeing how to reach them. The `task` quote reads the
 * Relationship's `channel` flag, so {@link sceneRelationship} sets `channel`
 * when the player has a Contact Channel to the NPC ({@link hasContactChannel})
 * and never clears it, and an accepted pitch sets both. A recruited Asset can
 * therefore always be tasked.
 *
 * ## Contract and purity
 *
 * Pure: the function reads only its arguments, never mutates them, and draws
 * only from `rng`. A pitch headquarters has approved takes exactly one draw.
 * A pitch made too early, and every other Intent, takes none. The PRNG state
 * is not written into the returned state. The Turn
 * Pipeline records `rng.state()` at commit, as it does for an action turn.
 *
 * The caller gates the offer. The facade rejects an offer the Budget cannot
 * cover before the line is classified (Req 15.7), so an offer here that is
 * negative, not finite, or larger than the Budget on a money pitch is a
 * programming error and throws a `RangeError`. A scene NPC missing from
 * `WorldState.npcs` also throws.
 *
 * `events` is always empty. No Sim event kind covers a dialogue effect, and a
 * reported approach is recorded in the Hostile Service's beliefs rather than
 * as an event. The field lets the pipeline treat dialogue turns like action
 * turns.
 */

import { asTruth, revealTruth, type NpcId } from '../model/core.js';
import {
  RECENT_TURNS,
  type SimEvent,
  type TalkScene,
  type TalkSceneTurn,
  type WorldState,
} from '../model/state.js';
import type { Prng } from '../prng/prng.js';
import { INSUFFICIENT, payLedgerEffect } from '../station/ledger.js';
import { hasContactChannel } from '../action/talk.js';
import { TURN_REPORTED_COVER_SUSPICION } from '../action/turn-agent.js';
import {
  assetProfileFor,
  MEETINGS_BEFORE_PITCH,
  newRelationship,
  type MiceLever,
  type Relationship,
} from './asset.js';
import { applyIntent, type Intent } from './intent.js';
import { resolvePitch, type PitchOutcome, type PitchWeights } from './pitch.js';
import { standingAppointment } from './standing.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * How much a reported pitch raises the player's Cover Suspicion (Req 15.8).
 * The slice gives one Cover Suspicion increment for an approach the target
 * reports to the Hostile Service: a reported failed turn raises it by 0.1
 * (slice design, "Turning"). A reported pitch is the same kind of report, so it
 * reuses that increment.
 */
export const PITCH_REPORTED_COVER_SUSPICION = TURN_REPORTED_COVER_SUSPICION;

// ---------------------------------------------------------------------------
// Input and result
// ---------------------------------------------------------------------------

/**
 * One dialogue line, as the Turn Pipeline hands it to {@link applyDialogueTurn}
 * (design: `DialogueTurnInput`). The design's shape is `{ intent, offer? }`.
 * `line` is added so the turn can append the player's words to the scene's
 * recent turns.
 */
export interface DialogueTurnInput {
  /** The player's line, as said. It joins the scene's recent turns. */
  readonly line: string;
  /** The Intent the `fast` role classified the line into. */
  readonly intent: Intent;
  /**
   * The money the player attached to the line (`say(line, { offer })`). Only a
   * `pitch-money` Intent uses it: the Budget is debited by it and the money
   * lever is scaled by it. Absent means no offer.
   */
  readonly offer?: number;
}

/** What {@link applyDialogueTurn} returns (design: `{ state, pitch?, events }`). */
export interface DialogueTurnResult {
  /** The Draft with the turn's effects applied. */
  readonly state: WorldState;
  /** The pitch outcome, present exactly when the Intent was a `pitch-*`. */
  readonly pitch?: PitchOutcome;
  /** The Sim events the turn minted. Always empty (see the module notes). */
  readonly events: readonly SimEvent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The MICE lever a pitch Intent presses, or `undefined` when the Intent is not
 * a pitch. Each of the four `pitch-*` Intents names its lever (slice Req 4.2).
 */
export function pitchLever(intent: Intent): MiceLever | undefined {
  switch (intent) {
    case 'pitch-money':
      return 'money';
    case 'pitch-ideology':
      return 'ideology';
    case 'pitch-coercion':
      return 'coercion';
    case 'pitch-ego':
      return 'ego';
    default:
      return undefined;
  }
}

/**
 * The Relationship a dialogue turn with `npc` starts from: the stored one, or
 * {@link newRelationship} when there is none, with `channel` set when the
 * player has a Contact Channel to the NPC (see the module notes). Pure. Every
 * Relationship effect {@link applyDialogueTurn} has applies on top of this.
 */
export function sceneRelationship(state: WorldState, npc: NpcId): Relationship {
  const rel = state.relationships[npc] ?? newRelationship(npc);
  if (!rel.channel && hasContactChannel(state, npc)) {
    return { ...rel, channel: true };
  }
  return rel;
}

/**
 * Append one turn to a scene's recent turns, keeping the last
 * {@link RECENT_TURNS} and dropping the oldest. Pure: returns a new list.
 */
export function appendRecentTurn(
  recent: readonly TalkSceneTurn[],
  turn: TalkSceneTurn,
): readonly TalkSceneTurn[] {
  const next = [...recent, turn];
  return next.length > RECENT_TURNS
    ? next.slice(next.length - RECENT_TURNS)
    : next;
}

/** Clamp a value into `[0, 1]`. */
function clampUnit(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Debit a money pitch's offer from the Budget (Req 15.7), tagged `pay` with the
 * NPC as the entry's `ref`. The facade has already checked the Budget covers
 * the offer, so an uncovered offer throws.
 */
function offerCovered(state: WorldState, amount: number, npc: NpcId): boolean {
  return payLedgerEffect(state.station.ledger, amount, state.time, npc) !== INSUFFICIENT;
}

function debitOffer(state: WorldState, amount: number, npc: NpcId): WorldState {
  const ledger = payLedgerEffect(state.station.ledger, amount, state.time, npc);
  if (ledger === INSUFFICIENT) {
    throw new RangeError(
      `applyDialogueTurn: the Budget cannot cover an offer of ${amount}; ` +
        'the facade must reject the offer before classification',
    );
  }
  return { ...state, station: { ...state.station, ledger } };
}

/**
 * Record that `npc` reported the player's pitch to the Hostile Service
 * (Req 15.8): add them to `hostile.beliefs.suspectedApproaches` once, and raise
 * the player's Cover Suspicion by {@link PITCH_REPORTED_COVER_SUSPICION},
 * clamped to `[0, 1]`. Each report raises Cover Suspicion, including a second
 * report by the same NPC.
 */
function reportApproach(state: WorldState, npc: NpcId): WorldState {
  const beliefs = state.hostile.beliefs;
  const reported = beliefs.suspectedApproaches ?? [];
  const suspectedApproaches = reported.includes(npc)
    ? reported
    : [...reported, npc];
  const coverSuspicion = clampUnit(
    revealTruth(state.player.coverSuspicion) + PITCH_REPORTED_COVER_SUSPICION,
  );
  return {
    ...state,
    hostile: { ...state.hostile, beliefs: { ...beliefs, suspectedApproaches } },
    player: { ...state.player, coverSuspicion: asTruth(coverSuspicion) },
  };
}

// ---------------------------------------------------------------------------
// applyDialogueTurn (Req 15.5, 15.6, 15.7, 15.8)
// ---------------------------------------------------------------------------

/**
 * Apply one classified dialogue line to the Draft (design: `applyDialogueTurn`;
 * Req 15.5–15.8). See the module notes for the three steps, the Contact Channel
 * rule and the contract.
 *
 * @param draft the turn's Draft World State.
 * @param scene the open Talk Scene (`draft.player.scene`).
 * @param input the player's line, its classified Intent and any offer.
 * @param rng the runtime PRNG. A pitch draws from it once.
 * @param weights the scenario's `recruitment.pitch` weights.
 * @returns the next Draft, the pitch outcome for a pitch, and the turn's events.
 * @throws RangeError for an invalid offer, or a money-pitch offer the Budget
 *   cannot cover.
 * @throws Error when the scene NPC does not exist.
 */
/** Add an NPC to the player's contacts and known set (idempotent). */
function withContact(state: WorldState, npc: NpcId): WorldState {
  const contacts = state.player.contacts.includes(npc)
    ? state.player.contacts
    : [...state.player.contacts, npc];
  const entities = state.player.known.entities.includes(npc)
    ? state.player.known.entities
    : [...state.player.known.entities, npc];
  if (contacts === state.player.contacts && entities === state.player.known.entities) {
    return state;
  }
  return {
    ...state,
    player: {
      ...state.player,
      contacts,
      known: { ...state.player.known, entities },
    },
  };
}

export function applyDialogueTurn(
  draft: WorldState,
  scene: TalkScene,
  input: DialogueTurnInput,
  rng: Prng,
  weights: PitchWeights,
): DialogueTurnResult {
  const npcId = scene.npc;
  const npc = draft.npcs[npcId];
  if (npc === undefined) {
    throw new Error(`applyDialogueTurn: the scene NPC ${npcId} does not exist`);
  }
  const offer = input.offer ?? 0;
  if (!Number.isFinite(offer) || offer < 0) {
    throw new RangeError(
      `applyDialogueTurn: an offer must be a finite, non-negative amount, got ${offer}`,
    );
  }

  // 1. The Intent moves trust and suspicion (Req 15.5). A development line
  // counts as one meeting on this day.
  let rel = noteMeeting(
    applyIntent(sceneRelationship(draft, npcId), input.intent),
    draft.time.day,
    input.intent,
  );
  let state = draft;
  let pitch: PitchOutcome | undefined;

  // 2. A pitch headquarters has approved draws the recruitment coin (Req 15.6).
  // An earlier pitch is heard as pressure only: no coin, no payment, no recruit.
  const lever = pitchLever(input.intent);
  if (lever === 'money' && offer > 0 && !offerCovered(state, offer, npcId)) {
    throw new RangeError(
      `applyDialogueTurn: the Budget cannot cover an offer of ${offer}; ` +
        'the facade must reject the offer before classification',
    );
  }
  if (lever !== undefined && pitchAllowed(rel)) {
    // Only a money pitch takes the offer: it is paid whether or not the pitch
    // lands, and it scales the money lever (Req 15.7). An early pitch pays nothing.
    const moneyOffer = lever === 'money' ? offer : 0;
    if (moneyOffer > 0) {
      state = debitOffer(state, moneyOffer, npcId);
    }
    pitch = resolvePitch(npc, rel, lever, moneyOffer, weights, rng);
    if (pitch.accepted) {
      // Recruiting someone includes agreeing how to reach them, so an accepted
      // pitch opens the Contact Channel the new Asset is tasked over.
      const standing = rel.standing ?? standingAppointment(npcId, draft);
      rel = {
        ...rel,
        recruited: true,
        channel: true,
        asset: rel.asset ?? assetProfileFor(npc, draft.npcs),
        ...(standing === undefined ? {} : { standing }),
      };
      state = withContact(state, npcId);
    } else {
      // A refusal raises the NPC's suspicion; a bad one is reported (Req 15.8).
      rel = {
        ...rel,
        suspicion: clampUnit(rel.suspicion + pitch.suspicionDelta),
      };
      if (pitch.reported) {
        state = reportApproach(state, npcId);
      }
    }
  }

  // 3. The player's line joins the scene's recent turns.
  const nextScene: TalkScene = {
    ...scene,
    recent: appendRecentTurn(scene.recent, {
      speaker: 'player',
      text: input.line,
    }),
  };

  return {
    state: {
      ...state,
      relationships: { ...state.relationships, [npcId]: rel },
      player: { ...state.player, scene: nextScene },
    },
    ...(pitch === undefined ? {} : { pitch }),
    events: [],
  };
}

/** Lines that develop a person. One such line per day counts as a meeting. */
const DEVELOPMENT_INTENTS: ReadonlySet<Intent> = new Set([
  'ask',
  'probe',
  'reassure',
  'small-talk',
]);

/** Whether headquarters will hear a pitch against this relationship. */
export function pitchAllowed(rel: Relationship): boolean {
  return (rel.meetings ?? 0) >= MEETINGS_BEFORE_PITCH && rel.pitchApproved === true;
}

/** Count one development meeting on `day`, and ignore a second line the same day. */
function noteMeeting(rel: Relationship, day: number, intent: Intent): Relationship {
  if (!DEVELOPMENT_INTENTS.has(intent) || rel.lastMeetingDay === day) {
    return rel;
  }
  return {
    ...rel,
    meetings: (rel.meetings ?? 0) + 1,
    lastMeetingDay: day,
  };
}
