/**
 * The end-of-game debrief (design, "Arrests, end conditions, the debrief and the
 * Outcome Record" → the Debrief screen; Requirements 8.3, 19.6). Task 20.2.
 *
 * The debrief is the one place the Player View legitimately reveals ground
 * truth: the game is over, so the fence that keeps the Truth Store out of the
 * client (Requirement 2.2) is lifted and the final reckoning is laid out. It is
 * built by a single pure function, {@link buildDebrief}, that reads the ended
 * {@link WorldState}, the ground-truth {@link TruthReader}, the player's
 * {@link CaseFile}, the recorded action log and the recorded feed deliveries,
 * and returns a plain, serialisable {@link DebriefView}. The facade's
 * `views.debrief()` calls it when `state.ended` is set, and returns `null`
 * before then (design: "`debrief()` returns `null` until `ended` is set").
 *
 * The sections it reveals (Req 19.6, and the design's Debrief screen):
 *
 * - the final {@link Outcome} and the abort / disruption / burn **cause**
 *   (`WorldState.ended.cause`);
 * - every NPC's **true allegiance** — the organisation the Truth Store records
 *   them serving — next to the allegiance they *presented*
 *   (`apparentAllegiance`), so a mole or a double agent is unmasked;
 * - the actual Plot **timeline** — what the Cell really did, stage by stage,
 *   read from the Plot's stage DAG and running status;
 * - which Case File Claims were **lies** — a recorded Claim-truth with
 *   `lie: true`, or a Claim whose Proposition does not hold in the Truth Store
 *   at the time it was observed;
 * - which leads the player chased were **Side Threads or Rumours** — noise, not
 *   signal — by matching the Case File's Claims to the Side-Thread and Rumour
 *   provenance in the world;
 * - the **Propositions the player fed** a doubled agent, each tagged
 *   `chickenfeed` (it held in Truth at delivery) or `deception` (it did not);
 * - the **Directive results** — each Directive's met / failed / open status; and
 * - the **score** and the player's **grading accuracy** — how well the Case File
 *   matched ground truth, and how well the player's Admiralty Grades tracked the
 *   actual truth of the Claims they graded.
 *
 * Everything the view carries is already-revealed ground truth or player-side
 * data, flattened to plain fields and strings — no {@link Truth}-branded value
 * survives into the returned shape, so the view is safe to serialise into the
 * Outcome Record (task 20.3) and render in the TUI (task 22.11).
 */

import {
  revealTruth,
  type AdmiraltyGrade,
  type ClaimId,
  type EntityId,
  type GameTime,
  type Literal,
  type NpcId,
  type Outcome,
  type Proposition,
  type TruthReader,
  type WorldState,
} from '@tradecraft/engine';

import type { CaseFile, Claim } from '../casefile/casefile.js';

// ---------------------------------------------------------------------------
// The revealed sections
// ---------------------------------------------------------------------------

/**
 * One NPC's allegiance reckoning (Req 19.6, "true allegiances"). The game is
 * over, so this reveals the organisation the Truth Store records the NPC really
 * serving (`trueOrg`) next to the allegiance category they *presented*
 * (`apparent`). `deceptive` is true when the two disagree — a mole or a double
 * agent who passed as one thing while serving another.
 */
export interface DebriefAllegiance {
  readonly npc: NpcId;
  /** The persona name the player knew them by (the game is over). */
  readonly name: string;
  /** The archetype role the NPC held (`cell`, `hostile-officer`, …). */
  readonly role: string;
  /** The allegiance category the NPC presented to the player. */
  readonly apparent: string;
  /** The organisation the Truth Store records them truly serving, if any. */
  readonly trueOrg?: EntityId;
  /** The display name of that true organisation, if resolvable. */
  readonly trueOrgName?: string;
  /** True when the true allegiance differs from the apparent one. */
  readonly deceptive: boolean;
}

/**
 * One entry in the actual Plot timeline (Req 19.6, "the actual Plot timeline").
 * Each Plot Stage, in DAG order, with the status the Sim left it in — the record
 * of what the Cell really did: which stages executed, which the player
 * disrupted, which never fired because the operation ended first.
 */
export interface DebriefTimelineEntry {
  /** The minted Plot Stage id. */
  readonly stage: string;
  /** The stage's content id in its template. */
  readonly templateId: string;
  /** The running status the Sim left the stage in. */
  readonly status: 'pending' | 'executed' | 'disrupted';
  /** The stage's deadline. */
  readonly deadline: GameTime;
  /** The prose summaries of the stage's traces — what it would have shown. */
  readonly traces: readonly string[];
}

