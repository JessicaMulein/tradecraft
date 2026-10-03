/**
 * Knowledge assignment: steps 6 and 7 of the world generator's core stream
 * (design, "World Generator", steps 6–7; Requirements 1.3, 1.5, 26.2).
 *
 * This module owns both the *shapes* of what one party knows or believes — the
 * real {@link KnowledgeSlice} interface that replaces the skeleton placeholder
 * in `../model/state.ts`, plus the {@link CoverStory} and {@link Agenda} shapes
 * — and the pure {@link assignKnowledge} that builds them for every Principal
 * NPC and for the Station, over the generated city, orgs, NPCs, Plot and comms
 * (tasks 5.1–5.4).
 *
 * The vocabulary (Glossary):
 *
 * - A **Knowledge Slice** is what one NPC (or the Station) knows or believes:
 *   the true {@link Proposition}s they hold, their false beliefs (also
 *   Propositions, but ones that do *not* hold in the Truth Store), and the
 *   entities they know of. The design's `Npc.knowledge` keeps `known` as a list
 *   of PropIds; this slice keeps the full Propositions instead (as the task
 *   fixes), so a slice is self-contained — the dialogue layer (task 14.1) can
 *   render it without a second lookup, and the discovery-path verifier (task
 *   5.8) can read the propositions directly.
 * - A **Cover Story** is the Propositions a concealed NPC presents as true about
 *   themselves (Glossary): a Cell member's cover employment, a hostile officer's
 *   diplomatic posting. These are what the NPC *says*, not what holds.
 * - An **Agenda** is what an NPC is trying to conceal or promote in
 *   conversation, plus free-text goals (design's `Npc.agenda`): the ids of the
 *   propositions in their own slice they must not reveal (`conceal`), the
 *   propositions they actively push whether true or not (`promote`), and the
 *   plain-language `goals` the dialogue layer frames the voice with.
 *
 * Knowledge is assigned **by role and stage proximity** (design, step 6):
 *
 * - A **Cell member** knows the Cell's membership facts and, by *stage
 *   proximity*, the propositions of the Plot stages they are bound to as a role
 *   (the leader knows the whole operation; the courier and radio-operator know
 *   the stages their comms serve; the financier knows the supply stages). The
 *   leader additionally knows the operation's target, materiel and plan.
 * - A **hostile officer** knows the Hostile Service's membership and the Cell it
 *   runs, and the resident knows the operation it backs.
 * - The **Chief of Station** and **Station staff** know Station things: the
 *   Station's roster, its Channels and drops, and the leads HQ has handed down
 *   (which is where the Station slice's own knowledge comes from).
 * - A **starting contact** knows city- and rumour-level things: the public
 *   Locations and a scattering of who-is-seen-where observations, the raw
 *   material of a lead.
 *
 * The **Station's Knowledge Slice** (design, step 6; Requirement 26.2) is the
 * one the Starting Brief's leads are drawn from (task 5.7), so it must include
 * **HQ false beliefs** — leads that do not actually hold — at the preset's
 * `hqFalseBeliefRate`. The slice is built from a pool of *true* leads about the
 * Cell and the Plot (so some leads are real and chase-able) with false leads
 * mixed in at the preset rate (so some leads are wrong, and the player cannot
 * trust the brief blindly). The false beliefs are honest Propositions that
 * simply do not hold in the Truth Store — a wrong Location for a meeting, a
 * wrong person named as a member.
 *
 * The **mole** (design, step 7; Requirements 1.5, 26.2 context): when the
 * scenario config enables it, one Station staff NPC is designated a Double Agent
 * inside the Station — their *true* allegiance is the Hostile Service while their
 * *apparent* allegiance stays `station`. That is ground truth: the designation
 * is returned as a {@link MoleAssignment} the caller writes into the Truth Store
 * (as the mole's `REPORTS_TO`/`MEMBER_OF` the Hostile Service, and as the
 * `Npc.trueAllegiance` the caller rewrites), and `WorldState.station.mole` holds
 * the branded id. The mole is never designated from the Chief; it is always one
 * of the staff, so the Station always has a head who is loyal.
 *
 * Determinism rests on drawing every choice from the passed {@link Prng} in a
 * fixed order over id-sorted lists, exactly as the city, principal, Plot and
 * comms generators do, so the result is a pure function of the seed and the
 * content (Requirement 1.2, underpinning Property 1 — seed determinism).
 */

