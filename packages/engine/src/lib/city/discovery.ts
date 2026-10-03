/**
 * The discovery-path verifier: step 10 of the world generator's core stream
 * (design, "World Generator", step 10, and "Discovery paths"; Requirements 1.4,
 * 26.3, 27.6).
 *
 * The generator must guarantee that the player can actually *solve* a generated
 * game: every **key Proposition** of the hostile operation (and, when the
 * scenario enables it, the identity of the internal mole) must be learnable by
 * two genuinely independent routes — one **human** (meet somebody who knows it)
 * and one **signal** (intercept a Channel or surveil a Location) — so no single
 * asset, officer or wire is a chokepoint the Hostile Service can close to make
 * the game unwinnable (design, Property 2; Property 19's mole clause).
 *
 * This module implements the verifier as a **pure, total function**
 * ({@link verifyDiscoveryPaths}) over the already-generated core outputs — the
 * {@link StartingBrief} (its root set), the {@link PlotState} (its stages and
 * their traces), the per-NPC {@link GeneratedKnowledge} (who knows what, and the
 * mole), the {@link GeneratedComms} (the Channels and who owns them), the
 * {@link City} (Locations and which are public) and the
 * {@link GeneratedPrincipals} / {@link GeneratedOrgs} (the Cell and the Hostile
 * Service rosters). It builds a **learnability graph** rooted at the Starting
 * Brief and, for each key Proposition, searches for two paths that share no
 * intermediate **NPC or Channel** node — one through a meeting edge, one through
 * an intercept or surveillance edge.
 *
 * ### A stage's key Propositions (design, "Discovery paths")
 *
 * A Plot Stage's **key Propositions are the ones its traces evidence**: each
 * {@link StageTrace} carries an `evidences` list of predicate ids, and a stage's
 * key Propositions are the Cell operation facts (the Plot truth pool the Cell
 * members' Knowledge Slices draw on) whose predicate appears in some trace of
 * that stage. This replaces the earlier round-robin stage→fact mapping: a stage
 * is covered only when *every* fact its own traces evidence has two disjoint
 * routes, and `MEETS_AT`, `CARRIES`, `USES_CHANNEL` and `TARGETS` are all held
 * to that bar — none is tolerated as a single-route inference.
 *
 * ### The learnability graph (design, "Discovery paths")
 *
 * The **root** is the Starting Brief's known entities, lead Claims, Channels and
 * Documents (the Cable and any Dossiers). The **edges** add knowledge:
 *
 * - **Meet** a reachable NPC → that NPC's Knowledge Slice. An NPC is *reachable*
 *   when they appear at a known Location on their schedule (every public
 *   Location is known from the root) or carry a Contact Channel (a starting
 *   contact). The intermediate node is the NPC met.
 * - **Surveil** a known Location → the events there. A fact is surveillable at a
 *   known Location either because the fact itself names that Location (its
 *   `place`), or because one of the stage's traces that evidences the fact is
 *   bound to that known Location — the trace *is* the observable event, so
 *   surveilling its Location observes the fact (design: "Surveil a known
 *   Location → events there"). The intermediate node is the Location.
 * - **Intercept** a known, *revealed* interceptable Channel (radio or numbers) →
 *   the facts its operator transmits (its owner's Knowledge Slice). The
 *   intermediate node is the Channel — intercepting it needs no meeting.
 * - **Read** an obtainable Document → its Propositions. (The brief Cable asserts
 *   the leads; the root already carries those.)
 *
 * ### A Channel is reachable only once revealed (design, task 26.7)
 *
 * The verifier no longer treats every generated Channel as reachable in
 * principle. A Channel joins the known set only when it is **revealed**:
 *
 * - the **Starting Brief** carries it (the Station's own Channels), or
 * - a reachable NPC's Knowledge Slice holds a `USES_CHANNEL` naming it (a
 *   learned `USES_CHANNEL`), or
 * - an **observed transmission** reveals it — a stage trace of transmission kind
 *   whose participant owns that interceptable Channel, so the traffic the Plot
 *   actually emits is what makes the wire known.
 *
 * This is what forces a key fact's signal route to be *earned*: a Channel the
 * player could never see traffic on, and that no reachable source names, is not
 * a route.
 *
 * ### Node-disjoint, one human + one signal (design)
 *
 * For each key Proposition there must be two paths "that share no intermediate
 * NPC or Channel", one using a **meeting** edge (human) and the other an
 * **intercept or surveillance** edge (signal). Locations, Documents and
 * Propositions may be shared; only NPC and Channel nodes must be disjoint. The
 * verifier witnesses this concretely: a {@link PathWitness} names the single
 * intermediate NPC (for a meeting), the Channel (for an intercept) or the
 * Location (for a surveillance) each route turns on, and two witnesses are
 * **disjoint** when their NPC/Channel nodes differ.
 *
 * ### The mole identity
 *
 * The **mole identity** fact (`MEMBER_OF`/`REPORTS_TO` the Hostile Service) is
 * sourced from a reachable hostile officer (human) and the hostile resident's
 * revealed interceptable Channel (signal), through distinct nodes.
 *
 * The verifier returns a structured {@link DiscoveryResult} that both the
 * generator's retry loop and the property tests read: `ok` (every Plot Stage
 * covered and, when enabled, the mole covered), the per-stage and mole
 * {@link TargetReport}s with their disjoint witnesses, the computed root set,
 * and — on failure — the first failing target. {@link discoveryPathsHold} is the
 * thin boolean predicate the `derive(seed, attempt)` retry loop drives. The
 * function makes no PRNG draws: it is a deterministic graph search, so
 * re-running it on the same world always yields the same result.
 */