/**
 * One Case File Claim that was a lie (Req 19.6, "which Claims were lies"). A
 * Claim is a lie when either a recorded Claim-truth marks it a deliberate
 * falsehood (`lie: true`), or its Proposition simply did not hold in the Truth
 * Store at the time it was observed. `deliberate` distinguishes the two: a
 * deliberate lie versus an honest error that happened to be false.
 */
export interface DebriefLie {
  readonly claim: ClaimId;
  /** A readable rendering of the Claim's Proposition. */
  readonly text: string;
  /** True when the Truth Store recorded this as a deliberate falsehood. */
  readonly deliberate: boolean;
}

/**
 * One lead the player chased that turned out to be noise (Req 19.6, "which leads
 * were Side Threads or Rumours"). It names the Case File Claim and whether the
 * lead traced to a Side Thread or a Rumour, with the provenance id so the TUI
 * can group leads by their source.
 */
export interface DebriefLead {
  readonly claim: ClaimId;
  /** A readable rendering of the Claim's Proposition. */
  readonly text: string;
  /** Whether the lead was a Side Thread or a Rumour. */
  readonly kind: 'side-thread' | 'rumour';
  /** The Side Thread id the lead traced to, when `kind === 'side-thread'`. */
  readonly thread?: string;
}

/**
 * One Proposition the player fed a doubled agent, with its ground-truth
 * classification (Req 19.6, "Propositions with their classification"; design,
 * "Feed ingestion"). `chickenfeed` is low-value *true* information (it held in
 * the Truth Store at delivery); `deception` is a planted falsehood (it did not).
 */
export interface DebriefFedProposition {
  /** The agent the Proposition was fed through. */
  readonly agent: NpcId;
  /** A readable rendering of the fed Proposition. */
  readonly text: string;
  /** The ground-truth classification at delivery. */
  readonly classification: 'chickenfeed' | 'deception';
}

/**
 * One Directive's result (Req 8.3 / 19.6, "Directive results"). The player-facing
 * wording and the lifecycle status the Sim left it in: `met`, `failed`, or still
 * `open` when the game ended before it came due.
 */
export interface DebriefDirectiveResult {
  readonly id: string;
  /** The player-facing wording of the objective. */
  readonly text: string;
  readonly status: 'open' | 'met' | 'failed';
  /** The Standing the Directive moved on success (+) or failure (−). */
  readonly reward: number;
}

/**
 * The player's score and grading accuracy (Req 8.3 / 19.6, "the player's grading
 * accuracy"). The score grades how well the Case File matched ground truth; the
 * accuracy figures measure the player's Admiralty grading against the actual
 * truth of the Claims they graded.
 *
 * - `standing` is the final Station Standing — the game's own running score.
 * - `claimsTotal` / `claimsTrue` count every Case File Claim and how many of
 *   them actually held in the Truth Store (the raw signal-vs-noise reckoning).
 * - `gradedTotal` is how many Claims the player assigned an Admiralty Grade.
 * - `gradedCorrect` is how many of those graded Claims the player judged in the
 *   right direction: a credible grade (credibility 1–3) on a Claim that held,
 *   or a doubtful grade (4–6) on one that did not.
 * - `gradingAccuracy` is `gradedCorrect / gradedTotal` in `[0, 1]` (0 when the
 *   player graded nothing — there is nothing to be accurate about).
 */
export interface DebriefScore {
  readonly standing: number;
  readonly claimsTotal: number;
  readonly claimsTrue: number;
  readonly gradedTotal: number;
  readonly gradedCorrect: number;
  readonly gradingAccuracy: number;
}

/**
 * The complete end-of-game debrief (design, Debrief screen; Req 8.3, 19.6). A
 * plain, serialisable snapshot of the revealed ground truth and the player's
 * final reckoning. Returned by {@link buildDebrief} and by the facade's
 * `views.debrief()` once the game has ended.
 */