import {
  revealTruth,
  type EntityId,
  type LocId,
  type NpcId,
  type OrgId,
  type Proposition,
  type PropId,
  type Truth,
  asTruth,
} from '../model/core.js';
import { type Prng } from '../prng/prng.js';
import { type Allegiance } from '../truth/truth.js';
import { type City } from './city.js';
import { type Npc } from './npc.js';
import { type GeneratedComms } from './comms.js';
import {
  CELL_ROLE_IDS,
  HOSTILE_ROLE_IDS,
  type GeneratedOrgs,
  type GeneratedPrincipals,
} from './principals.js';
import { type PlotState } from './plot.js';

// ---------------------------------------------------------------------------
// KnowledgeSlice, CoverStory, Agenda
// ---------------------------------------------------------------------------

/**
 * What one NPC (or the Station) knows or believes (Glossary; the design's
 * `knowledge` field, with full Propositions in place of PropIds). Replaces the
 * task-4.6 skeleton `KnowledgeSlice` in `../model/state.ts` under the same name,
 * so `WorldState.station.knowledge` is a `KnowledgeSlice` and every importer
 * keeps compiling.
 *
 * - `known` are the true Propositions the party holds — each one *does* hold in
 *   the Truth Store at generation time, so a dialogue voice built from the slice
 *   speaks the truth it is given.
 * - `falseBeliefs` are Propositions the party sincerely believes but that do
 *   *not* hold (an honest error, a planted rumour, an HQ mistake). The Claim
 *   Extractor (task 14.10) reads these to tell an honest error from a lie.
 * - `knownEntities` are the entities the party knows of — every subject, object
 *   and place that appears in `known`/`falseBeliefs`, plus any extra entity the
 *   party is aware of without a proposition about it. The dialogue layer's
 *   "name only entities from your list" rule reads exactly this set.
 *
 * A Knowledge Slice is *not* a Player View projection and *not* ground truth in
 * the branded sense: it is Sim structure the dialogue layer reads to voice a
 * character. The truth boundary is enforced elsewhere — the Truth Store decides
 * what `holds`, and the Leak Guard decides what may be spoken — so the slice
 * itself carries no {@link Truth} brand, matching the design's `KnowledgeSlice`.
 */
export interface KnowledgeSlice {
  /** True Propositions the party holds (each holds in the Truth Store). */
  readonly known: readonly Proposition[];
  /** Propositions the party believes but that do not hold. */
  readonly falseBeliefs: readonly Proposition[];
  /** Every entity the party knows of. */
  readonly knownEntities: readonly EntityId[];
}

/**
 * The Propositions a concealed NPC presents as true about themselves
 * (Glossary). A Cell member's cover employment, a hostile officer's cover
 * posting: what they *say* when asked, regardless of what holds. Only concealed
 * NPCs (Cell members, hostile officers, and the mole) carry a non-empty cover
 * story; an open contact or an ordinary staffer has none.
 */
export interface CoverStory {
  /** The Propositions the NPC presents as true about themselves. */
  readonly presents: readonly Proposition[];
}

/**
 * What an NPC is trying to conceal or promote in conversation (the design's
 * `Npc.agenda`).
 *
 * - `conceal` are the ids of propositions in the NPC's own slice they must not
 *   reveal — their real allegiance, the operation's target. The dialogue layer
 *   and the Leak Guard read these to keep a concealed NPC from giving
 *   themselves away.
 * - `promote` are propositions the NPC actively pushes, true or not — a cover
 *   employment, a misdirection. A promoted proposition that does not hold is a
 *   lie the Claim Extractor flags (task 14.10).
 * - `goals` are plain-language aims the dialogue voice is framed with.
 */
export interface Agenda {
  /** Ids of the NPC's own propositions they must not reveal. */
  readonly conceal: readonly PropId[];
  /** Propositions the NPC actively pushes (true or not). */
  readonly promote: readonly Proposition[];
  /** Plain-language conversational goals. */
  readonly goals: readonly string[];
}

