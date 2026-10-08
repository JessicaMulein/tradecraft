/**
 * The task action (slice-integration design, "Engine: actions" → `task`;
 * Requirements 10.1–10.7, completing slice Req 10.3, 10.4, 10.6, 22.6 and 24.6).
 *
 * `{ kind:'task'; asset: NpcId; task: AssetTask }` — the player tasks one of
 * their Assets, over its Contact Channel, to **collect** on a target,
 * **introduce** another NPC, **service** one of the player's dead drops, or
 * **plant** a Proposition where the Hostile Service will find it. The Asset does
 * the work and carries the risk; the player stays where they are.
 *
 * ## Quote (pure, no draws; Req 10.1, 10.2)
 *
 * {@link quoteTask} reads only the Asset's {@link Relationship} flags:
 *
 * - no Relationship, not `recruited`, or no Asset profile → disallowed with
 *   {@link NOT_YOUR_ASSET_REASON};
 * - a running Asset with no Contact Channel (`channel` false) → disallowed with
 *   {@link NO_CHANNEL_REASON};
 * - otherwise allowed at {@link TASK_PHASE_COST} phase and
 *   {@link TASK_MONEY_COST} money, for every task kind.
 *
 * It reads neither the Truth Store nor a `Truth`-branded profile field (access,
 * reliability, `hostileControlled`), so two worlds that differ only in ground
 * truth quote a task the same way (Property 47). The payload is not checked
 * here: a task the Asset cannot carry out (an unknown introduction target, a
 * drop that is not the player's) still costs its phase and its Exposure, and
 * resolves to a plain Fact Line saying so.
 *
 * ## Resolve (draws only inside `runAssetTask`; Req 10.3–10.7)
 *
 * {@link resolveTask} builds the task context, runs {@link runAssetTask} once on
 * the passed {@link Prng}, and applies the intent it returns:
 *
 * - **collect** (Req 10.3). The candidates are the Truth Store facts that came
 *   into force since the Asset's last report ({@link factsSinceLastReport}),
 *   with the facts naming the target first. `runAssetTask` filters them through
 *   the Asset's access and reliability as before; the access filter's org
 *   branch asks the Truth Store whether the fact's subject is a `MEMBER_OF` the
 *   org. Each reported Proposition becomes a Proposition Observation sourced
 *   `{ kind:'npc', npc: asset }`, and `claimsAdded` names them for the Turn
 *   Pipeline to record. A hostile-controlled Asset's report is replaced by the
 *   Hostile Service's Chickenfeed selection ({@link selectChickenfeed}) from the
 *   same in-access candidates (the slice's "Asset reporting" rule; the draws
 *   are taken either way, so a doubling leaves no trace in the PRNG stream).
 *   The report sets `lastReport` to now, which also ends a notified silence
 *   (`silenceNotified` is cleared).
 * - **introduce** (Req 10.4). The target gets a Relationship with
 *   `channel: true` and `trust` equal to the returned `inheritedTrust`, and
 *   joins `player.contacts` and the known set. A Relationship that already
 *   exists keeps its own trust when that is higher: an introduction vouches for
 *   the player, it does not undo rapport.
 * - **service** (Req 10.5). For one of the player's own drops
 *   (`player.known.drops`, the same test `service-drop` uses), the collected
 *   Propositions become Observations sourced to the Asset and the left items
 *   are appended to `deadDrops[drop].contents`, with the hidden `drop-emptied`
 *   and `drop-loaded` events the player's own servicing emits, attributed to
 *   the Asset. As with the player's own servicing, the lifted items are reported,
 *   not removed. Any other drop is left untouched.
 * - **plant** (Req 10.6). A placed plant is appended to `scheduled` as a hidden
 *   `belief-plant` event at the next Day Boundary, carrying the Proposition,
 *   the Asset and the plant's Location. That day's Hostile tick takes it into
 *   `newlyAdopted`. The Fact Line is the same whether or not the plant was
 *   placed, so it gives away nothing about the Asset's hidden reliability.
 * - **every task** (Req 10.7). The Asset's `exposure` rises by
 *   {@link TASKING_EXPOSURE}, whatever the kind or the outcome.
 *
 * ## Sources
 *
 * Every Proposition this action yields, from a collect report or a service, is
 * sourced `npc` to the Asset. The Asset relays it through its own access and
 * reliability filter (it may omit or garble), so it is the Asset's report rather
 * than a Document the player read, and no Document is minted.
 *
 * ## Drop contents seam
 *
 * The slice's {@link DeadDrop} holds bare item ids, and items carry no
 * Propositions (the same seam `service-drop` documents for its `copyAsserts`).
 * A service task therefore collects no Propositions by default. A caller that
 * can attach facts to a drop's items passes them in {@link TaskInputs}.
 *
 * Fact Line rendering is left to the caller's `render` callback, so this module
 * never imports `./action.ts` and no import cycle forms.
 */

