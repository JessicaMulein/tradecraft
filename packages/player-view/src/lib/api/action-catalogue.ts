/**
 * The Player-View action catalogue (slice-integration task 7.6; design, "Player
 * View: actions catalogue"; Requirements 11.1, 19.3).
 *
 * The facade's `actions()` must answer "what can I do right now, and what does
 * each cost?". {@link buildActionCatalogue} is the pure function that answers
 * it: it enumerates every *candidate* {@link Action} for the current situation —
 * read entirely from the Player View (the {@link WorldState} the facade holds,
 * the loaded content on the {@link ResolverContext}, and the Case File's
 * arrest-evidence count) — and pairs each with the engine's pure
 * {@link quote}. The catalogue only *offers* a candidate; `quote` decides
 * whether it is allowed and at what cost (and marks a disallowed one with a
 * reason), so the catalogue reveals no ground truth: it reads no Truth Store and
 * no {@link import('@tradecraft/engine').Truth}-branded field, exactly like
 * `quote` itself (design: "Each is paired with `quote`").
 *
 * ## What it enumerates (design, "Player View: actions catalogue")
 *
 * - `travel` to each known Location (the public ones, the player's own Station
 *   and any Location in the known set), with and without a countersurveillance
 *   route;
 * - `talk` and `approach` for each visible person at the current Location;
 * - `surveil` here (one phase);
 * - `follow` each visible person;
 * - `wait` for one through four phases;
 * - `read` each Document in hand (obtainable here or already read);
 * - `intercept` at the Station;
 * - `decrypt` for each collected, unbroken Intercept;
 * - `cable`: a trace for each known entity, plus a funds request and a report;
 * - `task` each running Asset across the four task kinds;
 * - `pay` each running Asset;
 * - `service-drop` each known Dead Drop;
 * - `arrest` each person the Case File holds arrest evidence against, present
 *   or not (an arrest is a Station request with no Location gate); and
 * - `wait` is always present, so the catalogue is never empty.
 *
 * Actions that need free input from the player — a decrypt submission, feed
 * items, a confront Claim, a pitch offer — are listed as *templates*: a
 * representative candidate (an empty decrypt submission, a zero-amount pay) the
 * TUI completes before it commits. The quote for a template still answers the
 * shared gate (is the action allowed here, and what does it cost), which is what
 * the catalogue is for.
 *
 * ## Purity (design: "It reads no Truth Store")
 *
 * `buildActionCatalogue` reads only its inputs: the {@link WorldState}, the
 * {@link ResolverContext} (content and, for the truth-writing resolvers, the
 * Truth draft — the same context `quote` already takes), and an `evidence`
 * lookup that is the Case File's arrest-evidence count. It mutates nothing and
 * allocates no `unk:` ids. The quote decides eligibility from view and Case File
 * data only, so the whole catalogue is truth-safe.
 */

import {
  quote as engineQuote,
  visibleNpcsAt,
  MICE_LEVERS,
  type Action,
  type ActionQuote,
  type AssetTask,
  type DocId,
  type EntityId,
  type InterceptId,
  type LocId,
  type NpcId,
  type ResolverContext,
  type UnkId,
  type WorldState,
} from '@tradecraft/engine';

import type { ActionOption } from './types.js';
import { isKnownLocation } from './views.js';

/**
 * The arrest-evidence count for an entity, as the Case File computes it
 * (`EngineApi.caseFile.evidence`). The catalogue offers an `arrest` candidate
 * for a present person only when this is positive, so a candidate is listed only
 * when the player actually has evidence to act on. A caller that cannot supply
 * it (the evidence count needs the Case File, which this pure module does not
 * import) passes a function that always returns `0`, and no `arrest` candidate
 * is offered — the catalogue still lists everything else.
 */
export type EvidenceLookup = (target: EntityId) => number;

/**
 * Build the catalogue of candidate actions for the current situation, each
 * paired with its {@link ActionQuote} (design, "Player View: actions
 * catalogue"; Requirements 11.1, 19.3).
 *
 * Pure over `(state, ctx, evidence)`: it enumerates candidates from the Player
 * View and quotes each with the engine's pure `quote`. The order is stable —
 * the enumeration below, with ids sorted where a set is iterated — so the "here"
 * panel and the TUI command surface render a deterministic list.
 */
