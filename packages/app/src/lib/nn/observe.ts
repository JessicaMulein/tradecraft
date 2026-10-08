/**
 * Build one observation from the Player View.
 *
 * Ground truth stays in the engine. This module reads the status bar, the
 * Case File, the map, the people list, documents and intercepts, plus whether
 * a talk scene is open (the conversation the player is in). A collected
 * intercept is offered for decrypt only after {@link breakTraffic} recovers a
 * field message from the Workbench: the ciphertext, a fixed-header crib, a
 * reused pad's other capture, and public texts the player can open.
 */

import type {
  Action,
  EntityId,
  GameTime,
  KeySubmission,
} from '@tradecraft/engine';
import type { PlayerViewEngine } from '@tradecraft/player-view';

import type { ScriptedGame } from '../scripted-games.js';
import {
  breakTraffic,
  type ReadableText,
  type TrafficCopy,
} from './cryptanalysis.js';
import {
  encodeAction,
  encodeState,
  SAY_INTENTS,
  type ActionContext,
  type CrowdName,
  type PresetName,
  type SayIntent,
  type StateContext,
} from './features.js';

/** How recently a stakeout still counts as "already watched". */
export const RECENT_PHASES = 8;

/** What the driver remembers between turns. The player could keep the same notes. */
export interface AgentMemory {
  lastInterceptOrdinal: number;
  readonly traced: Set<string>;
  /** Location id to the ordinal it was last surveilled. */
  readonly surveilledAt: Map<string, number>;
  readonly approachesByDay: Map<number, number>;
  /** Plaintext submissions worked out from the Workbench. */
  readonly solved: Map<string, KeySubmission>;
  /** Intercepts whose Caesar, Vigenère, and columnar attempts are finished. */
  readonly structureTried: Set<string>;
  /** Public-text ids already tried as a book key, per intercept. */
  readonly booksTried: Map<string, Set<string>>;
  /** Pad-reuse attempts, keyed by the partner capture and the cribs in hand. */
  readonly padTried: Map<string, string>;
}

export function freshMemory(): AgentMemory {
  return {
    lastInterceptOrdinal: -1000,
    traced: new Set(),
    surveilledAt: new Map(),
    approachesByDay: new Map(),
    solved: new Map(),
    structureTried: new Set(),
    booksTried: new Map(),
    padTried: new Map(),
  };
}

export function ordinalOf(time: GameTime): number {
  return time.day * 4 + time.phase;
}

export type Move =
  | {
      readonly type: 'act';
      readonly action: Action;
      /** The plaintext worked out for a decrypt, when this move is one. */
      readonly submission?: KeySubmission;
    }
  | {
      readonly type: 'say';
      readonly intent: SayIntent;
      readonly offer?: number;
    }
  | { readonly type: 'end-scene' };

export interface ActionView {
  readonly move: Move;
  readonly context: ActionContext;
  readonly vec: Float64Array;
}

export interface Observation {
  readonly state: StateContext;
  readonly stateVec: Float64Array;
  readonly actions: readonly ActionView[];
}

const SKIPPED = new Set([
  'task',
  'pay',
  'turn-agent',
  'feed',
  'service-drop',
  'arrange-meeting',
  'confront',
]);

function isStation(type: string): boolean {
  return type === 'station-hq' || type.endsWith('/station-hq');
}

function crowdOf(value: string): CrowdName {
  if (
    value === 'sparse' ||
    value === 'busy' ||
    value === 'packed' ||
    value === 'empty'
  ) {
    return value;
  }
  return 'empty';
}

function rapportOf(band: string | undefined): number {
  if (band === 'cold') return 0.2;
  if (band === 'warm') return 0.7;
  if (band === 'trusted') return 0.9;
  return 0.45;
}

function hostile(affiliation: string | undefined): boolean {
  return affiliation === 'hostile' || affiliation === 'cell';
}

function recently(memory: AgentMemory, id: string, ordinal: number): boolean {
  const at = memory.surveilledAt.get(id);
  return at !== undefined && ordinal - at < RECENT_PHASES;
}

function targetOf(action: Action): string | undefined {
  switch (action.kind) {
    case 'talk':
    case 'approach':
    case 'pay':
    case 'confront':
    case 'arrest':
    case 'turn-agent':
    case 'arrange-meeting':
      return action.npc;
    case 'follow':
      return action.target;
    case 'task':
    case 'feed':
      return action.asset;
    case 'cable':
      return action.body.kind === 'trace' ? action.body.target : undefined;
    default:
      return undefined;
  }
}