import {
  asTruth,
  compareTime,
  revealTruth,
  type DeadDropId,
  type EntityId,
  type GameTime,
  type ItemId,
  type LocId,
  type NpcId,
  type OrgId,
  type Proposition,
  type Truth,
  type UnkId,
} from '../model/core.js';
import type { SimEvent, TraceOrigin, WorldState } from '../model/state.js';
import type { Prng } from '../prng/prng.js';
import type { TruthReader } from '../truth/truth.js';
import type { DeadDrop } from '../city/comms.js';
import { scheduledLocation } from '../city/npc.js';
import { CONTENT_WEEKDAYS, weekdayForDay } from '../city/time-mapping.js';
import { tieAffinityBetween } from '../ambient/ties.js';
import {
  factInAccess,
  isAsset,
  newRelationship,
  type AssetProfile,
  type OrgMembershipLookup,
  type Relationship,
} from '../recruit/asset.js';
import {
  runAssetTask,
  TASKING_EXPOSURE,
  type AssetTaskResult,
  type CollectResult,
  type IntroduceResult,
  type PlantResult,
  type ServiceResult,
} from '../recruit/tasking.js';
import { selectChickenfeed, type ChickenfeedCandidate } from '../hostile/doubling.js';
import { addContactChannel } from './talk.js';
import { identify } from './identify.js';
import type { ActionQuote, ActionResult, Observation, ResolverContext } from './result.js';
import type { ObservationSource, TaskAction } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The phase cost of tasking an Asset (design: 1 phase for every task kind). */
export const TASK_PHASE_COST = 1;

/** Tasking an Asset costs no money (design). Paying one is the `pay` action. */
export const TASK_MONEY_COST = 0;

/** Why a task is disallowed for someone who is not a running Asset (Req 10.2). */
export const NOT_YOUR_ASSET_REASON = 'that person is not your Asset';

/** Why a task is disallowed for an Asset with no Contact Channel (Req 10.2). */
export const NO_CHANNEL_REASON = 'you have no way to reach them';

/** The Fact Line that opens a collect report with something in it. */
export const TASK_REPORT_LINE = 'Word comes back from your Asset.';

/** The Fact Line of a collect report with nothing new in it. */
export const TASK_NOTHING_NEW_LINE = 'Your Asset has nothing new to report.';

/** The Fact Line of an introduction the Asset makes. */
export const TASK_INTRODUCED_LINE =
  'Your Asset makes the introduction. You now have a way to reach them.';

/** The Fact Line of an introduction the Asset cannot make. */
export const TASK_NO_INTRODUCTION_LINE = 'Your Asset cannot arrange that introduction.';

/** The Fact Line of a service task on a drop that is not one of the player's. */
export const TASK_NO_SUCH_DROP_LINE = 'Your Asset cannot service that drop.';

/** The Fact Line of every plant task, placed or not, so it reveals no reliability. */
export const TASK_PLANTED_LINE = 'Your Asset sends word that the material is in place.';

