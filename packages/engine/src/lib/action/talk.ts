/**
 * The talk and approach (Cold Approach) actions (design, "Action Resolver" →
 * **Talk** / **Approach**; "Recruitment" → `firstContact`; Requirements 22.1,
 * 22.2, 22.3, 22.4, 22.5).
 *
 * Both actions put the player face to face with an NPC at their current
 * Location:
 *
 * ## Talk (Req 22.1)
 *
 * `{ kind:'talk'; npc: NpcId | UnkId }` — speak with an NPC the player can see.
 * It requires the NPC to be **present** at the player's current Location this
 * phase (Req 22.1); if they are not, the quote is `allowed: false`. On success
 * it **opens** the Dialogue Loop — but the LLM dialogue machinery is a later
 * task, so `resolveTalk` does not run it: it returns an {@link ActionResult}
 * whose `openScene` carries the {@link TalkSceneRequest} signalling a scene
 * should open, plus a plain scene-opened Fact Line. Talk creates no Contact
 * Channel (it needs presence, not a channel) and draws no randomness.
 *
 * ## Approach — Cold Approach (Req 22.2, 22.3, 22.4, 22.5)
 *
 * `{ kind:'approach'; npc: NpcId | UnkId }` — a **first** contact with an NPC
 * the player has no Contact Channel to. It requires the NPC to be present AND
 * the player to have no existing Contact Channel to them (an existing contact
 * should `talk`, not `approach`). The approach succeeds with probability
 * `σ(a·coverFit − b·wariness − c·suspicion + d·persona.openness)` drawn on the
 * runtime PRNG (the pure {@link firstContact} primitive in
 * `../recruit/first-contact.ts`; Req 22.2, 22.3). The `{a,b,c,d}` weights are
 * the scenario config's `recruitment.firstContact` weights, read with
 * {@link firstContactWeightsOf}; `suspicion` is the player's current Cover
 * Suspicion.
 *
 * - **Success** (Req 22.4): opens talk (`openScene`) *and* creates a Contact
 *   Channel to the NPC — the simplest faithful representation is adding the NPC
 *   to `player.contacts` (and to `player.known.entities` if not already there,
 *   so the newly-reached NPC is a known entity). A success Fact Line shows.
 * - **Failure** (Req 22.5): a fixed brush-off Fact Line ({@link BRUSH_OFF_LINE})
 *   shows and the player's Cover Suspicion rises by {@link APPROACH_SUSPICION_DELTA},
 *   clamped into `[0, 1]`. No Contact Channel is created.
 *
 * ## Contact Channels
 *
 * A Contact Channel is the lightweight relationship marker that lets the player
 * arrange meetings / talk remotely with an NPC. The Starting Brief's `contacts`
 * are the player's starting Contact Channels (`WorldState.player.contacts`), so
 * the model here is: the player has a Contact Channel to an NPC exactly when the
 * NPC is in `player.contacts`. {@link hasContactChannel} is that predicate,
 * exported so task 11.5 (arrange-meeting, which "Requires a Contact Channel")
 * reuses it; {@link addContactChannel} mints one by adding the NPC to
 * `player.contacts` (and the known set).
 *
 * ## Purity and the Truth boundary
 *
 * `quoteTalk` / `quoteApproach` are pure and draw nothing. `resolveTalk` draws
 * nothing. `resolveApproach` draws exactly one coin — the {@link firstContact}
 * success — from the passed {@link Prng}, so the same inputs always yield the
 * same outcome. A `unk:` target resolves through the Truth Store (`ctx.truth`)
 * or the player's own allocation table, exactly as follow does in `./surveil.ts`.
 * Fact Line rendering is left to the caller (a `render` callback), so this
 * module never imports `./action.ts` and no import cycle forms.
 */

import {
  asTruth,
  revealTruth,
  type LocId,
  type NpcId,
  type UnkId,
} from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { Prng } from '../prng/prng.js';
import { scheduledLocation } from '../city/npc.js';
import { CONTENT_WEEKDAYS, weekdayForDay } from '../city/time-mapping.js';
import type { TruthReader } from '../truth/truth.js';
import {
  firstContact,
  type FirstContactNpc,
  type FirstContactWeights,
} from '../recruit/first-contact.js';
import type { ActionQuote, ActionResult, Observation } from './result.js';
import type { ApproachAction, TalkAction } from './types.js';