import {
  type ChannelId,
  type EntityId,
  type LocId,
  type NpcId,
  type Proposition,
} from '../model/core.js';
import { type City } from './city.js';
import { scheduledLocation, type Npc } from './npc.js';
import { isInterceptableKind, type GeneratedComms } from './comms.js';
import {
  type GeneratedKnowledge,
  type KnowledgeSlice,
} from './knowledge.js';
import { type GeneratedOrgs } from './principals.js';
import { type GeneratedPrincipals } from './principals.js';
import { type PlotState, type StageState } from './plot.js';
import { type StartingBrief } from './starting-brief.js';

// ---------------------------------------------------------------------------
// Edge kinds and path witnesses
// ---------------------------------------------------------------------------

/**
 * The kind of edge a discovery route turns on (design, "Discovery paths"):
 * `meeting` is the human edge; `intercept` and `surveillance` are the signal
 * edges. `read` is included for completeness (reading an obtainable Document),
 * though the key operation facts are reached by the first three.
 */
export const DISCOVERY_EDGE_KINDS = [
  'meeting',
  'intercept',
  'surveillance',
  'read',
] as const;

/** The kind of edge a discovery route turns on. */
export type DiscoveryEdgeKind = (typeof DISCOVERY_EDGE_KINDS)[number];

/** True when an edge kind is a **human** route (a meeting). */
export function isHumanEdge(kind: DiscoveryEdgeKind): boolean {
  return kind === 'meeting';
}

/** True when an edge kind is a **signal** route (an intercept or surveillance). */
export function isSignalEdge(kind: DiscoveryEdgeKind): boolean {
  return kind === 'intercept' || kind === 'surveillance';
}

/**
 * A concrete route by which a target fact can be learned, naming the single
 * intermediate node it turns on. Exactly one of `npc` (a `meeting`), `channel`
 * (an `intercept`) or `loc` (a `surveillance`) is set, matching `edge`. Two
 * witnesses are node-disjoint on NPC/Channel when their `npc` and `channel`
 * nodes differ (a shared `loc` does not break disjointness — the design permits
 * sharing Locations).
 */
export interface PathWitness {
  readonly edge: DiscoveryEdgeKind;
  /** The NPC met, for a `meeting` edge. */
  readonly npc?: NpcId;
  /** The Channel intercepted, for an `intercept` edge. */
  readonly channel?: ChannelId;
  /** The Location surveilled, for a `surveillance` edge. */
  readonly loc?: LocId;
}

/** The NPC node a witness turns on, if any (for disjointness checks). */
function witnessNpc(w: PathWitness): NpcId | undefined {
  return w.edge === 'meeting' ? w.npc : undefined;
}

/** The Channel node a witness turns on, if any (for disjointness checks). */
function witnessChannel(w: PathWitness): ChannelId | undefined {
  return w.edge === 'intercept' ? w.channel : undefined;
}

/**
 * True when two witnesses share no intermediate **NPC or Channel** node (the
 * design's disjointness rule). A shared surveilled Location is allowed.
 */