/**
 * The {@link TraceOrigin} on the drop events of a courier service. Like the
 * player's own servicing, it is routine work of the player's side, not a Plot or
 * Side-Thread trace.
 */
export const TASK_DROP_ORIGIN: TraceOrigin = asTruth({ kind: 'routine' });

/** The id of the `MEMBER_OF` probe the access filter's org branch asks the Truth Store. */
const MEMBERSHIP_PROBE_ID = 'prop:task/membership-probe';

// ---------------------------------------------------------------------------
// Local helpers (kept local to avoid an action.ts import cycle)
// ---------------------------------------------------------------------------

/**
 * The NPCs scheduled at a Location at the current time, by id in deterministic
 * order. A local copy of `./action.ts`'s `visibleNpcsAt`, the same pattern
 * `./pay.ts` and `./turn-agent.ts` use.
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

/** A single Fact Line `message` Observation. */
function message(line: string): Observation {
  return { kind: 'message', line };
}

/** True when an id names an item (`item:`), the only thing a drop holds. */
function isItemId(id: string): id is ItemId {
  return id.startsWith('item:');
}

/** A short, readable list of item ids for a Fact Line. */
function describeItems(items: readonly ItemId[]): string {
  return items.map((item) => item.replace(/^item:/, '')).join(', ');
}

/** The first phase of the next day: when the next Day Boundary's hooks run. */
function nextDayBoundary(t: GameTime): GameTime {
  return { day: t.day + 1, phase: 0 };
}

/** Insert an event into the time-ordered `scheduled` queue, keeping it ordered. */
function insertScheduled(queue: readonly SimEvent[], event: SimEvent): readonly SimEvent[] {
  const out = [...queue];
  let i = out.length;
  while (i > 0 && compareTime(out[i - 1].at, event.at) > 0) {
    i -= 1;
  }
  out.splice(i, 0, event);
  return out;
}

/**
 * A copy of the Relationship without `silenceNotified`: a report ends the
 * Asset's silence, so the Phase Step may notify the next one.
 */
function clearSilence(rel: Relationship): Relationship {
  if (rel.silenceNotified === undefined) {
    return rel;
  }
  const copy: { -readonly [K in keyof Relationship]: Relationship[K] } = { ...rel };
  delete copy.silenceNotified;
  return copy;
}

/**
 * The drop when it is one of the player's own (in `player.known.drops`, the
 * test `service-drop`'s `isOwnDrop` applies), or `undefined` for a hostile or
 * unknown drop.
 */
function ownDrop(state: WorldState, id: DeadDropId): DeadDrop | undefined {
  const drop = state.deadDrops[id];
  return drop !== undefined && state.player.known.drops.includes(id) ? drop : undefined;
}

// ---------------------------------------------------------------------------
// Report candidates (Req 10.3)
// ---------------------------------------------------------------------------

/**
 * The Truth Store facts a `collect` report draws on: the facts that came into
 * force since the Asset's last report, up to `now` (design: "candidates drawn
 * from Truth Store facts since `rel.lastReport`"). A fact comes into force at
 * its window's `from`; a standing fact (no window) has always been in force.
 *
 * - A fact whose window starts after `now` is left out: an Asset reports what
 *   has happened, not what is still to come.
 * - The first report (no `lastReport`) covers every fact in force by `now`,
 *   standing facts included.
 * - A later report covers only the facts whose window started after
 *   `lastReport`. Anything in force at the last report was reportable then, so
 *   it is not reported again, and one Asset cannot corroborate its own report
 *   by being tasked twice.
 *
 * The access filter is not applied here; `runAssetTask` applies it, as it
 * always has. Facts keep the Truth Store's order. With no Truth Store there is
 * nothing to report.
 */
export function factsSinceLastReport(
  truth: TruthReader | undefined,
  lastReport: GameTime | undefined,
  now: GameTime,
): Truth<Proposition>[] {
  if (truth === undefined) {
    return [];
  }
  return truth.facts().filter((branded) => {
    const window = revealTruth(branded).window;
    if (window !== undefined && compareTime(window.from, now) > 0) {
      return false;
    }
    if (lastReport === undefined) {
      return true;
    }
    return window !== undefined && compareTime(window.from, lastReport) > 0;
  });
}