export function buildActionCatalogue(
  state: WorldState,
  ctx: ResolverContext,
  evidence: EvidenceLookup = () => 0,
): ActionOption[] {
  const options: ActionOption[] = [];
  const add = (action: Action): void => {
    options.push({ action, quote: quoteOf(state, action, ctx) });
  };

  const here = state.player.loc;

  // travel — to each known Location, with and without a countersurveillance
  // route. The player's current Location is not a travel target.
  for (const to of knownLocations(state)) {
    if (to === here) {
      continue;
    }
    add({ kind: 'travel', to, countersurveillance: false });
    add({ kind: 'travel', to, countersurveillance: true });
  }

  // The people present at the current Location, in the engine's deterministic
  // order. talk/approach/follow are offered per person.
  const present = visibleNpcsAt(state, here);
  for (const npc of present) {
    const handle = personHandle(state, npc);
    add({ kind: 'talk', npc: handle });
    add({ kind: 'approach', npc: handle });
    add({ kind: 'follow', target: handle });
  }

  // arrest — each person the Case File holds evidence against, wherever they
  // are (design: "arrest each person with evidence"). An arrest is a request
  // the Station's officers carry out, not an action at the player's Location:
  // the engine's arrest quote has no Location gate, and decides from the
  // evidence count and the player's arrest authority alone.
  for (const target of arrestTargets(state, ctx)) {
    if (evidence(target) > 0) {
      add({ kind: 'arrest', npc: target });
    }
  }

  // surveil here (one phase) — a single candidate; the TUI offers the two-phase
  // variant by editing the phase count.
  add({ kind: 'surveil', at: here, phases: 1 });

  // wait 1–4 phases — always available, so the catalogue is never empty.
  for (const phases of [1, 2, 3, 4] as const) {
    add({ kind: 'wait', phases });
  }

  // read — each Document in hand (already read, or obtainable here).
  for (const doc of readableDocuments(state)) {
    add({ kind: 'read', doc });
  }

  // intercept — collect enemy traffic. Only meaningful at the Station (or where
  // a courier fires), but it is offered as a candidate and the quote decides.
  add({ kind: 'intercept' });

  // decrypt — each collected, unbroken Intercept, as a template with an empty
  // plaintext submission the TUI completes.
  for (const intercept of unbrokenIntercepts(state)) {
    add({
      kind: 'decrypt',
      intercept,
      submission: { kind: 'plaintext', text: '' },
    });
  }

  // cable — a trace for each known entity, plus a funds request and a report.
  for (const target of knownEntities(state)) {
    add({ kind: 'cable', body: { kind: 'trace', target } });
  }
  add({ kind: 'cable', body: { kind: 'funds' } });
  add({ kind: 'cable', body: { kind: 'report', body: '' } });

  // task and pay — each running Asset. task is offered across the four task
  // kinds (collect/introduce/service/plant), each as a template the TUI
  // completes with a target, drop or Proposition.
  for (const asset of runningAssets(state)) {
    for (const task of taskTemplatesFor(state, asset)) {
      add({ kind: 'task', asset, task });
    }
    add({ kind: 'pay', npc: asset, amount: 0 });
  }

  // turn-agent — flip a running Asset into a Double Agent, one candidate per
  // MICE lever.
  for (const asset of runningAssets(state)) {
    for (const lever of MICE_LEVERS) {
      add({ kind: 'turn-agent', npc: asset, lever });
    }
  }

  // service-drop — each known Dead Drop, as a template that leaves nothing (the
  // TUI fills the items to leave).
  for (const drop of state.player.known.drops) {
    add({ kind: 'service-drop', drop, leave: [] });
  }

  return options;
}

/**
 * Quote one candidate action, never throwing. The engine's `quote` is pure and
 * decides from view/Case File data only; this wrapper guards it so a single
 * candidate that trips an unexpected edge never aborts the whole catalogue —
 * such a candidate is reported as disallowed with a reason, which is exactly how
 * `quote` reports an ineligible action.
 */