// ---------------------------------------------------------------------------
// Constants (Req 22.5)
// ---------------------------------------------------------------------------

/** The fixed brush-off Fact Line a failed Cold Approach plays (Req 22.5). */
export const BRUSH_OFF_LINE =
  'They give you a cool nod and turn away before you can begin.';

/** The Fact Line a successful talk / approach scene opens with. */
export const TALK_SCENE_LINE = 'You fall into conversation.';

/**
 * How much a failed Cold Approach raises the player's Cover Suspicion (Req
 * 22.5). A documented default (mirroring surveil's `DETECTION_SUSPICION_DELTA`)
 * until a preset field drives it; one brush-off moves Cover Suspicion by this
 * much, clamped into `[0, 1]`.
 */
export const APPROACH_SUSPICION_DELTA = 0.05;

/** The phase cost of a talk / approach: it consumes the current phase. */
export const TALK_PHASE_COST = 1;

// ---------------------------------------------------------------------------
// Shared helpers (scheduling, suspicion, scene, Contact Channels)
// ---------------------------------------------------------------------------

/**
 * The NPCs scheduled at a Location at the current time, by id in deterministic
 * order. A local copy of `./action.ts`'s `visibleNpcsAt` so this module does
 * not import `./action.ts` (which imports *this* module to route the actions)
 * and form a cycle — the same local-helper pattern `./surveil.ts` uses.
 */