/** The Sim trace kinds an onlooker at the trace's Location can see. */
const WITNESSABLE: ReadonlySet<string> = new Set([
  'meeting',
  'npc-moved',
  'drop-loaded',
  'drop-emptied',
]);

/**
 * What an Asset saw or heard about on their own routine since their last
 * report: for every Plot stage that has executed (at its deadline) since
 * `since`, each observable trace bound to a Location the Asset's schedule takes
 * them to on that weekday (a regular hears about the day's goings-on). A
 * meeting yields a `MEETS_AT` for each pair of participants and a `LOCATED_AT`
 * for each; a drop or a move yields a `LOCATED_AT` of the acting person. Every
 * fact is stamped with the event's time, so evidence from Assets accrues as the
 * operation unfolds instead of being known from day one.
 *
 * Pure and drawless: it reads the Plot's executed stages and the Asset's
 * schedule, so the same state always yields the same witnessed facts.
 */
export function witnessedFacts(
  state: WorldState,
  asset: NpcId,
  since: GameTime | undefined,
): Truth<Proposition>[] {
  const npc = state.npcs[asset];
  if (npc === undefined) {
    return [];
  }
  const out: Truth<Proposition>[] = [];
  const leader = revealTruth(state.plot.leader);
  for (const stage of state.plot.stages) {
    if (stage.status !== 'executed') {
      continue;
    }
    const at = stage.deadline;
    if (compareTime(at, state.time) > 0) {
      continue;
    }
    if (since !== undefined && compareTime(at, since) <= 0) {
      continue;
    }
    // A regular hears about what happened at their haunt that day: the
    // Locations the Asset's routine takes them to on the event's weekday.
    const weekday = CONTENT_WEEKDAYS.indexOf(weekdayForDay(at.day));
    const haunts = new Set<LocId>(
      npc.schedule.entries.filter((e) => e.weekday === weekday).map((e) => e.loc),
    );
    if (haunts.size === 0) {
      continue;
    }
    for (const trace of stage.traces) {
      if (!WITNESSABLE.has(trace.kind)) {
        continue;
      }
      const loc =
        trace.place?.kind === 'loc'
          ? trace.place.loc
          : trace.place?.kind === 'target' && trace.place.entity.startsWith('loc:')
            ? (trace.place.entity as LocId)
            : undefined;
      if (loc === undefined || !haunts.has(loc)) {
        continue;
      }
      const people = (trace.participants.length > 0 ? trace.participants : [leader]).filter(
        (p) => p !== asset,
      );
      const window = { from: at };
      const tag = `${stage.id}/${trace.index}`;
      for (const person of people) {
        out.push(
          asTruth<Proposition>({
            id: `prop:witness/${asset}/${tag}/at/${person}`,
            subject: person,
            predicate: 'LOCATED_AT',
            object: person,
            place: loc,
            window,
          }),
        );
      }
      if (trace.kind === 'meeting') {
        for (let i = 0; i < people.length; i += 1) {
          for (let j = i + 1; j < people.length; j += 1) {
            out.push(
              asTruth<Proposition>({
                id: `prop:witness/${asset}/${tag}/meets/${people[i]}/${people[j]}`,
                subject: people[i],
                predicate: 'MEETS_AT',
                object: people[j],
                place: loc,
                window,
              }),
            );
          }
        }
      }
    }
  }
  return out;
}

/**
 * Order the candidates so the facts naming the collect target (as subject or
 * object) come first, each group in its original order. The report is capped
 * (`reportFacts` returns at most three), so this is what makes a collect on a
 * target report on that target first.
 */
function targetFirst(
  candidates: readonly Truth<Proposition>[],
  target: NpcId,
): Truth<Proposition>[] {
  const about: Truth<Proposition>[] = [];
  const rest: Truth<Proposition>[] = [];
  for (const branded of candidates) {
    const fact = revealTruth(branded);
    if (fact.subject === target || fact.object === target) {
      about.push(branded);
    } else {
      rest.push(branded);
    }
  }
  return [...about, ...rest];
}