/**
 * Everything knowledge assignment produces for one NPC: their Knowledge Slice,
 * their Cover Story (empty for an open NPC) and their Agenda. The caller threads
 * these onto the NPC (task 5.9) — the design puts `knowledge`, `coverStory` and
 * `agenda` on `Npc`, but task 5.5 keeps them in a separate returned map so the
 * {@link Npc} shape stays as task 5.2 wrote it; task 5.9 decides where they
 * finally live.
 */
export interface NpcKnowledge {
  readonly knowledge: KnowledgeSlice;
  readonly cover: CoverStory;
  readonly agenda: Agenda;
}

/**
 * The mole designation (design, step 7; Requirement 1.5). When the scenario
 * enables the mole, one Station staff NPC is a Double Agent whose true
 * allegiance is the Hostile Service. This is ground truth the caller writes into
 * the Truth Store and reflects on the NPC:
 *
 * - `npc` is the designated staffer (branded {@link Truth} — the identity the
 *   player must discover);
 * - `trueAllegiance` is the Hostile Service org (what the caller rewrites onto
 *   `Npc.trueAllegiance`, leaving `apparentAllegiance` as `station`);
 * - `facts` are the ground-truth Propositions the caller adds to the Truth Store
 *   so the mole's loyalty is a real, inferrable fact (a `REPORTS_TO` the hostile
 *   resident and a `MEMBER_OF` the Hostile Service).
 */
export interface MoleAssignment {
  readonly npc: Truth<NpcId>;
  readonly trueAllegiance: Truth<Allegiance>;
  readonly facts: readonly Proposition[];
}

/**
 * The output of {@link assignKnowledge}: a per-NPC knowledge map, the Station's
 * own Knowledge Slice, the mole designation (when enabled), and the ground-truth
 * facts the caller writes into the Truth Store.
 *
 * `truthFacts` are the Propositions in the NPCs' and the Station's `known`
 * slices that the Truth Store must hold for those slices to be *true* knowledge
 * — the Cell membership, the operation's shape, the Station roster. Writing them
 * is what makes `known` propositions actually `holds`, and what makes a false
 * belief detectably false (it is simply absent from this set). The caller
 * (task 5.9) adds them in one transaction.
 */