/** Record a move the player would remember: a sweep, a stakeout, a trace, an approach. */
export function remember(
  memory: AgentMemory,
  move: Move,
  time: GameTime,
): void {
  if (move.type !== 'act') return;
  const ordinal = ordinalOf(time);
  const action = move.action;
  if (action.kind === 'intercept') memory.lastInterceptOrdinal = ordinal;
  if (action.kind === 'surveil') memory.surveilledAt.set(action.at, ordinal);
  if (action.kind === 'approach') {
    memory.approachesByDay.set(
      time.day,
      (memory.approachesByDay.get(time.day) ?? 0) + 1,
    );
  }
  if (action.kind === 'cable' && action.body.kind === 'trace') {
    memory.traced.add(action.body.target);
  }
}

/** The observation at the start of a decision, including every legal move. */
export function observe(
  game: ScriptedGame,
  preset: PresetName,
  memory: AgentMemory,
): Observation {
  const engine = game.api as PlayerViewEngine;
  const status = game.api.status();
  const here = game.api.views.here();
  const people = game.api.views.people().people;
  const claims = game.api.caseFile.list({});
  const docs = game.api.views.documents().documents;
  const intercepts = game.api.views.intercepts().intercepts;
  const scene = engine.state.player.scene;
  const ordinal = ordinalOf(status.time);

  const evidence = new Map<string, number>();
  const ev = (id: string): number => {
    const hit = evidence.get(id);
    if (hit !== undefined) return hit;
    const n = game.api.caseFile.evidence(id as EntityId);
    evidence.set(id, n);
    return n;
  };

  let best: { id: string; evidence: number; claims: number } | undefined;
  let holders = 0;
  for (const person of people) {
    const score = ev(person.id);
    if (score > 0) holders += 1;
    if (
      best === undefined ||
      score > best.evidence ||
      (score === best.evidence && person.claimsAsSubject > best.claims) ||
      (score === best.evidence &&
        person.claimsAsSubject === best.claims &&
        person.id < best.id)
    ) {
      best = { id: person.id, evidence: score, claims: person.claimsAsSubject };
    }
  }

  const places = new Map<string, { risk: number; station: boolean }>();
  for (const district of game.api.views.map().districts) {
    for (const loc of district.locations) {
      places.set(loc.id, { risk: loc.risk, station: isStation(loc.type) });
    }
  }

  const claimLocs = new Map<string, number>();
  for (const claim of claims) {
    const ids = new Set<string>();
    if (claim.prop.place !== undefined) ids.add(claim.prop.place);
    if (
      typeof claim.prop.object === 'string' &&
      claim.prop.object.startsWith('loc:')
    ) {
      ids.add(claim.prop.object);
    }
    for (const id of ids) claimLocs.set(id, (claimLocs.get(id) ?? 0) + 1);
  }
  let maxMentions = 0;
  for (const n of claimLocs.values()) if (n > maxMentions) maxMentions = n;
  const weight = (id: string): number => {
    const n = claimLocs.get(id) ?? 0;
    return maxMentions === 0 ? 0 : n / maxMentions;
  };

  const byId = new Map<string, (typeof people)[number]>(
    people.map((person) => [person.id, person]),
  );
  const visible = new Set<string>(here.visible.map((person) => person.id));
  const unreadIds = new Set(
    docs.filter((doc) => !doc.read).map((doc) => doc.id),
  );
  const breakable = refreshBreaks(game, memory);

  const linesInScene =
    scene?.recent.filter((turn) => turn.speaker === 'player').length ?? 0;
  const partner = scene === undefined ? undefined : byId.get(scene.npc);
  const bestId = best?.id;

  const state: StateContext = {
    preset,
    day: status.time.day,
    phase: status.time.phase,
    budget: status.budget,
    standing: status.standing,
    hereRisk: here.location.risk,
    crowd: crowdOf(here.crowd),
    atStation: isStation(here.location.type),
    sceneOpen: scene !== undefined,
    linesInScene,
    unread: unreadIds.size,
    claims: claims.length,
    maxEvidence: best?.evidence ?? 0,
    arrestThreshold: engine.state.meta.preset.arrest.threshold,
    evidenceHolders: holders,
    corroborated: claims.filter((claim) => claim.relation === 'corroborated')
      .length,
    intercepts: intercepts.length,
    breakable,
    assets: people.filter((person) => person.asset).length,
    people: people.length,
    visible: here.visible.length,
    journal: game.api.views.journal().entries.length,
    hereInClaims: claimLocs.has(here.location.id),
    hereSurveilledRecently: recently(memory, here.location.id, ordinal),
    phasesSinceIntercept: ordinal - memory.lastInterceptOrdinal,
    topSuspectTraced: bestId !== undefined && memory.traced.has(bestId),
    approachesToday: memory.approachesByDay.get(status.time.day) ?? 0,
  };

  const actions: ActionView[] = [];
  const blank = (
    kind: string,
    patch: Partial<ActionContext>,
  ): ActionContext => ({
    kind,
    phases: 0,
    money: 0,
    countersurveillance: false,
    destRisk: here.location.risk,
    destStation: false,
    destClaimWeight: 0,
    destSurveilledRecently: false,
    targetEvidence: 0,
    targetIsBest: false,
    targetClaims: partner?.claimsAsSubject ?? 0,
    targetAsset: partner?.asset ?? false,
    targetRapport: rapportOf(partner?.rapport),
    targetVisible: true,
    targetHostile: hostile(partner?.apparentAffiliation),
    unreadRead: false,
    breakableDecrypt: false,
    cableTraceBest: false,
    cableFunds: false,
    riskyDirectTravel: false,
    waitPhases: 0,
    ...patch,
  });

  if (scene !== undefined) {
    const offer =
      status.budget >= 5
        ? Math.min(15, Math.floor(status.budget / 2))
        : undefined;
    const end = blank('end-scene', {});
    // Three lines is as long as the teacher stays. Past that the only move is
    // to leave, so a half-trained policy cannot talk the clock out.
    if (linesInScene >= 3) {
      actions.push({
        move: { type: 'end-scene' },
        context: end,
        vec: encodeAction(end),
      });
      return { state, stateVec: encodeState(state), actions };
    }
    for (const intent of SAY_INTENTS) {
      const context = blank(`say-${intent}`, {
        money: intent === 'pitch-money' ? (offer ?? 0) : 0,
      });
      const move: Move =
        intent === 'pitch-money' && offer !== undefined
          ? { type: 'say', intent, offer }
          : { type: 'say', intent };
      actions.push({ move, context, vec: encodeAction(context) });
    }
    actions.push({
      move: { type: 'end-scene' },
      context: end,
      vec: encodeAction(end),
    });
  } else {
    for (const option of game.api.actions()) {
      if (!option.quote.allowed) continue;
      const action = option.action;
      if (SKIPPED.has(action.kind)) continue;
      if (action.kind === 'cable' && action.body.kind === 'report') continue;
      if (action.kind === 'wait' && action.phases !== 1) continue;
      const submission =
        action.kind === 'decrypt'
          ? memory.solved.get(action.intercept)
          : undefined;
      if (action.kind === 'decrypt' && submission === undefined) continue;
      // A sweep that just ran has nothing new on the air. Offering it again
      // lets a policy sit at the Station and collect the same silence.
      if (
        action.kind === 'intercept' &&
        ordinal - memory.lastInterceptOrdinal < RECENT_PHASES
      ) {
        continue;
      }

      const target = targetOf(action);
      const person = target === undefined ? undefined : byId.get(target);
      const dest =
        action.kind === 'travel'
          ? action.to
          : action.kind === 'surveil'
            ? action.at
            : undefined;
      const place = dest === undefined ? undefined : places.get(dest);
      const destRisk =
        place?.risk ?? (dest === undefined ? here.location.risk : 0.5);
      const context: ActionContext = {
        kind: action.kind,
        phases: option.quote.phases,
        money: option.quote.money,
        countersurveillance:
          action.kind === 'travel' && action.countersurveillance,
        destRisk,
        destStation: place?.station ?? false,
        destClaimWeight: dest === undefined ? 0 : weight(dest),
        destSurveilledRecently:
          dest !== undefined && recently(memory, dest, ordinal),
        targetEvidence: target === undefined ? 0 : ev(target),
        targetIsBest: target !== undefined && target === bestId,
        targetClaims: person?.claimsAsSubject ?? 0,
        targetAsset: person?.asset ?? false,
        targetRapport: rapportOf(person?.rapport),
        targetVisible: target !== undefined && visible.has(target),
        targetHostile: hostile(person?.apparentAffiliation),
        unreadRead: action.kind === 'read' && unreadIds.has(action.doc),
        breakableDecrypt: action.kind === 'decrypt',
        cableTraceBest:
          action.kind === 'cable' &&
          action.body.kind === 'trace' &&
          action.body.target === bestId,
        cableFunds: action.kind === 'cable' && action.body.kind === 'funds',
        riskyDirectTravel:
          action.kind === 'travel' &&
          !action.countersurveillance &&
          destRisk >= 0.45,
        waitPhases: action.kind === 'wait' ? action.phases : 0,
      };
      actions.push({
        move:
          submission === undefined
            ? { type: 'act', action }
            : { type: 'act', action, submission },
        context,
        vec: encodeAction(context),
      });
    }
  }

  return { state, stateVec: encodeState(state), actions };
}