/**
 * The membership seam for the access filter's org branch: does the Truth Store
 * hold that `subject` is a `MEMBER_OF` `org` (followed through `MEMBER_OF` and
 * `REPORTS_TO` edges, as the predicate's evaluator does) at `at`? With no Truth
 * Store nobody is a member.
 */
function membershipLookup(truth: TruthReader | undefined, at: GameTime): OrgMembershipLookup {
  if (truth === undefined) {
    return () => false;
  }
  return (subject: EntityId, org: OrgId) =>
    truth.holds({ id: MEMBERSHIP_PROBE_ID, subject, predicate: 'MEMBER_OF', object: org }, at);
}

/**
 * What a hostile-controlled Asset reports instead of the truth (the slice's
 * "Asset reporting" rule): the Hostile Service's Chickenfeed selection, per its
 * doctrine, from the in-access candidates. `selectChickenfeed` is the rule the
 * doubling decision uses, so the doubled Asset passes back low-value true facts.
 */
function chickenfeedReport(
  state: WorldState,
  profile: AssetProfile,
  candidates: readonly Truth<Proposition>[],
  isMemberOfOrg: OrgMembershipLookup,
): readonly Proposition[] {
  const access = revealTruth(profile.access);
  const pool: ChickenfeedCandidate[] = [];
  for (const branded of candidates) {
    const prop = revealTruth(branded);
    if (factInAccess(prop, access, isMemberOfOrg)) {
      pool.push({ prop });
    }
  }
  return selectChickenfeed(state.hostile.doctrine, pool).props;
}

// ---------------------------------------------------------------------------
// Quote (Req 10.1, 10.2)
// ---------------------------------------------------------------------------

/**
 * Quote a {@link TaskAction} (pure, no draws; Req 10.1, 10.2). Allowed at
 * {@link TASK_PHASE_COST} phase and {@link TASK_MONEY_COST} money when the
 * player's Relationship with `asset` is a running Asset (recruited, with a
 * profile) that has a Contact Channel. Otherwise disallowed with
 * {@link NOT_YOUR_ASSET_REASON} or {@link NO_CHANNEL_REASON}. Only those
 * Relationship flags are read, never ground truth. A task runs over the
 * Contact Channel, not at the player's Location, so it has no `actionLocation`
 * and the shared Location gate in `./action.ts` does not apply.
 */
export function quoteTask(state: WorldState, a: TaskAction): ActionQuote {
  const rel = state.relationships[a.asset];
  if (rel === undefined || !isAsset(rel)) {
    return { allowed: false, reason: NOT_YOUR_ASSET_REASON, phases: 0, money: 0 };
  }
  if (!rel.channel) {
    return { allowed: false, reason: NO_CHANNEL_REASON, phases: 0, money: 0 };
  }
  return { allowed: true, phases: TASK_PHASE_COST, money: TASK_MONEY_COST };
}

// ---------------------------------------------------------------------------
// Resolve (Req 10.3–10.7)
// ---------------------------------------------------------------------------

/**
 * Optional inputs a richer caller may supply, with a default so the top-level
 * `resolve` need not pass them:
 *
 * - `dropContents` — the facts the drop's current contents assert, for a
 *   `service` task on one of the player's drops. Slice items carry no
 *   Propositions, so this defaults to none.
 */
export interface TaskInputs {
  readonly dropContents?: readonly Truth<Proposition>[];
}

/** What applying a task's intent produced, before the shared Exposure step. */
interface Applied {
  readonly next: WorldState;
  /** The Asset's Relationship after the task's own update (Exposure not yet added). */
  readonly asset: Relationship;
  readonly observations: readonly Observation[];
  readonly events: readonly SimEvent[];
  readonly claimsAdded: readonly string[];
}

