/**
 * The Player-View Objective Evaluator (slice-integration task 7.4; design,
 * "Player View: Objective Evaluator"; Requirements 6.1, 6.2, 6.3).
 *
 * The engine's Directive check ({@link checkDirectives}) does not decide for
 * itself whether a Directive objective is met: whether the player has
 * identified the leader, recruited enough Assets, had an arrest granted or
 * collected an Intercept is PROGRESS that lives on the Player-View / Case File
 * side (and in the Sim's record of the player's own completed actions), never in
 * the raw Truth Store. So the engine takes an injected {@link ObjectiveEvaluator}
 * — a pure `(objective, at) => boolean` — and the Pipeline supplies it.
 * {@link buildObjectiveEvaluator} is that supplier.
 *
 * The Phase Step calls `deps.objectives(draft)` once per phase to get an
 * evaluator over the current draft (`AdvanceWorldDeps.objectives:
 * (draft: WorldState) => ObjectiveEvaluator`), so the factory takes the draft's
 * fields and returns the evaluator closure. It is a pure function of its inputs:
 * the {@link WorldState} draft and the player's {@link CaseFile}. It reads no
 * Truth Store and no `Truth`-branded field (Req 6.3, 6.5), so modifying ground
 * truth without changing the player's recorded actions leaves every result
 * unchanged.
 *
 * ## Which side each objective reads
 *
 * The switch is exhaustive over {@link DIRECTIVE_OBJECTIVE_KINDS} (Req 6.1).
 *
 * | Objective          | Met when | Source |
 * |--------------------|----------|--------|
 * | `identify(entity)` | the entity is identified: it is in `player.known.entities`, or an `unk:` id resolves to it through a held `IS_ALIAS_OF` Claim in the Case File (Req 6.2) | Player View + Case File |
 * | `recruit(count)`   | at least `count` Relationships are `recruited` | the player's recorded recruitments (Req 6.3) |
 * | `arrest(entity)`   | the entity is in `player.arrests`, by its id or by the `unk:` id the player knows it by | the player's recorded arrests (Req 6.3) |
 * | `intercept(chan)`  | some collected Intercept in `WorldState.intercepts` is on `chan` | the player's collected Intercepts (Req 6.3) |
 *
 * Objective evaluation does not depend on `at`: a progress objective is met the
 * moment the progress is recorded and stays met. The parameter is part of the
 * engine's {@link ObjectiveEvaluator} contract (a truth-side objective could
 * need it) and is accepted but unused here.
 *
 * Nothing here mutates its inputs.
 */

import type {
  DirectiveObjective,
  EntityId,
  GameTime,
  NpcId,
  ObjectiveEvaluator,
  UnkId,
  WorldState,
} from '@tradecraft/engine';

import type { CaseFile } from '../casefile/casefile.js';

/**
 * The Player-View and Case File inputs {@link buildObjectiveEvaluator} reads.
 * The shape is structural — a bag of fields, not the Session type — so the Turn
 * Pipeline (task 8.1) can hand it the draft {@link WorldState} and the live
 * {@link CaseFile} off its Session without this module depending on the Session.
 */
export interface ObjectiveEvaluatorInput {
  /** The world draft whose player progress (arrests, recruitments, intercepts) is read. */
  readonly state: WorldState;
  /** The player's Case File, for alias-resolving an `identify` objective's entity. */
  readonly caseFile: CaseFile;
}

/**
 * Build the engine {@link ObjectiveEvaluator} for the current draft from
 * Player-View and Case File data (Req 6.1–6.3). The returned closure is pure and
 * reads no truth; see the module documentation for the per-kind rule.
 */
export function buildObjectiveEvaluator(
  input: ObjectiveEvaluatorInput,
): ObjectiveEvaluator {
  const { state, caseFile } = input;

  // The player's recorded recruitments: Relationships flipped `recruited` by a
  // landed pitch. This is the player's own record, not ground truth.
  const recruitedCount = Object.values(state.relationships).filter(
    (rel) => rel.recruited,
  ).length;

  // The Station's granted-arrest record, as a set for membership tests. A
  // granted `arrest` appends the entity (by `npc:` id or by the `unk:` id the
  // player knew the target by), so an arrest of an Unidentified Subject is here
  // under its `unk:` id.
  const arrestRecord = new Set<EntityId>(state.player.arrests);
  // The `npc: -> unk:` map so an `arrest(npc:X)` objective is met when the
  // player's record holds the matching `unk:` id (and vice versa), mirroring how
  // the live Disruption Context (`liveDisruption`) and `leaderArrestedByStation`
  // read the record.
  const unkIds = state.player.unkIds;

  // The Channels the player has collected an Intercept off. `WorldState.intercepts`
  // is the player's collected set (the intercept action delivers into it), and
  // each Intercept names its originating Channel.
  const interceptChannels = new Set<string>(
    Object.values(state.intercepts).map((intercept) => intercept.channel),
  );

  // The Case File's alias resolver, so an `identify` objective naming one id is
  // met when the player knows the same person under another id linked by a held
  // `IS_ALIAS_OF` Claim. Resolving the known set once keeps the closure cheap.
  const canon = caseFile.aliases();
  const knownClasses = new Set<EntityId>(
    state.player.known.entities.map((id) => canon(id)),
  );

  return (objective: DirectiveObjective, _at: GameTime): boolean => {
    switch (objective.kind) {
      case 'identify':
        return isIdentified(objective.entity, knownClasses, canon);
      case 'recruit':
        return recruitedCount >= objective.count;
      case 'arrest':
        return isArrested(objective.entity, arrestRecord, unkIds);
      case 'intercept':
        return interceptChannels.has(objective.channel);
    }
  };
}

/**
 * Whether the player has identified `entity`: it (or the person it is linked to
 * through a held `IS_ALIAS_OF` Claim) is in `player.known.entities`. The entity
 * is resolved to its alias-class representative and compared against the known
 * set's representatives, so a `npc:` objective met via a known `unk:` alias — or
 * the reverse — both read as identified. A directly-known id resolves to itself,
 * so the simple case falls out of the same check.
 */
function isIdentified(
  entity: EntityId,
  knownClasses: ReadonlySet<EntityId>,
  canon: (id: EntityId) => EntityId,
): boolean {
  return knownClasses.has(canon(entity));
}

/**
 * Whether the Station has granted an arrest of `entity`: the record names it by
 * its own id, or by the `unk:` id the player knows the matching NPC by (so an
 * `arrest(npc:X)` objective is met by an arrest recorded against `unk:N` and the
 * reverse).
 */
function isArrested(
  entity: EntityId,
  arrestRecord: ReadonlySet<EntityId>,
  unkIds: Readonly<Record<NpcId, UnkId>>,
): boolean {
  if (arrestRecord.has(entity)) {
    return true;
  }
  // The objective may name the `npc:` id while the record holds the `unk:` id.
  const alias = unkIds[entity as NpcId];
  if (alias !== undefined && arrestRecord.has(alias)) {
    return true;
  }
  // The objective may name a `unk:` id while the record holds the `npc:` id.
  for (const [npc, unk] of Object.entries(unkIds)) {
    if (unk === entity && arrestRecord.has(npc as EntityId)) {
      return true;
    }
  }
  return false;
}