function quoteOf(state: WorldState, action: Action, ctx: ResolverContext): ActionQuote {
  try {
    return engineQuote(state, action, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { allowed: false, reason: message, phases: 0, money: 0 };
  }
}

/**
 * The handle the player holds for a visible NPC: the stable `unk:` id when the
 * player has one allocated for an unidentified person, else the raw `npc:` id.
 * This mirrors {@link import('./views.js').personLabel}'s id choice, so the
 * catalogue's targets agree with the ids the scene and "here" panels render.
 */
function personHandle(state: WorldState, npc: NpcId): NpcId | UnkId {
  return state.player.unkIds[npc] ?? npc;
}

/**
 * The Locations the player knows, by the Map view's rule
 * ({@link isKnownLocation}): every public Location, the player's own Station
 * (where `intercept` and `cable` are allowed), and any Location id in the
 * player's known-entity set. Returned id-sorted for a stable catalogue order.
 */
function knownLocations(state: WorldState): LocId[] {
  const known = new Set<LocId>();
  for (const loc of Object.values(state.city.locations)) {
    if (isKnownLocation(state, loc.id)) {
      known.add(loc.id);
    }
  }
  return [...known].sort(compareIds);
}

/**
 * The people an arrest can name: the NPCs in the player's known-entity set, the
 * player's `unk:` handles, and every `npc:` or `unk:` id a held Claim names
 * (`ctx.claims`, the Case File projection the facade quotes against).
 * Id-sorted and de-duplicated. The catalogue offers an arrest only for those
 * the Case File holds evidence against.
 */
function arrestTargets(state: WorldState, ctx: ResolverContext): (NpcId | UnkId)[] {
  const targets = new Set<NpcId | UnkId>();
  const consider = (id: EntityId): void => {
    if (id.startsWith('npc:') || id.startsWith('unk:')) {
      targets.add(id as NpcId | UnkId);
    }
  };
  for (const id of state.player.known.entities) {
    consider(id);
  }
  for (const unk of Object.values(state.player.unkIds)) {
    consider(unk);
  }
  for (const prop of Object.values(ctx.claims ?? {})) {
    consider(prop.subject);
    if (typeof prop.object === 'string') {
      consider(prop.object);
    }
  }
  return [...targets].sort(compareIds);
}

/**
 * The entities the player knows that a trace Cable can name: the player's
 * known-entity set, id-sorted. A trace is disallowed by `quote` unless its
 * target is here, so enumerating the known set is exactly the eligible set.
 */
function knownEntities(state: WorldState): EntityId[] {
  return [...state.player.known.entities].sort(compareIds);
}

/**
 * The Documents the player can read now: those obtainable at the current
 * Location or already read (so in hand). Id-sorted for a stable order.
 */
function readableDocuments(state: WorldState): DocId[] {
  const read = new Set<DocId>(state.player.readDocuments);
  const here = state.player.loc;
  const out: DocId[] = [];
  for (const doc of Object.values(state.documents)) {
    const obtainableHere =
      doc.obtainableAt === undefined || doc.obtainableAt.includes(here);
    if (obtainableHere || read.has(doc.id)) {
      out.push(doc.id);
    }
  }
  return out.sort(compareIds);
}

/**
 * The collected Intercepts the player has not yet broken, id-sorted. A broken
 * Intercept yields nothing new on a repeat decrypt, so only the unbroken ones
 * are worth offering.
 */
function unbrokenIntercepts(state: WorldState): InterceptId[] {
  const out: InterceptId[] = [];
  for (const intercept of Object.values(state.intercepts)) {
    if (intercept.broken !== true) {
      out.push(intercept.id);
    }
  }
  return out.sort(compareIds);
}

/**
 * The player's running Assets: Relationships flipped `recruited`, id-sorted by
 * NPC. These are the people a `task`/`pay`/`turn-agent` can act on; `quote`
 * still gates each (an Asset with no Channel cannot be tasked, for instance).
 */
function runningAssets(state: WorldState): NpcId[] {
  const out: NpcId[] = [];
  for (const rel of Object.values(state.relationships)) {
    if (rel.recruited) {
      out.push(rel.npc);
    }
  }
  return out.sort(compareIds);
}

/**
 * The task templates offered for an Asset: a `collect` on each other known NPC,
 * an `introduce` of each other known NPC, a `service` of each known Dead Drop,
 * and a `plant` template. Targets are drawn from the player's known set so the
 * catalogue offers only reachable candidates; the plant Proposition is a
 * placeholder the TUI completes.
 */
function taskTemplatesFor(state: WorldState, asset: NpcId): AssetTask[] {
  const tasks: AssetTask[] = [];
  const npcTargets = knownNpcTargets(state, asset);
  for (const target of npcTargets) {
    tasks.push({ kind: 'collect', target });
    tasks.push({ kind: 'introduce', target });
  }
  // "Who is this?": a collect on each person the player has sighted but not
  // identified, named by the `unk:` id the player knows them by.
  for (const unk of sightedUnidentified(state)) {
    tasks.push({ kind: 'collect', target: unk });
  }
  for (const drop of [...state.player.known.drops].sort(compareIds)) {
    tasks.push({ kind: 'service', drop, leave: [] });
  }
  tasks.push({
    kind: 'plant',
    prop: {
      id: `prop:plant/${asset}`,
      subject: asset,
      predicate: 'core/AT_LOCATION',
      object: state.player.loc,
    },
  });
  return tasks;
}

/**
 * The other known NPCs an Asset can be tasked against or asked to introduce:
 * the `npc:` ids in the player's known-entity set, excluding the Asset itself.
 * Id-sorted for a stable order.
 */
function knownNpcTargets(state: WorldState, asset: NpcId): NpcId[] {
  const out: NpcId[] = [];
  for (const id of state.player.known.entities) {
    if (id !== asset && isNpcId(id)) {
      out.push(id as NpcId);
    }
  }
  return out.sort(compareIds);
}

/**
 * The `unk:` ids of the people the player has sighted but not identified, in
 * id order. Only the `unk:` ids are returned, never the NPC behind them.
 */
function sightedUnidentified(state: WorldState): UnkId[] {
  const known = new Set<string>(state.player.known.entities);
  const out: UnkId[] = [];
  for (const [npc, unk] of Object.entries(state.player.unkIds)) {
    if (!known.has(npc) && unk !== undefined) {
      out.push(unk);
    }
  }
  return out.sort(compareIds);
}

/** Whether an entity id names an NPC (the `npc:` namespace). */
function isNpcId(id: EntityId): boolean {
  return id.startsWith('npc:');
}

/** Order ids for a total, stable listing. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