/**
 * Resolve a {@link TaskAction} (design `resolve`; Req 10.3–10.7). The caller
 * (`resolve`) has re-quoted, so `asset` is a running Asset with a Contact
 * Channel. Draws only inside {@link runAssetTask}, once, on `rng`. See the
 * module overview for what each task kind applies. Every task then adds
 * {@link TASKING_EXPOSURE} to the Asset's Exposure. Fact Line rendering is left
 * to the caller's `render`.
 *
 * `ctx.truth` supplies the collect candidates and the org-membership lookup.
 * Without it a collect has nothing to report (it still counts as a report).
 */
export function resolveTask(
  state: WorldState,
  a: TaskAction,
  rng: Prng,
  ctx: ResolverContext,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
  inputs: TaskInputs = {},
): { next: WorldState; result: ActionResult } {
  const rel = state.relationships[a.asset];
  // Defensive: `resolve` re-quotes before dispatching, so this is a running
  // Asset. If it somehow is not, return an empty no-op rather than throwing.
  if (rel === undefined || !isAsset(rel) || rel.asset === undefined) {
    return {
      next: state,
      result: {
        observations: [],
        factLines: [],
        scene: sceneDescriptorAt(state, state.player.loc),
        events: [],
        claimsAdded: [],
      },
    };
  }

  const task = a.task;
  const isMemberOfOrg = membershipLookup(ctx.truth, state.time);
  // A collect on an Unidentified Subject reports on the person behind it.
  const subject = task.kind === 'collect' ? collectSubject(task.target, ctx) : undefined;
  const candidates =
    task.kind === 'collect' && subject !== undefined
      ? targetFirst(
          [
            ...factsSinceLastReport(ctx.truth, rel.lastReport, state.time),
            ...witnessedFacts(state, a.asset, rel.lastReport),
          ],
          subject,
        )
      : [];
  const dropContents =
    task.kind === 'service' && ownDrop(state, task.drop) !== undefined
      ? (inputs.dropContents ?? [])
      : [];

  const tieAffinity =
    state.ambient === undefined || task.kind !== 'introduce'
      ? undefined
      : tieAffinityBetween(state.ambient.ties, a.asset, task.target);
  const outcome = runAssetTask(
    task,
    { rel, candidates, dropContents, isMemberOfOrg, ...(tieAffinity !== undefined ? { tieAffinity } : {}) },
    rng,
  );
  let applied = applyOutcome(state, a.asset, rel, rel.asset, outcome, candidates, isMemberOfOrg);
  if (
    task.kind === 'collect' &&
    subject !== undefined &&
    task.target !== subject &&
    outcome.kind === 'collect'
  ) {
    applied = identifyFromReport(applied, a.asset, task.target as UnkId, subject, outcome, ctx);
  }

  // Every task adds the tasking risk to the Asset's Exposure (Req 10.7).
  const exposed: Relationship = {
    ...applied.asset,
    exposure: applied.asset.exposure + TASKING_EXPOSURE,
  };
  const next: WorldState = {
    ...applied.next,
    relationships: { ...applied.next.relationships, [a.asset]: exposed },
  };

  return {
    next,
    result: {
      observations: applied.observations,
      factLines: render(next, applied.observations),
      scene: sceneDescriptorAt(next, next.player.loc),
      events: applied.events,
      claimsAdded: applied.claimsAdded,
    },
  };
}

/**
 * The NPC a collect reports on: the named target itself, or the person behind
 * an Unidentified Subject (through the Truth Store's identity map). `undefined`
 * when an `unk:` id resolves to no one.
 */
function collectSubject(target: NpcId | UnkId, ctx: ResolverContext): NpcId | undefined {
  if (target.startsWith('npc:')) {
    return target as NpcId;
  }
  const npc = ctx.truth?.identityOf(target as UnkId);
  return npc === undefined ? undefined : revealTruth(npc);
}