/** Break whatever the Workbench now gives up, and count the solved captures. */
function refreshBreaks(game: ScriptedGame, memory: AgentMemory): number {
  const copies = trafficOf(game);
  const library = libraryOf(game);
  const knownIds = knownIdsOf(game);
  let breakable = 0;
  for (const traffic of copies) {
    solveOne(memory, traffic, library, copies, knownIds);
    if (memory.solved.has(traffic.id)) breakable += 1;
  }
  return breakable;
}

function solveOne(
  memory: AgentMemory,
  traffic: TrafficCopy,
  library: readonly ReadableText[],
  copies: readonly TrafficCopy[],
  knownIds: readonly string[],
): void {
  if (memory.solved.has(traffic.id)) return;
  if (traffic.padReuseWith !== undefined) {
    const key = `${traffic.padReuseWith}\n${[...knownIds].sort().join('\n')}`;
    if (memory.padTried.get(traffic.id) === key) return;
    memory.padTried.set(traffic.id, key);
    const result = breakTraffic(traffic, [], copies, knownIds);
    if (result !== undefined) memory.solved.set(traffic.id, result.submission);
    return;
  }
  if (!memory.structureTried.has(traffic.id)) {
    memory.structureTried.add(traffic.id);
    const result = breakTraffic(traffic, [], [], [], 'structure');
    if (result !== undefined) {
      memory.solved.set(traffic.id, result.submission);
      return;
    }
  }
  const tried = memory.booksTried.get(traffic.id) ?? new Set<string>();
  const fresh = library.filter((text) => !tried.has(text.id));
  if (fresh.length === 0) return;
  for (const text of fresh) tried.add(text.id);
  memory.booksTried.set(traffic.id, tried);
  const result = breakTraffic(traffic, fresh, [], [], 'books');
  if (result !== undefined) memory.solved.set(traffic.id, result.submission);
}