export interface DebriefView {
  /** The final outcome tag. */
  readonly outcome: Outcome;
  /** When the game ended. */
  readonly endedAt: GameTime;
  /** The abort / disruption / burn cause recorded on the end. */
  readonly cause: string;
  /** Every NPC's true allegiance versus the one they presented. */
  readonly allegiances: readonly DebriefAllegiance[];
  /** The actual Plot timeline, stage by stage. */
  readonly timeline: readonly DebriefTimelineEntry[];
  /** The Case File Claims that were lies. */
  readonly lies: readonly DebriefLie[];
  /** The leads the player chased that were Side Threads or Rumours. */
  readonly noiseLeads: readonly DebriefLead[];
  /** The Propositions the player fed, each tagged chickenfeed or deception. */
  readonly fedPropositions: readonly DebriefFedProposition[];
  /** Each Directive's result. */
  readonly directives: readonly DebriefDirectiveResult[];
  /** The score and the player's grading accuracy. */
  readonly score: DebriefScore;
}

// ---------------------------------------------------------------------------
// Recorded feed deliveries (the debrief input)
// ---------------------------------------------------------------------------

/**
 * One recorded feed delivery, the input the debrief classifies. A delivery is a
 * hidden `feed-delivered` Sim event: a turned agent carried the player's feed to
 * its handler at `at`, with the fed Propositions. The debrief re-derives each
 * Proposition's chickenfeed/deception classification from the Truth Store at the
 * delivery time, exactly as the Hostile Service's feed ingestion did (design,
 * "Feed ingestion": classification is `chickenfeed` when `truth.holds(p, at)`),
 * so the recorded delivery need not carry the classification itself.
 *
 * The facade threads these in from the game's recorded feed deliveries; a game
 * with no doubled-agent feeds supplies an empty list and the fed-Propositions
 * section is empty.
 */
export interface RecordedFeed {
  /** The agent the feed was carried through. */
  readonly agent: NpcId;
  /** The fed Propositions, in delivery order. */
  readonly props: readonly Proposition[];
  /** The time the feed was delivered (when classification is evaluated). */
  readonly at: GameTime;
}

// ---------------------------------------------------------------------------
// buildDebrief
// ---------------------------------------------------------------------------

/**
 * Build the end-of-game {@link DebriefView} from the ended world and ground
 * truth (design, Debrief screen; Req 8.3, 19.6). Pure: it reads the inputs and
 * returns a fresh, plain view with no {@link Truth}-branded field, no draws and
 * no mutation.
 *
 * It must only be called on an ended world — the caller (`views.debrief()`)
 * checks `state.ended` first and returns `null` otherwise — but it defends
 * against a missing `ended` by falling back to the current time and a neutral
 * cause, so a mis-timed call cannot throw.
 *
 * @param state  the ended {@link WorldState}.
 * @param truth  the ground truth: the Truth Store, read through {@link TruthReader}.
 * @param caseFile the player's {@link CaseFile}.
 * @param feeds  the recorded feed deliveries (empty when the player fed no one).
 */
export function buildDebrief(
  state: WorldState,
  truth: TruthReader,
  caseFile: CaseFile,
  feeds: readonly RecordedFeed[] = [],
): DebriefView {
  const endedAt = state.ended?.at ?? state.time;
  const cause = state.ended?.cause ?? 'unknown';
  const outcome: Outcome = state.ended?.outcome ?? '';

  return {
    outcome,
    endedAt,
    cause,
    allegiances: revealAllegiances(state, truth),
    timeline: buildTimeline(state),
    lies: findLies(state, truth, caseFile),
    noiseLeads: findNoiseLeads(state, caseFile),
    fedPropositions: classifyFeeds(truth, feeds),
    directives: directiveResults(state),
    score: scoreGrading(state, truth, caseFile),
  };
}

// ---------------------------------------------------------------------------
// True allegiances (Req 19.6)
// ---------------------------------------------------------------------------

/**
 * Reveal every NPC's true allegiance next to the one they presented. The true
 * org is read from the Truth Store's recorded {@link import('@tradecraft/engine').Allegiance}
 * (the mole and any double agent carry one that differs from their role), and
 * marked `deceptive` when it does not match the NPC's `apparentAllegiance`
 * category. NPCs are listed in id order so the view is deterministic.
 */