/**
 * Identify an Unidentified Subject from an Asset's report (the `asset-report`
 * trigger, Req 23.5): when the report names the person behind the `unk:` id,
 * the player now knows who they are. Adds them to the known set and an
 * `IS_ALIAS_OF(unk, npc)` Observation sourced to the Asset. A report that does
 * not name them identifies no one.
 */
function identifyFromReport(
  applied: Applied,
  asset: NpcId,
  unk: UnkId,
  npc: NpcId,
  outcome: CollectResult,
  ctx: ResolverContext,
): Applied {
  const named = outcome.reported.some((p) => p.subject === npc || p.object === npc);
  if (!named || ctx.truth === undefined) {
    return applied;
  }
  const { report, next } = identify(applied.next, ctx.truth, {
    npc,
    unk,
    trigger: 'asset-report',
    sourceId: asset,
    observedAt: applied.next.time,
  });
  const observation: Observation = {
    kind: 'proposition',
    prop: report.prop,
    at: report.observedAt,
    source: { kind: 'npc', npc: asset },
  };
  return {
    ...applied,
    next,
    observations: [...applied.observations, observation],
    claimsAdded: [...applied.claimsAdded, report.prop.id],
  };
}

/** Apply the intent `runAssetTask` returned, by task kind. */
function applyOutcome(
  state: WorldState,
  asset: NpcId,
  rel: Relationship,
  profile: AssetProfile,
  outcome: AssetTaskResult,
  candidates: readonly Truth<Proposition>[],
  isMemberOfOrg: OrgMembershipLookup,
): Applied {
  switch (outcome.kind) {
    case 'collect':
      return applyCollect(state, asset, rel, profile, outcome, candidates, isMemberOfOrg);
    case 'introduce':
      return applyIntroduce(state, asset, rel, outcome);
    case 'service':
      return applyService(state, asset, rel, outcome);
    case 'plant':
      return applyPlant(state, asset, rel, outcome);
  }
}

/**
 * `collect` (Req 10.3): the report as Observations sourced to the Asset (the
 * Chickenfeed selection for a hostile-controlled Asset), and `lastReport` set
 * to now.
 */
function applyCollect(
  state: WorldState,
  asset: NpcId,
  rel: Relationship,
  profile: AssetProfile,
  outcome: CollectResult,
  candidates: readonly Truth<Proposition>[],
  isMemberOfOrg: OrgMembershipLookup,
): Applied {
  const reported = revealTruth(profile.hostileControlled)
    ? chickenfeedReport(state, profile, candidates, isMemberOfOrg)
    : outcome.reported;
  const source: ObservationSource = { kind: 'npc', npc: asset };
  const observations: Observation[] =
    reported.length === 0
      ? [message(TASK_NOTHING_NEW_LINE)]
      : [
          message(TASK_REPORT_LINE),
          ...reported.map(
            (prop): Observation => ({ kind: 'proposition', prop, at: state.time, source }),
          ),
        ];
  return {
    next: state,
    asset: { ...clearSilence(rel), lastReport: state.time },
    observations,
    events: [],
    claimsAdded: reported.map((prop) => prop.id),
  };
}

/**
 * `introduce` (Req 10.4): a Contact Channel to the target at the inherited
 * trust, and the target added to `player.contacts`. An unknown target, or the
 * Asset itself, cannot be introduced.
 */
function applyIntroduce(
  state: WorldState,
  asset: NpcId,
  rel: Relationship,
  outcome: IntroduceResult,
): Applied {
  const target = outcome.target;
  if (target === asset || state.npcs[target] === undefined) {
    return {
      next: state,
      asset: rel,
      observations: [message(TASK_NO_INTRODUCTION_LINE)],
      events: [],
      claimsAdded: [],
    };
  }
  const existing = state.relationships[target];
  const introduced: Relationship =
    existing === undefined
      ? { ...newRelationship(target), channel: outcome.channel, trust: outcome.inheritedTrust }
      : {
          ...existing,
          channel: outcome.channel,
          trust: Math.max(existing.trust, outcome.inheritedTrust),
        };
  const withRelationship: WorldState = {
    ...state,
    relationships: { ...state.relationships, [target]: introduced },
  };
  return {
    next: addContactChannel(withRelationship, target),
    asset: rel,
    observations: [message(TASK_INTRODUCED_LINE)],
    events: [],
    claimsAdded: [],
  };
}