export interface GeneratedKnowledge {
  /** Knowledge, Cover Story and Agenda per NPC, keyed by id. */
  readonly byNpc: Readonly<Record<NpcId, NpcKnowledge>>;
  /** The Station's Knowledge Slice (the Starting Brief leads are drawn from it). */
  readonly station: KnowledgeSlice;
  /** The mole designation, present only when the scenario enables it. */
  readonly mole?: MoleAssignment;
  /** The ground-truth facts the caller writes into the Truth Store. */
  readonly truthFacts: readonly Proposition[];
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** The slice of the resolved preset knowledge assignment reads. */
export interface KnowledgePreset {
  /** The rate at which the Station slice's leads are HQ false beliefs. */
  readonly hqFalseBeliefRate: number;
}

/** Options for {@link assignKnowledge}. */
export interface AssignKnowledgeOptions {
  /**
   * Whether the scenario enables the internal mole (Requirement 1.5). When
   * `true`, one Station staff NPC is designated a Double Agent. Defaults to
   * `false`.
   */
  readonly mole?: boolean;
}

// ---------------------------------------------------------------------------
// Proposition minting
// ---------------------------------------------------------------------------

/** Turn an arbitrary tag into a slug-safe id fragment. */
function slug(value: string): string {
  const s = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.length > 0 ? s : 'x';
}

/**
 * Mint a stable PropId for a knowledge proposition, scoped to the holder and a
 * local tag so the id reads back to its origin and stays stable for the same
 * seed and content: `prop:know/<holder>/<tag>`.
 */
function knowPropId(holder: EntityId, tag: string): PropId {
  const holderSlug = slug(holder.slice(holder.indexOf(':') + 1));
  return `prop:know/${holderSlug}/${slug(tag)}`;
}

/** Build a Proposition with a minted, holder-scoped id. */
function prop(
  holder: EntityId,
  tag: string,
  subject: EntityId,
  predicate: string,
  object: EntityId | Proposition['object'],
  place?: LocId,
): Proposition {
  return {
    id: knowPropId(holder, tag),
    subject,
    predicate,
    object,
    ...(place === undefined ? {} : { place }),
  };
}

// ---------------------------------------------------------------------------
// Entity gathering
// ---------------------------------------------------------------------------

/** Every entity id that appears in a proposition (subject, object, place). */
function entitiesOf(p: Proposition): EntityId[] {
  const out: EntityId[] = [p.subject];
  if (typeof p.object === 'string') {
    out.push(p.object);
  }
  if (p.place !== undefined) {
    out.push(p.place);
  }
  return out;
}

/**
 * The distinct entities named across a list of propositions, plus any extra
 * entities passed in, in a stable (first-seen) order. The known-entity set of a
 * slice is exactly this: everyone and everywhere the propositions mention, so
 * the dialogue layer's "name only entities from your list" rule is satisfied by
 * construction.
 */
function knownEntitiesFor(
  props: readonly Proposition[],
  extra: readonly EntityId[] = [],
): EntityId[] {
  const seen = new Set<EntityId>();
  const out: EntityId[] = [];
  const add = (id: EntityId): void => {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  for (const p of props) {
    for (const id of entitiesOf(p)) {
      add(id);
    }
  }
  for (const id of extra) {
    add(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plot proposition pool (the true shape of the operation)
// ---------------------------------------------------------------------------

/**
 * Build the pool of *true* Propositions that describe the Plot and the Cell —
 * the shape of the operation the player is hunting. These are the ground truth
 * the Cell's slices draw on, the pool the Station's leads are drawn from, and
 * (written to the Truth Store) what makes those slices true.
 *
 * The pool covers:
 * - each Cell member `MEMBER_OF` the Cell;
 * - the leader `PLANS` the operation and `TARGETS` the target;
 * - the materiel-carrier `CARRIES` the operation's materiel (as free text, the
 *   predicate's object kind);
 * - a `MEETS_AT` between two Cell members at the Plot drop's Location;
 * - each Cell comms owner `USES_CHANNEL`.
 *
 * Every proposition is built from real generated entities, so the known-entity
 * sets that derive from it are all real (an invariant the tests check).
 */
function buildPlotTruthPool(
  orgs: GeneratedOrgs,
  principals: GeneratedPrincipals,
  plot: PlotState,
  comms: GeneratedComms,
): Proposition[] {
  const holder = orgs.cell.id;
  const pool: Proposition[] = [];
  const cellOrg = orgs.cell.id;

  // Membership: every Cell member belongs to the Cell.
  for (const member of principals.cell) {
    pool.push(prop(holder, `member/${member}`, member, 'MEMBER_OF', cellOrg));
  }

  const leader = revealTruth(plot.leader);
  const target = revealTruth(plot.target);

  // The leader plans the operation and targets the target.
  pool.push(
    prop(holder, 'plan', leader, 'PLANS', { kind: 'text', value: 'the operation' }),
  );
  pool.push(prop(holder, 'target', leader, 'TARGETS', target));

  // The Plot drop's Location hosts a Cell meeting; the two meeters are the
  // first two Cell members (always present).
  const dropLoc: LocId | undefined = comms.deadDrops[comms.plotDrop]?.loc;
  if (dropLoc !== undefined && principals.cell.length >= 2) {
    pool.push(
      prop(
        holder,
        'meet',
        principals.cell[0],
        'MEETS_AT',
        principals.cell[1],
        dropLoc,
      ),
    );
  }

  // The materiel carrier carries the operation's materiel (free text).
  const carrier = principals.cell[1] ?? leader;
  pool.push(
    prop(holder, 'carries', carrier, 'CARRIES', {
      kind: 'text',
      value: 'the operation materiel',
    }),
  );

  // Each Cell comms owner uses its channel (free text names the channel).
  for (const chanId of comms.plotChannels) {
    const channel = comms.channels[chanId];
    if (channel === undefined || typeof channel.owner !== 'string') {
      continue;
    }
    // Only person owners read as a USES_CHANNEL subject here.
    if (channel.owner.startsWith('npc:')) {
      pool.push(
        prop(holder, `chan/${chanId}`, channel.owner as NpcId, 'USES_CHANNEL', {
          kind: 'text',
          value: chanId,
        }),
      );
    }
  }

  return pool;
}

// ---------------------------------------------------------------------------
// Stage proximity
// ---------------------------------------------------------------------------

/**
 * The share of the Plot truth pool a Cell member knows, by stage proximity. The
 * leader knows the whole operation; the other Cell roles know a decreasing
 * share, so knowledge is compartmented — the player can learn more from the
 * leader than from the courier, and the discovery-path verifier (task 5.8) sees
 * distinct human sources.
 *
 * The map is keyed by the bare Cell role archetype id. A member whose role is
 * not in the map (should not happen for the fixed roster) knows the membership
 * facts only.
 */
const CELL_ROLE_PROXIMITY: Readonly<Record<string, number>> = {
  'cell-leader': 1,
  'cell-courier': 0.6,
  'cell-radio-operator': 0.6,
  'cell-financier': 0.4,
};

/** The bare local archetype id of an NPC (`core/cell-leader` -> `cell-leader`). */
function localArchetype(npc: Npc): string {
  const a = npc.archetype;
  const slash = a.lastIndexOf('/');
  return slash === -1 ? a : a.slice(slash + 1);
}

// ---------------------------------------------------------------------------
// Cover stories and agendas
// ---------------------------------------------------------------------------

/** True when a role is a concealed one (carries a Cover Story and conceals its role). */
function isConcealedRole(role: string): boolean {
  return role === 'cell' || role === 'hostile-officer';
}

/**
 * Build a Cover Story for a concealed NPC: the apparent, innocent facts they
 * present about themselves. The baseline is a single cover-employment
 * proposition (`WORKS_FOR` an innocent-sounding free-text employer drawn from
 * the persona background), which is what a Cell member or hostile officer offers
 * when asked. An open NPC gets an empty cover story.
 */
function buildCoverStory(npc: Npc): CoverStory {
  if (!isConcealedRole(npc.role)) {
    return { presents: [] };
  }
  const employer =
    npc.persona.background.length > 0 ? npc.persona.background : 'a local firm';
  const presents: Proposition[] = [
    prop(npc.id, 'cover-employment', npc.id, 'WORKS_FOR', {
      kind: 'text',
      value: employer,
    }),
  ];
  return { presents };
}

/**
 * Build an Agenda for an NPC. A concealed NPC conceals the propositions in their
 * own slice that would give them away (their membership and the operation's
 * plan/target), promotes their cover story, and carries role-appropriate goals.
 * An open NPC conceals nothing and simply means to be helpful on their own
 * terms.
 */
function buildAgenda(
  npc: Npc,
  slice: KnowledgeSlice,
  cover: CoverStory,
): Agenda {
  if (!isConcealedRole(npc.role)) {
    return {
      conceal: [],
      promote: [],
      goals: ['be helpful within reason', 'avoid trouble'],
    };
  }
  // Conceal every membership/plan/target proposition in the NPC's own slice.
  const conceal: PropId[] = slice.known
    .filter(
      (p) =>
        p.predicate === 'MEMBER_OF' ||
        p.predicate === 'PLANS' ||
        p.predicate === 'TARGETS' ||
        p.predicate === 'REPORTS_TO',
    )
    .map((p) => p.id);
  const goals =
    npc.role === 'cell'
      ? ['maintain cover', 'reveal nothing about the operation']
      : ['maintain cover', 'protect the network'];
  return { conceal, promote: [...cover.presents], goals };
}

// ---------------------------------------------------------------------------
// Per-NPC knowledge
// ---------------------------------------------------------------------------

/**
 * Build the Knowledge Slice for one NPC, by role and stage proximity.
 *
 * - A Cell member knows the Cell membership facts and, by their role's
 *   proximity, a leading share of the Plot truth pool.
 * - A hostile officer knows the Hostile Service membership and that the Cell
 *   exists; the resident additionally knows the operation's plan/target.
 * - The Chief and Station staff know the Station roster and comms.
 * - A contact knows public city facts (where people are seen) — the raw
 *   material of a lead.
 */
function buildNpcSlice(
  prng: Prng,
  npc: Npc,
  orgs: GeneratedOrgs,
  principals: GeneratedPrincipals,
  plot: PlotState,
  comms: GeneratedComms,
  city: City,
  plotPool: readonly Proposition[],
): KnowledgeSlice {
  const role = npc.role;

  if (role === 'cell') {
    const localId = localArchetype(npc);
    const proximity = CELL_ROLE_PROXIMITY[localId] ?? 0.3;
    // Always know your own membership; then a proximity-sized, deterministic
    // prefix of the id-sorted pool (sorted so the share is stable per seed).
    const sorted = [...plotPool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const ownMembership = sorted.filter(
      (p) => p.predicate === 'MEMBER_OF' && p.subject === npc.id,
    );
    const take = Math.max(
      ownMembership.length,
      Math.round(sorted.length * proximity),
    );
    const known = dedupeById([...ownMembership, ...sorted.slice(0, take)]);
    return {
      known,
      falseBeliefs: [],
      knownEntities: knownEntitiesFor(known, [orgs.cell.id, npc.id]),
    };
  }

  if (role === 'hostile-officer') {
    const holder = npc.id;
    const known: Proposition[] = [
      prop(holder, 'member', npc.id, 'MEMBER_OF', orgs.hostile.id),
      prop(holder, 'suspect-cell', orgs.hostile.id, 'KNOWS', orgs.cell.id),
    ];
    // The resident (first hostile officer) backs the operation: knows the plan.
    const resident = principals.hostile[0];
    if (npc.id === resident) {
      const leader = revealTruth(plot.leader);
      known.push(
        prop(holder, 'plan', leader, 'PLANS', {
          kind: 'text',
          value: 'the operation',
        }),
      );
    }
    return {
      known,
      falseBeliefs: [],
      knownEntities: knownEntitiesFor(known, [orgs.hostile.id, orgs.cell.id]),
    };
  }

  if (role === 'station-staff' || npc.id === principals.chief) {
    const holder = npc.id;
    const known: Proposition[] = [
      prop(holder, 'member', npc.id, 'MEMBER_OF', orgs.station.id),
      prop(holder, 'reports', npc.id, 'REPORTS_TO', principals.chief),
    ];
    // Station comms the staff know of.
    for (const chanId of comms.stationChannels) {
      const channel = comms.channels[chanId];
      if (channel !== undefined) {
        known.push(
          prop(holder, `chan/${chanId}`, npc.id, 'USES_CHANNEL', {
            kind: 'text',
            value: chanId,
          }),
        );
      }
    }
    return {
      known,
      falseBeliefs: [],
      knownEntities: knownEntitiesFor(known, [orgs.station.id, principals.chief]),
    };
  }

  // A contact: public city observations (who is seen where). Draw a couple of
  // real NPC/Location pairs from the schedules so a contact has a lead to give.
  const holder = npc.id;
  const known: Proposition[] = [];
  const others = Object.values(principals.npcs)
    .filter((n) => n.id !== npc.id && n.schedule.entries.length > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (others.length > 0) {
    const subject = prng.pick(others);
    const entry = prng.pick(subject.schedule.entries);
    known.push(
      prop(holder, `seen/${subject.id}`, subject.id, 'LOCATED_AT', subject.id, entry.loc),
    );
  }
  // Also know a public Location exists (knowing the city).
  const publicLocs = Object.values(city.locations)
    .filter((l) => l.public)
    .map((l) => l.id)
    .sort();
  const extra: EntityId[] = publicLocs.length > 0 ? [prng.pick(publicLocs)] : [];
  return {
    known,
    falseBeliefs: [],
    knownEntities: knownEntitiesFor(known, extra),
  };
}

/** Drop propositions with a duplicate id, keeping the first. */
function dedupeById(props: readonly Proposition[]): Proposition[] {
  const seen = new Set<PropId>();
  const out: Proposition[] = [];
  for (const p of props) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The Station slice (with HQ false beliefs)
// ---------------------------------------------------------------------------

/**
 * Build a *false* lead: a Proposition about the Cell/Plot that does not hold —
 * an HQ mistake. The falsehood is manufactured by taking a true-pool shape and
 * swapping one argument for a plausible-but-wrong entity (a different NPC, a
 * different Location), so the lead reads like a real lead but points the wrong
 * way. The result is deliberately *not* added to the Truth Store, so it does not
 * hold.
 */
function buildFalseLead(
  prng: Prng,
  index: number,
  principals: GeneratedPrincipals,
  orgs: GeneratedOrgs,
  city: City,
  avoidMeetLoc: LocId | undefined,
): Proposition {
  const holder = orgs.station.id;
  // A wrong membership: a non-Cell NPC named as a Cell member. This never holds
  // in the Truth Store — no such fact is written, and no membership edge leads a
  // non-Cell NPC to the Cell org.
  const nonCell = Object.values(principals.npcs)
    .filter((n) => n.role !== 'cell')
    .map((n) => n.id)
    .sort();
  if (nonCell.length > 0 && prng.bool(0.5)) {
    const subject = prng.pick(nonCell);
    return prop(holder, `false/${index}`, subject, 'MEMBER_OF', orgs.cell.id);
  }
  // A wrong meeting Location: two real Cell members at a place that is *not*
  // their true meeting Location, so the false belief genuinely does not hold.
  const locs = Object.values(city.locations)
    .map((l) => l.id)
    .filter((id) => id !== avoidMeetLoc)
    .sort();
  const a = principals.cell[0];
  const b = principals.cell[1] ?? principals.cell[0];
  const loc = locs.length > 0 ? prng.pick(locs) : ('loc:nowhere' as LocId);
  return prop(holder, `false/${index}`, a, 'MEETS_AT', b, loc);
}

/**
 * Build the Station's Knowledge Slice (design, step 6; Requirement 26.2).
 *
 * The slice holds a pool of leads about the Cell and the Plot — the material the
 * Starting Brief's leads are drawn from (task 5.7). A share of the leads are HQ
 * false beliefs: at the preset's `hqFalseBeliefRate`, a lead is a manufactured
 * falsehood rather than a true-pool proposition. So the Station knows some real
 * things and believes some wrong ones, and the player cannot trust the brief
 * blindly.
 *
 * The number of false leads is `round(poolSize × rate)`, clamped to the pool
 * size, so a rate of `0` yields an all-true slice and a rate of `1` an all-false
 * one. The true leads are the id-sorted plot pool; the false leads are minted
 * fresh. The split is deterministic given the seed.
 */
function buildStationSlice(
  prng: Prng,
  rate: number,
  plotPool: readonly Proposition[],
  principals: GeneratedPrincipals,
  orgs: GeneratedOrgs,
  city: City,
  comms: GeneratedComms,
): KnowledgeSlice {
  const sorted = [...plotPool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const poolSize = sorted.length;
  const falseCount = Math.min(poolSize, Math.max(0, Math.round(poolSize * rate)));
  const trueCount = poolSize - falseCount;

  // The true leads are the first `trueCount` of the id-sorted pool.
  const known = sorted.slice(0, trueCount);

  // The true meeting Location, so a manufactured "wrong meeting place" avoids it.
  const trueMeetLoc: LocId | undefined = comms.deadDrops[comms.plotDrop]?.loc;

  // The false leads are manufactured HQ mistakes.
  const falseBeliefs: Proposition[] = [];
  for (let i = 0; i < falseCount; i += 1) {
    falseBeliefs.push(buildFalseLead(prng, i, principals, orgs, city, trueMeetLoc));
  }

  const allProps = [...known, ...falseBeliefs];
  return {
    known,
    falseBeliefs,
    knownEntities: knownEntitiesFor(allProps, [orgs.cell.id, orgs.station.id]),
  };
}

// ---------------------------------------------------------------------------
// The mole
// ---------------------------------------------------------------------------

/**
 * Designate the internal mole (design, step 7; Requirement 1.5): one Station
 * staff NPC (never the Chief) whose true allegiance is the Hostile Service. The
 * staffer is chosen from the generated staff on the core stream, so which
 * staffer is the mole varies by seed. Returns the designation plus the
 * ground-truth facts the caller writes into the Truth Store (a `REPORTS_TO` the
 * hostile resident and a `MEMBER_OF` the Hostile Service), so the mole's loyalty
 * is a real, inferrable fact — not merely a flag.
 *
 * Returns `undefined` when the Station has no staff to designate (a roster the
 * principal generator always fills, so this is a defensive floor).
 */
function designateMole(
  prng: Prng,
  principals: GeneratedPrincipals,
  orgs: GeneratedOrgs,
): MoleAssignment | undefined {
  if (principals.staff.length === 0) {
    return undefined;
  }
  const staffSorted = [...principals.staff].sort();
  const moleId = prng.pick(staffSorted);
  const resident = principals.hostile[0];
  const hostileOrg: OrgId = orgs.hostile.id;

  const facts: Proposition[] = [
    prop(moleId, 'mole-reports', moleId, 'REPORTS_TO', resident),
    prop(moleId, 'mole-member', moleId, 'MEMBER_OF', hostileOrg),
  ];

  return {
    npc: asTruth(moleId),
    trueAllegiance: asTruth<Allegiance>({ org: hostileOrg }),
    facts,
  };
}

// ---------------------------------------------------------------------------
// assignKnowledge
// ---------------------------------------------------------------------------

/**
 * Assign Knowledge Slices, Cover Stories and Agendas, and (when enabled) the
 * internal mole (design, "World Generator", steps 6–7; Requirements 1.3, 1.5,
 * 26.2).
 *
 * `prng` must be the core stream for the current attempt, already advanced past
 * city, orgs, principals, Plot and comms generation. The draw order is fixed so
 * the result is a pure function of the seed and the content:
 *
 * 1. the Plot truth pool is built (no draws — it is pure structure);
 * 2. each NPC's slice, cover story and agenda are built in id-sorted NPC order
 *    (a contact's slice draws from the stream; the others do not);
 * 3. the Station slice is built (false leads draw from the stream);
 * 4. the mole, if enabled, is designated (one draw).
 *
 * The returned `truthFacts` are every true `known` proposition across the NPC
 * slices and the Station slice, deduped by id, plus the mole's facts — the set
 * the caller writes into the Truth Store so those slices are true knowledge and
 * the Station's false beliefs are detectably false (absent from the set).
 */
export function assignKnowledge(
  prng: Prng,
  orgs: GeneratedOrgs,
  principals: GeneratedPrincipals,
  plot: PlotState,
  comms: GeneratedComms,
  city: City,
  preset: KnowledgePreset,
  options: AssignKnowledgeOptions = {},
): GeneratedKnowledge {
  const plotPool = buildPlotTruthPool(orgs, principals, plot, comms);

  const byNpc: Record<NpcId, NpcKnowledge> = {};
  const trueFacts: Proposition[] = [];

  // Deterministic NPC order: id-sorted, so the stream draws (contact slices,
  // false leads) happen in a fixed order independent of record insertion.
  const npcIds = (Object.keys(principals.npcs) as NpcId[]).sort();
  for (const id of npcIds) {
    const npc = principals.npcs[id];
    const slice = buildNpcSlice(
      prng,
      npc,
      orgs,
      principals,
      plot,
      comms,
      city,
      plotPool,
    );
    const cover = buildCoverStory(npc);
    const agenda = buildAgenda(npc, slice, cover);
    byNpc[id] = { knowledge: slice, cover, agenda };
    trueFacts.push(...slice.known);
  }

  const station = buildStationSlice(
    prng,
    preset.hqFalseBeliefRate,
    plotPool,
    principals,
    orgs,
    city,
    comms,
  );
  // The Station's *true* leads are facts too (its false beliefs are not).
  trueFacts.push(...station.known);

  const mole = options.mole === true
    ? designateMole(prng, principals, orgs)
    : undefined;

  const truthFacts = dedupeById(trueFacts);
  if (mole !== undefined) {
    // Mole facts are ground truth too; dedupe keeps the id-stable ones distinct.
    truthFacts.push(...mole.facts);
  }

  return {
    byNpc,
    station,
    ...(mole === undefined ? {} : { mole }),
    truthFacts: dedupeById(truthFacts),
  };
}

// ---------------------------------------------------------------------------
// Invariants (exported for tests / later tasks)
// ---------------------------------------------------------------------------

/** True when every entity id named in `known`/`falseBeliefs` is in `knownEntities`. */
export function slicePropsAreKnown(slice: KnowledgeSlice): boolean {
  const set = new Set<EntityId>(slice.knownEntities);
  for (const p of [...slice.known, ...slice.falseBeliefs]) {
    for (const id of entitiesOf(p)) {
      if (!set.has(id)) {
        return false;
      }
    }
  }
  return true;
}

/** The share of the Plot truth pool a Cell role knows, exported for tests. */
export { CELL_ROLE_PROXIMITY };

/** The Cell/hostile archetype roles, re-exported for cover-story checks. */
export const CELL_ROLE_ARCHETYPES: readonly string[] = CELL_ROLE_IDS;
export const HOSTILE_ROLE_ARCHETYPES: readonly string[] = HOSTILE_ROLE_IDS;