function revealAllegiances(
  state: WorldState,
  truth: TruthReader,
): DebriefAllegiance[] {
  const out: DebriefAllegiance[] = [];
  const npcIds = (Object.keys(state.npcs) as NpcId[]).sort(compareIds);
  for (const npc of npcIds) {
    const record = state.npcs[npc];
    if (record === undefined) {
      continue;
    }
    const allegiance = truth.allegiance(npc);
    const trueOrg = allegiance === undefined ? undefined : revealTruth(allegiance).org;
    const trueOrgName = trueOrg === undefined ? undefined : state.orgs[trueOrg]?.name;
    const apparent = record.apparentAllegiance;
    // The NPC's apparent category is deceptive when the org it truly serves
    // projects a different allegiance category than the one it presents.
    const trueCategory = trueOrg === undefined ? undefined : state.orgs[trueOrg]?.allegiance;
    const deceptive = trueCategory !== undefined && trueCategory !== apparent;
    out.push({
      npc,
      name: record.persona.name,
      role: record.role,
      apparent,
      ...(trueOrg !== undefined ? { trueOrg } : {}),
      ...(trueOrgName !== undefined ? { trueOrgName } : {}),
      deceptive,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The actual Plot timeline (Req 19.6)
// ---------------------------------------------------------------------------

/**
 * Build the actual Plot timeline from the Plot's stage DAG. The stages are
 * already in DAG order (the generator lays them down topologically); each entry
 * carries the status the Sim left it in — the record of what the Cell really
 * did, which the player could only infer during play.
 */
function buildTimeline(state: WorldState): DebriefTimelineEntry[] {
  return state.plot.stages.map((stage) => ({
    stage: stage.id,
    templateId: stage.templateId,
    status: stage.status,
    deadline: stage.deadline,
    traces: stage.traces.map((t) => t.template),
  }));
}

// ---------------------------------------------------------------------------
// Lies (Req 19.6)
// ---------------------------------------------------------------------------

/**
 * Find the Case File Claims that were lies. Two sources mark a Claim a lie:
 *
 * 1. a recorded Claim-truth whose Proposition id matches the Claim's and whose
 *    `lie` flag is set — a deliberate falsehood the Sim pinned when the Claim
 *    was extracted; or
 * 2. the Claim's Proposition simply does not hold in the Truth Store at the time
 *    it was observed — a false Claim, whether or not a Claim-truth was recorded
 *    (a Document assertion, an Intercept or a surveillance read carries no
 *    speaker, so it has no Claim-truth, yet it can still be false).
 *
 * A Claim-truth's `lie` flag takes precedence for the `deliberate` tag; a Claim
 * that is merely false (does not hold) is reported as a non-deliberate lie.
 * Claims are listed in id order so the view is deterministic.
 */
function findLies(
  state: WorldState,
  truth: TruthReader,
  caseFile: CaseFile,
): DebriefLie[] {
  // Index the recorded Claim-truths by the Proposition id they pin (the Claim
  // id, per the design's "its `id` is the Claim id").
  const truthByProp = new Map<string, boolean>();
  for (const record of truth.claimTruths()) {
    const r = revealTruth(record);
    // Last write wins; a Claim is extracted once, so collisions are benign.
    truthByProp.set(r.claim.id, r.lie);
  }

  const out: DebriefLie[] = [];
  for (const claim of caseFile.list()) {
    const deliberate = truthByProp.get(claim.prop.id);
    const holds = truth.holds(claim.prop, claim.observedAt);
    const isLie = deliberate === true || !holds;
    if (!isLie) {
      continue;
    }
    out.push({
      claim: claim.id,
      text: renderProposition(claim.prop),
      deliberate: deliberate === true,
    });
  }
  return out.sort((a, b) => compareIds(a.claim, b.claim));
}

// ---------------------------------------------------------------------------
// Side-Thread and Rumour leads (Req 19.6)
// ---------------------------------------------------------------------------

/**
 * Find the leads the player chased that were noise — Side Threads or Rumours.
 *
 * A **Side-Thread** lead is a Case File Claim whose Proposition id was minted by
 * a Side Thread (`prop:thread/<n>/…`) or whose subject/object is a Side-Thread
 * participant *and* whose place is one the thread's traces used — i.e. a Claim
 * that reports a Side Thread's activity. The Proposition-id match is the firm
 * signal (a Claim extracted from a Side-Thread trace or Channel carries the
 * thread's minted PropId); the participant match catches a Claim the player made
 * by observing a thread's people. The matching thread id is reported.
 *
 * A **Rumour** lead is a Case File Claim whose Proposition id was minted by the
 * Rumour step (`prop:rumour/<n>`) — a distorted false belief that circulated as
 * gossip. These never hold in the Truth Store, so they also show up among the
 * lies; reporting them here as *leads* tells the player the Claim was noise they
 * spent effort on, not merely false.
 *
 * Claims are listed in id order so the view is deterministic. A Claim that
 * matches both (unusual) is reported once, as a Side Thread (the stronger
 * provenance).
 */
function findNoiseLeads(state: WorldState, caseFile: CaseFile): DebriefLead[] {
  // The Side-Thread provenance: minted PropId prefixes and the participant/
  // Location sets per thread, so a Claim can be matched to the thread it reports.
  const threadByPropPrefix = new Map<string, string>();
  const threadParticipants = new Map<string, Set<EntityId>>();
  const threadLocations = new Map<string, Set<EntityId>>();
  for (const thread of state.sideThreads) {
    threadByPropPrefix.set(`prop:thread/${localThreadIndex(thread.id)}/`, thread.id);
    const parts = new Set<EntityId>(thread.participants);
    const locs = new Set<EntityId>();
    for (const trace of thread.traces) {
      locs.add(trace.loc);
    }
    threadParticipants.set(thread.id, parts);
    threadLocations.set(thread.id, locs);
  }

  const out: DebriefLead[] = [];
  for (const claim of caseFile.list()) {
    const propId = claim.prop.id;

    // Firm Side-Thread signal: the Claim carries a thread-minted PropId.
    const threadByPrefix = matchThreadByPropId(propId, threadByPropPrefix);
    if (threadByPrefix !== undefined) {
      out.push({
        claim: claim.id,
        text: renderProposition(claim.prop),
        kind: 'side-thread',
        thread: threadByPrefix,
      });
      continue;
    }

    // Firm Rumour signal: a Rumour-minted PropId.
    if (propId.startsWith('prop:rumour/')) {
      out.push({ claim: claim.id, text: renderProposition(claim.prop), kind: 'rumour' });
      continue;
    }

    // Softer Side-Thread signal: the Claim's entities are a thread's people, at
    // one of its Locations — the player watched a thread's cast.
    const threadByEntities = matchThreadByEntities(
      claim,
      threadParticipants,
      threadLocations,
    );
    if (threadByEntities !== undefined) {
      out.push({
        claim: claim.id,
        text: renderProposition(claim.prop),
        kind: 'side-thread',
        thread: threadByEntities,
      });
    }
  }
  return out.sort((a, b) => compareIds(a.claim, b.claim));
}

/** Match a PropId against the thread-minted prefixes; return the thread id. */
function matchThreadByPropId(
  propId: string,
  threadByPropPrefix: ReadonlyMap<string, string>,
): string | undefined {
  for (const [prefix, thread] of threadByPropPrefix) {
    if (propId.startsWith(prefix)) {
      return thread;
    }
  }
  return undefined;
}

/**
 * Match a Claim to a Side Thread by its named entities: both the subject (or an
 * entity object) is a thread participant and the Claim's place is one the thread
 * used. Threads are tried in id order so the match is deterministic.
 */
function matchThreadByEntities(
  claim: Claim,
  threadParticipants: ReadonlyMap<string, Set<EntityId>>,
  threadLocations: ReadonlyMap<string, Set<EntityId>>,
): string | undefined {
  const place = claim.prop.place;
  if (place === undefined) {
    return undefined;
  }
  const subject = claim.prop.subject;
  const object = typeof claim.prop.object === 'string' ? claim.prop.object : undefined;
  const threads = [...threadParticipants.keys()].sort(compareIds);
  for (const thread of threads) {
    const parts = threadParticipants.get(thread);
    const locs = threadLocations.get(thread);
    if (parts === undefined || locs === undefined) {
      continue;
    }
    const touchesParticipant =
      parts.has(subject) || (object !== undefined && parts.has(object));
    if (touchesParticipant && locs.has(place)) {
      return thread;
    }
  }
  return undefined;
}

/** The numeric index part of a `thread:<n>` id, for building its PropId prefix. */
function localThreadIndex(threadId: string): string {
  const colon = threadId.lastIndexOf(':');
  return colon === -1 ? threadId : threadId.slice(colon + 1);
}

// ---------------------------------------------------------------------------
// Fed Propositions (Req 19.6; design "Feed ingestion")
// ---------------------------------------------------------------------------

/**
 * Classify every fed Proposition as `chickenfeed` or `deception` from the Truth
 * Store (design, "Feed ingestion": classification is `chickenfeed` if the
 * Proposition held at delivery, else `deception`). The classification is ground
 * truth, revealed only now in the debrief. Deliveries are read in recorded
 * order, each Proposition in delivery order, so the list is deterministic.
 */
function classifyFeeds(
  truth: TruthReader,
  feeds: readonly RecordedFeed[],
): DebriefFedProposition[] {
  const out: DebriefFedProposition[] = [];
  for (const feed of feeds) {
    for (const prop of feed.props) {
      const classification = truth.holds(prop, feed.at) ? 'chickenfeed' : 'deception';
      out.push({ agent: feed.agent, text: renderProposition(prop), classification });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Directive results (Req 8.3, 19.6)
// ---------------------------------------------------------------------------

/**
 * Report each Directive's result: the player-facing wording, the lifecycle
 * status the Sim left it in, and the Standing it moved. Directives are listed in
 * the order the Station issued them (the order they appear in the state).
 */
function directiveResults(state: WorldState): DebriefDirectiveResult[] {
  return state.station.directives.map((d) => ({
    id: d.id,
    text: d.text,
    status: d.status,
    reward: d.reward,
  }));
}

// ---------------------------------------------------------------------------
// Score and grading accuracy (Req 8.3)
// ---------------------------------------------------------------------------

/**
 * Score the player's Case File against ground truth (Req 8.3). It counts every
 * Claim and how many held in the Truth Store (signal vs noise), and measures the
 * player's Admiralty grading: a graded Claim is scored *correct* when the
 * player's credibility digit points the right way — a credible grade (1–3) on a
 * Claim that held, or a doubtful grade (4–6) on one that did not. The accuracy
 * is the fraction of graded Claims judged correctly, 0 when nothing was graded.
 */
function scoreGrading(
  state: WorldState,
  truth: TruthReader,
  caseFile: CaseFile,
): DebriefScore {
  const claims = caseFile.list();
  let claimsTrue = 0;
  let gradedTotal = 0;
  let gradedCorrect = 0;

  for (const claim of claims) {
    const holds = truth.holds(claim.prop, claim.observedAt);
    if (holds) {
      claimsTrue += 1;
    }
    if (claim.grade !== undefined) {
      gradedTotal += 1;
      if (gradeMatchesTruth(claim.grade, holds)) {
        gradedCorrect += 1;
      }
    }
  }

  const gradingAccuracy = gradedTotal === 0 ? 0 : gradedCorrect / gradedTotal;
  return {
    standing: state.station.standing,
    claimsTotal: claims.length,
    claimsTrue,
    gradedTotal,
    gradedCorrect,
    gradingAccuracy,
  };
}

/**
 * Whether a player's Admiralty Grade points the right way for a Claim's actual
 * truth. The credibility digit is the player's confidence the *information* is
 * true: `1`–`3` lean credible, `4`–`6` lean doubtful. A credible grade on a
 * Claim that held, or a doubtful grade on one that did not, is a correct call.
 */
function gradeMatchesTruth(grade: AdmiraltyGrade, holds: boolean): boolean {
  const credible = grade.credibility <= 3;
  return credible === holds;
}

// ---------------------------------------------------------------------------
// Rendering and ordering helpers
// ---------------------------------------------------------------------------

/**
 * A compact, readable rendering of a Proposition for the debrief, from its
 * structural parts: `SUBJECT PREDICATE OBJECT [@ place] [window]`. The predicate
 * is shown by its bare local name (the pack namespace stripped). This is debug-
 * grade prose for the reveal, not the Narrator's rendered Fact Line — the game
 * is over, so the structural form is the honest, unambiguous view.
 */
function renderProposition(prop: Proposition): string {
  const predicate = localName(prop.predicate);
  const object = renderObject(prop.object);
  const place = prop.place === undefined ? '' : ` @ ${prop.place}`;
  const window =
    prop.window === undefined
      ? ''
      : ` [${formatTime(prop.window.from)}${
          prop.window.to === undefined ? '' : `–${formatTime(prop.window.to)}`
        }]`;
  return `${prop.subject} ${predicate} ${object}${place}${window}`;
}

/** Render a Proposition object: an entity id as-is, or a literal by its value. */
function renderObject(object: EntityId | Literal): string {
  if (typeof object === 'string') {
    return object;
  }
  switch (object.kind) {
    case 'text':
      return `"${object.value}"`;
    case 'amount':
      return String(object.value);
    case 'time':
      return formatTime(object.value);
  }
}

/** A compact `d<day>.<phase>` rendering of a game time. */
function formatTime(time: GameTime): string {
  return `d${time.day}.${time.phase}`;
}

/** The bare local id of a (possibly namespaced `<pack>/<name>`) id. */
function localName(id: string): string {
  const slash = id.lastIndexOf('/');
  return slash === -1 ? id : id.slice(slash + 1);
}

/** A total, deterministic string ordering for ids. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