/** A stable id for a courier's drop event, from the Asset, drop, tag and time. */
function dropEventId(
  asset: NpcId,
  drop: DeadDropId,
  tag: 'emptied' | 'loaded',
  at: GameTime,
): string {
  return `event:task-service:${asset}:${drop}:${tag}:${at.day}.${at.phase}`;
}

/**
 * `service` (Req 10.5): on one of the player's own drops, the collected
 * Propositions as Observations sourced to the Asset and the left items appended
 * to the drop's contents, with the hidden drop events the player's own
 * servicing emits. Any other drop is left untouched.
 */
function applyService(
  state: WorldState,
  asset: NpcId,
  rel: Relationship,
  outcome: ServiceResult,
): Applied {
  const drop = ownDrop(state, outcome.drop);
  if (drop === undefined) {
    return {
      next: state,
      asset: rel,
      observations: [message(TASK_NO_SUCH_DROP_LINE)],
      events: [],
      claimsAdded: [],
    };
  }

  const lifted = drop.contents;
  const left = outcome.left.filter(isItemId);
  const source: ObservationSource = { kind: 'npc', npc: asset };
  const observations: Observation[] = [
    message(
      lifted.length > 0
        ? `Your Asset lifts the drop: ${describeItems(lifted)}.`
        : 'Your Asset finds the drop empty.',
    ),
    ...outcome.collected.map(
      (prop): Observation => ({ kind: 'proposition', prop, at: state.time, source }),
    ),
  ];
  const events: SimEvent[] = [];
  if (lifted.length > 0) {
    events.push({
      id: dropEventId(asset, drop.id, 'emptied', state.time),
      at: state.time,
      visibility: 'hidden',
      kind: 'drop-emptied',
      drop: drop.id,
      by: asset,
      items: lifted.map((item) => ({ item })),
      origin: TASK_DROP_ORIGIN,
    });
  }

  let next = state;
  if (left.length > 0) {
    observations.push(message(`Your Asset leaves ${describeItems(left)} in the drop.`));
    events.push({
      id: dropEventId(asset, drop.id, 'loaded', state.time),
      at: state.time,
      visibility: 'hidden',
      kind: 'drop-loaded',
      drop: drop.id,
      by: asset,
      items: left.map((item) => ({ item })),
      origin: TASK_DROP_ORIGIN,
    });
    const serviced: DeadDrop = { ...drop, contents: [...drop.contents, ...left] };
    next = { ...state, deadDrops: { ...state.deadDrops, [drop.id]: serviced } };
  }

  return {
    next,
    asset: rel,
    observations,
    events,
    claimsAdded: outcome.collected.map((prop) => prop.id),
  };
}

/**
 * `plant` (Req 10.6): a placed plant scheduled as a hidden `belief-plant` at the
 * next Day Boundary, for that day's Hostile tick. The Fact Line does not say
 * whether the plant was placed.
 */
function applyPlant(
  state: WorldState,
  asset: NpcId,
  rel: Relationship,
  outcome: PlantResult,
): Applied {
  let next = state;
  if (outcome.placed) {
    const plant: SimEvent = {
      id: `event:belief-plant:${asset}:${outcome.prop.id}:${state.time.day}.${state.time.phase}`,
      at: nextDayBoundary(state.time),
      visibility: 'hidden',
      kind: 'belief-plant',
      prop: outcome.prop,
      by: asset,
      ...(outcome.at === undefined ? {} : { loc: outcome.at }),
    };
    next = { ...state, scheduled: insertScheduled(state.scheduled, plant) };
  }
  return {
    next,
    asset: rel,
    observations: [message(TASK_PLANTED_LINE)],
    events: [],
    claimsAdded: [],
  };
}