function npcsScheduledAt(state: WorldState, locId: LocId): NpcId[] {
  const weekday = CONTENT_WEEKDAYS.indexOf(weekdayForDay(state.time.day));
  const out: NpcId[] = [];
  for (const npc of Object.values(state.npcs)) {
    if (scheduledLocation(npc.schedule, weekday, state.time.phase) === locId) {
      out.push(npc.id);
    }
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The NPC a talk/approach target denotes: a `npc:` id, or a mapped `unk:` id. */
function resolveTarget(
  state: WorldState,
  truth: TruthReader | undefined,
  target: NpcId | UnkId,
): NpcId | undefined {
  if (!target.startsWith('unk:')) {
    return state.npcs[target as NpcId] === undefined ? undefined : (target as NpcId);
  }
  // A `unk:` id resolves through the Truth Store, then the player's own
  // allocation table (view-safe reverse lookup) — exactly as follow does.
  const viaTruth = truth?.identityOf(target as UnkId);
  if (viaTruth !== undefined) {
    return revealTruth(viaTruth);
  }
  for (const [id, unk] of Object.entries(state.player.unkIds)) {
    if (unk === target) {
      return id as NpcId;
    }
  }
  return undefined;
}

/** Clamp a value into `[0, 1]` (Cover Suspicion lives in that range). */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Raise the player's Cover Suspicion by the Cold Approach brush-off delta. */
function raiseCoverSuspicion(state: WorldState): WorldState {
  const next = clamp01(revealTruth(state.player.coverSuspicion) + APPROACH_SUSPICION_DELTA);
  return {
    ...state,
    player: { ...state.player, coverSuspicion: asTruth(next) },
  };
}

/** The scene descriptor for a Location, built locally to avoid an action.ts cycle. */
function sceneDescriptorAt(state: WorldState, loc: LocId): ActionResult['scene'] {
  const place = state.city.locations[loc];
  if (place === undefined) {
    return { loc, description: '', atmosphere: [], risk: 0, visible: [] };
  }
  return {
    loc,
    description: place.description,
    atmosphere: [...place.atmosphere],
    risk: place.risk,
    visible: npcsScheduledAt(state, loc),
  };
}

// ---------------------------------------------------------------------------
// Contact Channels (Req 22.4)
// ---------------------------------------------------------------------------

/**
 * True when the player has a Contact Channel to an NPC (design, "Action
 * Resolver": arrange-meeting "Requires a Contact Channel"). A Contact Channel is
 * modelled as membership in `player.contacts`: the Starting Brief seeds the
 * starting contacts there (Req 26.1), and a successful Cold Approach adds the
 * approached NPC (Req 22.4). Exported so task 11.5 reuses the exact predicate.
 */
export function hasContactChannel(state: WorldState, npc: NpcId): boolean {
  return state.player.contacts.includes(npc);
}

/**
 * Mint a Contact Channel to an NPC (Req 22.4): add the NPC to the player's
 * `contacts`, and to `player.known.entities` if not already there (the player
 * now knows of the NPC they have reached). Idempotent — an NPC already a contact
 * returns the state unchanged. The representation is the simplest faithful one:
 * `player.contacts` already holds the starting Contact Channels, so a cold
 * approach extends the same list.
 */
export function addContactChannel(state: WorldState, npc: NpcId): WorldState {
  if (state.player.contacts.includes(npc)) {
    return state;
  }
  const known = state.player.known.entities.includes(npc)
    ? state.player.known.entities
    : [...state.player.known.entities, npc];
  return {
    ...state,
    player: {
      ...state.player,
      contacts: [...state.player.contacts, npc],
      known: { ...state.player.known, entities: known },
    },
  };
}

// ---------------------------------------------------------------------------
// The firstContact weights reader (Req 22.2)
// ---------------------------------------------------------------------------

/**
 * The `recruitment.firstContact` weights the Cold Approach σ formula uses, read
 * from the resolved scenario config on `WorldState.meta.scenario` (Req 22.2).
 * The scenario schema validates the `{a, b, c, d}` bag, so the read is total.
 */
export function firstContactWeightsOf(state: WorldState): FirstContactWeights {
  return state.meta.scenario.recruitment.firstContact;
}

/** Build the {@link FirstContactNpc} the σ formula reads from an NPC. */
function firstContactNpc(npc: WorldState['npcs'][NpcId]): FirstContactNpc {
  return {
    wariness: npc.wariness,
    openness: npc.persona.openness,
    archetype: npc.archetype,
  };
}

// ---------------------------------------------------------------------------
// Talk (Req 22.1)
// ---------------------------------------------------------------------------

/**
 * Quote a {@link TalkAction} (pure, no draws). The target must resolve to a real
 * NPC (a `npc:` id, or a `unk:` id the player has observed) and that NPC must be
 * **present** at the player's current Location this phase (Req 22.1) — talk
 * needs the person in front of the player. The cost is {@link TALK_PHASE_COST}
 * and no money. The shared Location gate in `./action.ts` handles the player's
 * Location being open and allowing `talk`.
 */
export function quoteTalk(
  state: WorldState,
  a: TalkAction,
  truth: TruthReader | undefined,
): ActionQuote {
  const npc = resolveTarget(state, truth, a.npc);
  if (npc === undefined) {
    return { allowed: false, reason: `no such person ${a.npc}`, phases: 0, money: 0 };
  }
  const here = npcsScheduledAt(state, state.player.loc);
  if (!here.includes(npc)) {
    return {
      allowed: false,
      reason: 'that person is not present to talk to',
      phases: 0,
      money: 0,
    };
  }
  return { allowed: true, phases: TALK_PHASE_COST, money: 0 };
}

/**
 * Resolve a {@link TalkAction} (design `resolve`; draws nothing). The caller
 * (`resolve`) has confirmed the action is allowed, so the NPC is present. It
 * opens a talk scene — the Dialogue Loop (the LLM machinery) is a later task, so
 * this signals the scene with `openScene: { npc }` (the {@link TalkSceneRequest})
 * and a plain scene-opened Fact Line, without running the LLM. No Contact
 * Channel is created (talk needs presence, not a channel) and the state is
 * otherwise unchanged.
 */
export function resolveTalk(
  state: WorldState,
  a: TalkAction,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
  truth?: TruthReader,
): { next: WorldState; result: ActionResult } {
  const observations: Observation[] = [{ kind: 'message', line: TALK_SCENE_LINE }];
  // An Unidentified Subject is talked to as the person they are, so the scene
  // opens on them (the Player View still names them by descriptor).
  const npc = resolveTarget(state, truth, a.npc) ?? a.npc;
  const result: ActionResult = {
    observations,
    factLines: render(state, observations),
    scene: sceneDescriptorAt(state, state.player.loc),
    openScene: { npc },
    events: [],
    claimsAdded: [],
  };
  return { next: state, result };
}

// ---------------------------------------------------------------------------
// Approach — Cold Approach (Req 22.2, 22.3, 22.4, 22.5)
// ---------------------------------------------------------------------------

/**
 * Quote an {@link ApproachAction} (pure, no draws). A Cold Approach is a *first*
 * contact: the target must resolve to a real NPC present at the player's current
 * Location this phase (Req 22.1), AND the player must have no existing Contact
 * Channel to them (an existing contact should `talk`, not `approach`;
 * {@link hasContactChannel}). The cost is {@link TALK_PHASE_COST} and no money.
 * The shared Location gate in `./action.ts` handles the player's Location being
 * open and allowing `approach`.
 */
export function quoteApproach(
  state: WorldState,
  a: ApproachAction,
  truth: TruthReader | undefined,
): ActionQuote {
  const npc = resolveTarget(state, truth, a.npc);
  if (npc === undefined) {
    return { allowed: false, reason: `no such person ${a.npc}`, phases: 0, money: 0 };
  }
  const here = npcsScheduledAt(state, state.player.loc);
  if (!here.includes(npc)) {
    return {
      allowed: false,
      reason: 'that person is not present to approach',
      phases: 0,
      money: 0,
    };
  }
  if (hasContactChannel(state, npc)) {
    return {
      allowed: false,
      reason: 'you already have a contact channel to them — talk instead',
      phases: 0,
      money: 0,
    };
  }
  return { allowed: true, phases: TALK_PHASE_COST, money: 0 };
}

/**
 * Resolve an {@link ApproachAction} (design `resolve`; draws exactly the
 * {@link firstContact} coin). The caller (`resolve`) has confirmed the action is
 * allowed, so the NPC is present and not yet a contact. It draws the Cold
 * Approach success on the passed {@link Prng}:
 *
 * - **Success** (Req 22.4): opens a talk scene (`openScene: { npc }`), creates a
 *   Contact Channel ({@link addContactChannel} — the NPC joins `player.contacts`
 *   and the known set), and shows a success Fact Line.
 * - **Failure** (Req 22.5): shows the fixed brush-off Fact Line
 *   ({@link BRUSH_OFF_LINE}) and raises the player's Cover Suspicion by
 *   {@link APPROACH_SUSPICION_DELTA}; no Contact Channel is created and no scene
 *   opens.
 *
 * The σ probability reads the NPC's wariness and persona openness, the player's
 * Cover Suspicion and the Location's cover fit against the scenario's
 * `firstContact` weights ({@link firstContactWeightsOf}). The outcome depends
 * only on those inputs and the PRNG state, so it is deterministic. Fact Line
 * rendering is left to the caller's `render`.
 */
export function resolveApproach(
  state: WorldState,
  a: ApproachAction,
  rng: Prng,
  truth: TruthReader | undefined,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
): { next: WorldState; result: ActionResult } {
  const npcId = resolveTarget(state, truth, a.npc);
  const loc = state.city.locations[state.player.loc];
  // Defensive: the caller confirmed presence, so both resolve; if not, degrade
  // to a brush-off rather than throwing.
  if (npcId === undefined || loc === undefined) {
    const observations: Observation[] = [{ kind: 'message', line: BRUSH_OFF_LINE }];
    return {
      next: state,
      result: {
        observations,
        factLines: render(state, observations),
        scene: sceneDescriptorAt(state, state.player.loc),
        events: [],
        claimsAdded: [],
      },
    };
  }

  const npc = state.npcs[npcId];
  const succeeded = firstContact(
    firstContactNpc(npc),
    state.player.cover,
    loc,
    firstContactWeightsOf(state),
    revealTruth(state.player.coverSuspicion),
    rng,
  );

  if (succeeded) {
    const next = addContactChannel(state, npcId);
    const observations: Observation[] = [{ kind: 'message', line: TALK_SCENE_LINE }];
    return {
      next,
      result: {
        observations,
        factLines: render(next, observations),
        scene: sceneDescriptorAt(next, next.player.loc),
        openScene: { npc: a.npc },
        events: [],
        claimsAdded: [],
      },
    };
  }

  // Failure: brush-off Fact Line and a rise in Cover Suspicion (Req 22.5).
  const next = raiseCoverSuspicion(state);
  const observations: Observation[] = [{ kind: 'message', line: BRUSH_OFF_LINE }];
  return {
    next,
    result: {
      observations,
      factLines: render(next, observations),
      scene: sceneDescriptorAt(next, next.player.loc),
      events: [],
      claimsAdded: [],
    },
  };
}