export function witnessesDisjoint(a: PathWitness, b: PathWitness): boolean {
  const an = witnessNpc(a);
  const bn = witnessNpc(b);
  if (an !== undefined && an === bn) {
    return false;
  }
  const ac = witnessChannel(a);
  const bc = witnessChannel(b);
  if (ac !== undefined && ac === bc) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Target reports and the overall result
// ---------------------------------------------------------------------------

/** A content key for a Proposition: subject, predicate, object and place. */
export type PropKey = string;

/**
 * The key that identifies a Proposition by its *content* (subject, predicate,
 * object and place) rather than by its minted id, so a fact a Knowledge Slice
 * holds and the "same" fact built elsewhere compare equal. The object is keyed
 * by its entity id or its literal value.
 */
export function propKey(p: Proposition): PropKey {
  const obj = typeof p.object === 'string' ? p.object : `lit:${String(p.object.value)}`;
  return `${p.subject}|${p.predicate}|${obj}|${p.place ?? ''}`;
}

/** What a discovery target is: a Plot Stage's key fact, or the mole's identity. */
export type DiscoveryTargetKind = 'stage' | 'mole';

/**
 * A target that the verifier found two disjoint human/signal paths for. It
 * names the target (the Plot Stage id, or `mole`), the key {@link Proposition}
 * the paths lead to, and the two disjoint {@link PathWitness}es — one human, one
 * signal.
 */
export interface TargetReport {
  readonly kind: DiscoveryTargetKind;
  /** The Plot Stage id, for a `stage` target; `undefined` for the mole. */
  readonly stage?: string;
  /** The key fact the paths lead to. */
  readonly prop: Proposition;
  /** The human (meeting) route. */
  readonly human: PathWitness;
  /** The signal (intercept or surveillance) route. */
  readonly signal: PathWitness;
}

/**
 * A target the verifier could *not* give two disjoint human/signal paths. It
 * names which path kinds it did find, so the generator's retry loop and the
 * tests can report why a seed was rejected precisely rather than "verification
 * failed".
 */
export interface FailedTarget {
  readonly kind: DiscoveryTargetKind;
  readonly stage?: string;
  readonly prop?: Proposition;
  /** True when at least one human (meeting) route exists. */
  readonly hasHuman: boolean;
  /** True when at least one signal (intercept/surveillance) route exists. */
  readonly hasSignal: boolean;
  /** A short, human-readable reason the target failed. */
  readonly reason: string;
}

/**
 * A fact learnable by a *single* route only. Retained as part of the result
 * shape for compatibility, but in the tightened verifier (task 26.7) every key
 * Proposition a stage's traces evidence must be dual-pathed, so this list is
 * empty on an accepted world. It is populated only for an evidenced predicate
 * that resolves to no Plot truth-pool Proposition at all — a diagnostic the
 * tests can read — never as a tolerated single-route *target*.
 */
export interface SingleRouteTarget {
  readonly prop: Proposition;
  readonly witness: PathWitness;
}

/**
 * The root set of the learnability graph: the Starting Brief's known entities,
 * lead Claims (as content keys), Channels and Documents (the Cable and
 * Dossiers). Property 19's rootedness clause reads exactly this.
 */
export interface DiscoveryRoot {
  readonly entities: ReadonlySet<EntityId>;
  readonly channels: ReadonlySet<ChannelId>;
  readonly documents: ReadonlySet<string>;
  /** The content keys of the lead Claims the brief carries. */
  readonly leads: ReadonlySet<PropKey>;
}

/**
 * The structured result of the verifier (design, step 10). `ok` is true when
 * every Plot Stage's evidenced key facts are each dual-pathed and, when a mole
 * is enabled, the mole identity is covered — exactly the condition the retry
 * loop drives.
 *
 * - `stages` holds one {@link TargetReport} per Plot Stage per evidenced key
 *   fact, each with its two disjoint witnesses. Every Plot Stage contributes at
 *   least one report.
 * - `mole` holds the mole identity's report, present only when a mole is
 *   enabled and covered.
 * - `single` is empty on an accepted world (see {@link SingleRouteTarget}).
 * - `root` is the computed root set (Property 19 rootedness).
 * - `failure` names the first target the verifier could not cover, present only
 *   when `ok` is false.
 */
export interface DiscoveryResult {
  readonly ok: boolean;
  readonly stages: readonly TargetReport[];
  readonly mole?: TargetReport;
  readonly single: readonly SingleRouteTarget[];
  readonly root: DiscoveryRoot;
  readonly failure?: FailedTarget;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * The already-generated core outputs the verifier reads. These are exactly the
 * values the core stream produced in steps 1–8, passed in rather than
 * re-generated so the verifier stays a pure reader (and the retry loop can hand
 * it the world it just built).
 */
export interface DiscoveryInputs {
  readonly brief: StartingBrief;
  readonly plot: PlotState;
  readonly knowledge: GeneratedKnowledge;
  readonly comms: GeneratedComms;
  readonly city: City;
  readonly orgs: GeneratedOrgs;
  readonly principals: GeneratedPrincipals;
}

// ---------------------------------------------------------------------------
// Root set
// ---------------------------------------------------------------------------

/**
 * Build the learnability-graph root from the Starting Brief: its known
 * entities, its Channels, its Documents (the Cable and any Dossiers) and its
 * lead Claims (as content keys). This is the set Property 19's rootedness clause
 * asserts the verifier roots at.
 */
export function discoveryRoot(brief: StartingBrief): DiscoveryRoot {
  const entities = new Set<EntityId>(brief.knownEntities);
  // Lead-named entities and the Chief/contacts are already in knownEntities, but
  // add the lead participants defensively so a lead never names an unknown node.
  for (const lead of brief.leads) {
    entities.add(lead.prop.subject);
    if (typeof lead.prop.object === 'string') {
      entities.add(lead.prop.object);
    }
    if (lead.prop.place !== undefined) {
      entities.add(lead.prop.place);
    }
  }
  entities.add(brief.chief);
  for (const c of brief.contacts) {
    entities.add(c);
  }
  const channels = new Set<ChannelId>(brief.channels);
  const documents = new Set<string>([brief.cable, ...brief.dossiers]);
  const leads = new Set<PropKey>(brief.leads.map((l) => propKey(l.prop)));
  return { entities, channels, documents, leads };
}

// ---------------------------------------------------------------------------
// Reachability
// ---------------------------------------------------------------------------

/** The weekdays a schedule can place an NPC on (0 Monday … 6 Sunday). */
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const PHASES = [0, 1, 2, 3] as const;

/**
 * True when an NPC is **reachable** for a meeting (design): they appear at a
 * known Location on their schedule, or they are a starting contact (the player
 * holds a Contact Channel to them). The known-Location set is the public
 * Locations plus any entity already in the root — a public Location is known
 * from game start (Requirement 21.8), which is how a Cell member who shows up at
 * a café becomes meetable.
 */
function isReachable(
  npc: Npc,
  knownLocs: ReadonlySet<LocId>,
  contacts: ReadonlySet<NpcId>,
): boolean {
  if (contacts.has(npc.id)) {
    return true;
  }
  for (const weekday of WEEKDAYS) {
    for (const phase of PHASES) {
      const loc = scheduledLocation(npc.schedule, weekday, phase);
      if (loc !== undefined && knownLocs.has(loc)) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Fact sources
// ---------------------------------------------------------------------------

/** A party's slice known-fact set, keyed by content. */
function sliceKeys(slice: KnowledgeSlice): Set<PropKey> {
  return new Set(slice.known.map(propKey));
}

/**
 * The reachable NPCs whose Knowledge Slice holds a fact of the given key — the
 * **human** sources for that fact. Each is an intermediate NPC node for a
 * meeting edge.
 */
function humanSources(
  key: PropKey,
  reachable: readonly Npc[],
  knowledge: GeneratedKnowledge,
): NpcId[] {
  const out: NpcId[] = [];
  for (const npc of reachable) {
    const slice = knowledge.byNpc[npc.id]?.knowledge;
    if (slice === undefined) {
      continue;
    }
    if (sliceKeys(slice).has(key)) {
      out.push(npc.id);
    }
  }
  return out;
}

/**
 * The revealed interceptable Channels whose owner's Knowledge Slice holds a fact
 * of the given key — the **intercept** signal sources for that fact.
 * Intercepting the Channel reveals what its operator transmits (its owner's
 * slice), with the Channel as the intermediate node. Only `radio`/`numbers`
 * Channels are interceptable (Requirement 25.1), and only *revealed* Channels
 * (see {@link revealedChannels}) count.
 */
function interceptSources(
  key: PropKey,
  revealed: ReadonlySet<ChannelId>,
  comms: GeneratedComms,
  knowledge: GeneratedKnowledge,
): ChannelId[] {
  const out: ChannelId[] = [];
  for (const chanId of revealed) {
    const channel = comms.channels[chanId];
    if (channel === undefined || !isInterceptableKind(channel.kind)) {
      continue;
    }
    const owner = channel.owner;
    if (!owner.startsWith('npc:')) {
      continue;
    }
    const slice = knowledge.byNpc[owner as NpcId]?.knowledge;
    if (slice !== undefined && sliceKeys(slice).has(key)) {
      out.push(chanId);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pairing a target to two disjoint human/signal witnesses
// ---------------------------------------------------------------------------

/**
 * Try to cover a target fact with two node-disjoint witnesses — one human
 * (meeting), one signal (intercept or surveillance). Returns the pair, or
 * `undefined` with the routes that *were* found so the caller can report
 * precisely. The signal side prefers an intercept (so the disjoint NPC/Channel
 * pairing is exercised) and falls back to surveillance; a human and a signal are
 * chosen whose NPC/Channel nodes differ. `surveilLocs` are the known Locations
 * at which the fact is surveillable (its own `place`, plus any Location an
 * evidencing trace binds the fact's event to).
 */
function coverTarget(
  prop: Proposition,
  humans: readonly NpcId[],
  intercepts: readonly ChannelId[],
  surveilLocs: readonly LocId[],
  comms: GeneratedComms,
):
  | { readonly human: PathWitness; readonly signal: PathWitness }
  | { readonly human: undefined; readonly hasHuman: boolean; readonly hasSignal: boolean } {
  const hasHuman = humans.length > 0;
  const hasSignal = intercepts.length > 0 || surveilLocs.length > 0;

  // Build candidate signal witnesses (intercepts first, then surveillance).
  const signalWitnesses: PathWitness[] = [
    ...intercepts.map((channel): PathWitness => ({ edge: 'intercept', channel })),
    ...surveilLocs.map((loc): PathWitness => ({ edge: 'surveillance', loc })),
  ];

  for (const human of humans) {
    const humanWitness: PathWitness = { edge: 'meeting', npc: human };
    for (const signal of signalWitnesses) {
      if (witnessesDisjoint(humanWitness, signal)) {
        return { human: humanWitness, signal };
      }
    }
  }

  return { human: undefined, hasHuman, hasSignal };
}

// ---------------------------------------------------------------------------
// The Plot truth pool (the operation facts)
// ---------------------------------------------------------------------------

/**
 * Collect the Cell's operation Propositions from the Cell members' slices,
 * de-duplicated by content key and sorted by key, so the verifier reads a
 * stable, deterministic set of candidate key facts. These are the Plot *truth
 * pool* the Cell members' Knowledge Slices draw on; a stage's key Propositions
 * are selected from this pool by the predicates the stage's traces evidence.
 */
function operationPool(
  principals: GeneratedPrincipals,
  knowledge: GeneratedKnowledge,
): Map<PropKey, Proposition> {
  const pool = new Map<PropKey, Proposition>();
  for (const id of [...principals.cell].sort()) {
    const slice = knowledge.byNpc[id]?.knowledge;
    if (slice === undefined) {
      continue;
    }
    for (const prop of slice.known) {
      const k = propKey(prop);
      if (!pool.has(k)) {
        pool.set(k, prop);
      }
    }
  }
  return pool;
}

// ---------------------------------------------------------------------------
// The mole identity
// ---------------------------------------------------------------------------

/**
 * The mole-identity target: the fact that the mole serves the Hostile Service.
 * The verifier takes the `MEMBER_OF` the Hostile Service fact from the mole
 * assignment (`GeneratedKnowledge.mole.facts`); its two routes are a reachable
 * hostile officer who runs the mole (human) and the hostile resident's revealed
 * interceptable Channel (signal), through distinct nodes.
 */
function moleIdentityFact(knowledge: GeneratedKnowledge): Proposition | undefined {
  const mole = knowledge.mole;
  if (mole === undefined) {
    return undefined;
  }
  // Prefer the MEMBER_OF the Hostile Service fact; fall back to REPORTS_TO.
  return (
    mole.facts.find((p) => p.predicate === 'MEMBER_OF') ??
    mole.facts.find((p) => p.predicate === 'REPORTS_TO') ??
    mole.facts[0]
  );
}

/**
 * Cover the mole identity with two disjoint human/signal routes. The Hostile
 * Service runs the mole, so its officers know the mole's loyalty (human) and its
 * radio/numbers traffic carries the mole's reporting (signal). The human route
 * is a reachable hostile officer; the signal route is a revealed interceptable
 * hostile Channel. The two turn on distinct nodes (a hostile officer that is not
 * the Channel's owner), satisfying disjointness.
 */
function coverMole(
  reachableHostile: readonly Npc[],
  comms: GeneratedComms,
  revealed: ReadonlySet<ChannelId>,
):
  | { readonly human: PathWitness; readonly signal: PathWitness }
  | { readonly human: undefined; readonly hasHuman: boolean; readonly hasSignal: boolean } {
  // Signal: a revealed interceptable Channel (the resident's wire).
  const signalChannels: ChannelId[] = [];
  for (const chanId of revealed) {
    const channel = comms.channels[chanId];
    if (channel !== undefined && isInterceptableKind(channel.kind)) {
      signalChannels.push(chanId);
    }
  }
  const hasSignal = signalChannels.length > 0;
  const hasHuman = reachableHostile.length > 0;

  for (const npc of reachableHostile) {
    const humanWitness: PathWitness = { edge: 'meeting', npc: npc.id };
    for (const channel of signalChannels) {
      const signal: PathWitness = { edge: 'intercept', channel };
      if (witnessesDisjoint(humanWitness, signal)) {
        return { human: humanWitness, signal };
      }
    }
  }
  return { human: undefined, hasHuman, hasSignal };
}

// ---------------------------------------------------------------------------
// Known Locations and revealed Channels
// ---------------------------------------------------------------------------

/**
 * The set of known Locations: every public Location, plus any Location already
 * named in the root (a lead's place). A public Location is known from game start
 * (Requirement 21.8).
 */
function knownLocations(city: City, root: DiscoveryRoot): Set<LocId> {
  const out = new Set<LocId>();
  for (const loc of Object.values(city.locations)) {
    if (loc.public) {
      out.add(loc.id);
    }
  }
  for (const e of root.entities) {
    if (e.startsWith('loc:')) {
      out.add(e as LocId);
    }
  }
  return out;
}

/** The channel id a `USES_CHANNEL` Proposition names (its text-literal object). */
function usesChannelTarget(p: Proposition): ChannelId | undefined {
  if (p.predicate !== 'USES_CHANNEL') {
    return undefined;
  }
  if (typeof p.object === 'string') {
    return undefined;
  }
  if (p.object.kind === 'text') {
    return p.object.value as ChannelId;
  }
  return undefined;
}

/**
 * The **revealed** Channels: the ones the player can actually reach (design,
 * task 26.7). A Channel is revealed when
 *
 * - the Starting Brief carries it (`root.channels`), or
 * - a reachable NPC's Knowledge Slice holds a `USES_CHANNEL` naming it (a
 *   learned `USES_CHANNEL`), or
 * - an observed transmission reveals it — a stage trace of transmission kind
 *   whose participant owns that interceptable Channel.
 *
 * A Channel the player could never see traffic on, and that no reachable source
 * names, is *not* reachable in principle: it is excluded, so a key fact's signal
 * route through it does not count.
 */
function revealedChannels(
  root: DiscoveryRoot,
  reachable: readonly Npc[],
  plot: PlotState,
  comms: GeneratedComms,
  knowledge: GeneratedKnowledge,
): Set<ChannelId> {
  const out = new Set<ChannelId>(root.channels);

  // Learned USES_CHANNEL: a reachable NPC names a Channel they use.
  for (const npc of reachable) {
    const slice = knowledge.byNpc[npc.id]?.knowledge;
    if (slice === undefined) {
      continue;
    }
    for (const prop of slice.known) {
      const chan = usesChannelTarget(prop);
      if (chan !== undefined && comms.channels[chan] !== undefined) {
        out.add(chan);
      }
    }
  }

  // Observed transmission: a transmission-kind trace whose participant owns an
  // interceptable Channel reveals that Channel.
  const ownerToChannels = new Map<EntityId, ChannelId[]>();
  for (const [id, channel] of Object.entries(comms.channels) as [ChannelId, GeneratedComms['channels'][ChannelId]][]) {
    if (!isInterceptableKind(channel.kind)) {
      continue;
    }
    const list = ownerToChannels.get(channel.owner);
    if (list === undefined) {
      ownerToChannels.set(channel.owner, [id]);
    } else {
      list.push(id);
    }
  }
  for (const stage of plot.stages) {
    for (const trace of stage.traces) {
      if (trace.kind !== 'transmission') {
        continue;
      }
      for (const participant of trace.participants) {
        const chans = ownerToChannels.get(participant);
        if (chans !== undefined) {
          for (const c of chans) {
            out.add(c);
          }
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// A stage's evidenced key facts and their surveillance Locations
// ---------------------------------------------------------------------------

/**
 * The predicates a stage's traces evidence, and — per predicate — the known
 * Locations the stage's evidencing traces bind the event to (so surveilling one
 * of those Locations observes a fact of that predicate). A trace's bound place
 * is a known Location either directly (`place.kind === 'loc'`) or when its
 * target entity is a known Location. The design: a stage's key Propositions are
 * the ones its traces evidence, surveillable where those traces happen.
 */
function stageEvidence(
  stage: StageState,
  knownLocs: ReadonlySet<LocId>,
): { readonly predicates: Set<string>; readonly surveilByPredicate: Map<string, Set<LocId>> } {
  const predicates = new Set<string>();
  const surveilByPredicate = new Map<string, Set<LocId>>();
  for (const trace of stage.traces) {
    let loc: LocId | undefined;
    if (trace.place?.kind === 'loc' && knownLocs.has(trace.place.loc)) {
      loc = trace.place.loc;
    } else if (
      trace.place?.kind === 'target' &&
      trace.place.entity.startsWith('loc:') &&
      knownLocs.has(trace.place.entity as LocId)
    ) {
      loc = trace.place.entity as LocId;
    }
    for (const predicate of trace.evidences) {
      predicates.add(predicate);
      if (loc !== undefined) {
        const set = surveilByPredicate.get(predicate);
        if (set === undefined) {
          surveilByPredicate.set(predicate, new Set([loc]));
        } else {
          set.add(loc);
        }
      }
    }
  }
  return { predicates, surveilByPredicate };
}

/**
 * The known Locations at which a key fact `prop` is surveillable for a stage:
 * the fact's own `place` (when known), plus any Location the stage's evidencing
 * traces bind the fact's predicate to.
 */
function surveillanceLocsFor(
  prop: Proposition,
  surveilByPredicate: ReadonlyMap<string, ReadonlySet<LocId>>,
  knownLocs: ReadonlySet<LocId>,
): LocId[] {
  const out = new Set<LocId>();
  if (prop.place !== undefined && knownLocs.has(prop.place)) {
    out.add(prop.place);
  }
  const byTrace = surveilByPredicate.get(prop.predicate);
  if (byTrace !== undefined) {
    for (const loc of byTrace) {
      out.add(loc);
    }
  }
  return [...out].sort();
}

// ---------------------------------------------------------------------------
// The verifier
// ---------------------------------------------------------------------------

/**
 * Verify the discovery paths of a generated core world (design, step 10;
 * Requirements 1.4, 26.3, 27.6).
 *
 * Builds the learnability graph rooted at the Starting Brief and checks, for
 * each Plot Stage's evidenced key facts and (when a mole is enabled) the mole
 * identity, that two node-disjoint routes exist — one human (meeting), one
 * signal (intercept of a revealed Channel, or surveillance of a known
 * Location). Returns a {@link DiscoveryResult} whose `ok` is the retry predicate
 * the generator drives, together with the per-target witnesses, the computed
 * root set (Property 19 rootedness) and, on failure, the first failing target.
 *
 * Pure and total: it makes no PRNG draws and never throws for a well-formed
 * world, so re-running it on the same inputs always yields the same result.
 */
export function verifyDiscoveryPaths(inputs: DiscoveryInputs): DiscoveryResult {
  const { brief, plot, knowledge, comms, city, principals } = inputs;

  const root = discoveryRoot(brief);
  const knownLocs = knownLocations(city, root);
  const contacts = new Set<NpcId>(brief.contacts);

  // Reachable NPCs: anyone present at a known Location, or a starting contact.
  const reachable: Npc[] = Object.values(principals.npcs)
    .filter((npc) => isReachable(npc, knownLocs, contacts))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const revealed = revealedChannels(root, reachable, plot, comms, knowledge);
  const pool = operationPool(principals, knowledge);

  const stageReports: TargetReport[] = [];
  const single: SingleRouteTarget[] = [];
  let firstFailure: FailedTarget | undefined;

  // Each Plot Stage: cover every key fact its traces evidence with two disjoint
  // human/signal routes. A stage is covered only when all its evidenced facts
  // are. A stage whose traces evidence no truth-pool fact is a failure (its
  // operation step is not discoverable).
  for (const stage of plot.stages) {
    const { predicates, surveilByPredicate } = stageEvidence(stage, knownLocs);

    // The key facts of this stage: truth-pool Propositions whose predicate is
    // evidenced by one of the stage's traces, keyed and sorted for determinism.
    const keyFacts = [...pool.values()]
      .filter((p) => predicates.has(p.predicate))
      .sort((a, b) => (propKey(a) < propKey(b) ? -1 : propKey(a) > propKey(b) ? 1 : 0));

    if (keyFacts.length === 0) {
      if (firstFailure === undefined) {
        firstFailure = {
          kind: 'stage',
          stage: stage.id,
          hasHuman: false,
          hasSignal: false,
          reason:
            "stage traces evidence no Plot operation fact (nothing to discover)",
        };
      }
      continue;
    }

    for (const prop of keyFacts) {
      const key = propKey(prop);
      const humans = humanSources(key, reachable, knowledge);
      const intercepts = interceptSources(key, revealed, comms, knowledge);
      const surveilLocs = surveillanceLocsFor(prop, surveilByPredicate, knownLocs);
      const result = coverTarget(prop, humans, intercepts, surveilLocs, comms);
      if (result.human !== undefined) {
        stageReports.push({
          kind: 'stage',
          stage: stage.id,
          prop,
          human: result.human,
          signal: result.signal,
        });
      } else if (firstFailure === undefined) {
        firstFailure = {
          kind: 'stage',
          stage: stage.id,
          prop,
          hasHuman: result.hasHuman,
          hasSignal: result.hasSignal,
          reason: failureReason(result.hasHuman, result.hasSignal),
        };
      }
    }
  }

  // The mole identity, when a mole is enabled.
  let moleReport: TargetReport | undefined;
  const moleFact = moleIdentityFact(knowledge);
  if (moleFact !== undefined) {
    const reachableHostile = principals.hostile
      .map((id) => principals.npcs[id])
      .filter((npc): npc is Npc => npc !== undefined)
      .filter((npc) => isReachable(npc, knownLocs, contacts))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const result = coverMole(reachableHostile, comms, revealed);
    if (result.human !== undefined) {
      moleReport = {
        kind: 'mole',
        prop: moleFact,
        human: result.human,
        signal: result.signal,
      };
    } else if (firstFailure === undefined) {
      firstFailure = {
        kind: 'mole',
        prop: moleFact,
        hasHuman: result.hasHuman,
        hasSignal: result.hasSignal,
        reason: failureReason(result.hasHuman, result.hasSignal),
      };
    }
  }

  // Every Plot Stage must have contributed at least one covered report (unless
  // the Plot has no stages, in which case there is nothing to cover).
  const coveredStageIds = new Set(stageReports.map((r) => r.stage));
  const everyStageCovered = plot.stages.every((s) => coveredStageIds.has(s.id));
  const moleCovered = moleFact === undefined || moleReport !== undefined;
  const ok = firstFailure === undefined && everyStageCovered && moleCovered;

  return {
    ok,
    stages: stageReports,
    ...(moleReport === undefined ? {} : { mole: moleReport }),
    single,
    root,
    ...(ok ? {} : { failure: firstFailure ?? missingStageFailure() }),
  };
}

/** A short reason string for a failed target from the routes that were found. */
function failureReason(hasHuman: boolean, hasSignal: boolean): string {
  if (!hasHuman && !hasSignal) {
    return 'no human or signal route to the fact';
  }
  if (!hasHuman) {
    return 'only a signal route (no reachable human source)';
  }
  if (!hasSignal) {
    return 'only a human route (no intercept or surveillance source)';
  }
  return 'human and signal routes exist but share an intermediate NPC or Channel';
}

/** The fallback failure when a stage produced no covered report but none failed. */
function missingStageFailure(): FailedTarget {
  return {
    kind: 'stage',
    hasHuman: true,
    hasSignal: false,
    reason: 'a Plot Stage has no dual-pathed evidenced key fact',
  };
}

// ---------------------------------------------------------------------------
// The retry predicate (the core/noise retry loops drive this)
// ---------------------------------------------------------------------------

/**
 * The thin boolean predicate the attempt loop drives: `true` when the generated
 * world passes discovery-path verification, `false` when it must be regenerated
 * with the next core seed `derive(seed, attempt)`. Equivalent to reading
 * {@link DiscoveryResult.ok}; exposed as a named predicate so the retry loop
 * reads cleanly.
 */
export function discoveryPathsHold(inputs: DiscoveryInputs): boolean {
  return verifyDiscoveryPaths(inputs).ok;
}