function trafficOf(game: ScriptedGame): TrafficCopy[] {
  const copies: TrafficCopy[] = [];
  for (const row of game.api.views.intercepts().intercepts) {
    const bench = game.api.views.workbench(row.id);
    if (bench === undefined) continue;
    const error = bench.tradecraftError;
    copies.push({
      id: bench.id,
      ciphertext: bench.ciphertext,
      ...(bench.header !== undefined ? { header: bench.header } : {}),
      ...(error?.kind === 'pad-reuse' ? { padReuseWith: error.with } : {}),
    });
  }
  return copies;
}

function libraryOf(game: ScriptedGame): ReadableText[] {
  const library: ReadableText[] = [];
  for (const doc of game.api.views.documents().documents) {
    if (doc.kind !== 'public-text') continue;
    const body = game.api.views.document(doc.id)?.body;
    if (body === undefined || body.length === 0) continue;
    library.push({ id: doc.id, body });
  }
  return library;
}

function knownIdsOf(game: ScriptedGame): string[] {
  const ids = new Set<string>();
  for (const person of game.api.views.people().people) ids.add(person.id);
  for (const district of game.api.views.map().districts) {
    for (const loc of district.locations) ids.add(loc.id);
  }
  for (const claim of game.api.caseFile.list({})) {
    addId(ids, claim.prop.subject);
    addId(ids, claim.prop.object);
    addId(ids, claim.prop.place);
    addId(ids, claim.prop.instrument);
  }
  return [...ids];
}

function addId(ids: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.includes(':')) ids.add(value);
}
