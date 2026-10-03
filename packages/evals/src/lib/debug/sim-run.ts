/**
 * The `sim` debug CLI's logic (checkpoint 12; design, "Engine inspection").
 *
 * `runScript(seed, actions, inputs)` runs a scripted list of {@link Action}s
 * through the PURE engine — no model, no live anything — and returns the Fact
 * Lines each action produced together with the resulting Case File. It is the
 * operator tool a developer uses to drive the engine deterministically and read
 * back exactly what a sequence of actions does to the fact record.
 *
 * The driving loop mirrors the golden-replay runner and the eval-fixture setup
 * driver (the two other model-free engine drivers in this package): generate the
 * world and its Truth Store from `(seed, inputs)` with {@link generateGame},
 * resume a single PRNG from the world's serialised `rng`, and fold the actions
 * through {@link resolve} in order, persisting the advanced PRNG state back onto
 * the world after each step so the stream threads forward exactly as a real
 * session would. An End Condition `resolve` reports is written to
 * `WorldState.ended` as the Turn Pipeline writes it, so the final state shows a
 * game the script ended. The clock is advanced by each action's quoted phase
 * cost.
 *
 * Each action's `proposition` Observations become Case File {@link Claim}s,
 * sourced by the action kind the way the Player View's own claim adders source
 * them (a read → `document`, a surveil/follow/wait → `surveillance`, an
 * intercept → `intercept`, a talk/approach → `npc`). The result is a real
 * {@link CaseFile}, so the dump shows the same corroboration/conflict relations
 * the player would see.
 *
 * Pure with respect to Truth: the Case File never unwraps a Truth-branded value;
 * it records only the already-reported Propositions the engine surfaced to the
 * player, exactly as the Player-View claim adders do.
 */

import {
  addPhases,
  createPrng,
  generateGame,
  quote,
  resolve,
  type Action,
  type ActionResult,
  type GameTime,
  type GenerateInputs,
  type Literal,
  type NpcId,
  type Proposition,
  type ResolverContext,
  type WorldState,
} from '@tradecraft/engine';
import { CaseFile, listClaims, type ClaimView } from '@tradecraft/player-view';

import { buildInputs, type DifficultyPresetId } from '../replays/fixtures.js';

/** The outcome of one scripted step: its action, cost, fact lines and status. */
export interface ScriptedStep {
  /** The step's index in the script (0-based). */
  readonly index: number;
  /** The action that was applied. */
  readonly action: Action;
  /** Whether the engine allowed the action (an un-allowed action is a no-op). */
  readonly allowed: boolean;
  /** The reason the action was rejected, when `allowed` is false. */
  readonly reason?: string;
  /** The phase cost the quote charged (0 for a rejected action). */
  readonly phases: number;
  /** The money cost the quote charged. */
  readonly money: number;
  /** The Fact Lines the action produced, in order. */
  readonly factLines: readonly string[];
}

/** The full result of running a script through the pure engine. */
export interface ScriptResult {
  /** The seed the world was generated from. */
  readonly seed: string;
  /** The final WorldState after folding every action. */
  readonly finalState: WorldState;
  /** One entry per scripted action, in order. */
  readonly steps: readonly ScriptedStep[];
  /** Every Fact Line produced across the whole script, flattened in order. */
  readonly factLines: readonly string[];
  /** The resulting Case File Claims, as a view-safe snapshot. */
  readonly claims: readonly ClaimView[];
}

/**
 * File an action's `proposition` Observations into the Case File, sourcing each
 * Claim the way the Player View's claim adders do for that action kind. A
 * `message` Observation carries a ready-made Fact Line, not a Proposition, so it
 * never becomes a Claim.
 */
function fileClaims(caseFile: CaseFile, action: Action, result: ActionResult): void {
  for (const obs of result.observations) {
    if (obs.kind !== 'proposition') continue;
    const source = sourceFor(action, obs.prop);
    if (source === undefined) continue;
    caseFile.add({ source, prop: obs.prop, observedAt: obs.at });
  }
}

/** The Case File source an action's observed Proposition is filed under. */
function sourceFor(
  action: Action,
  prop: Proposition,
): Parameters<CaseFile['add']>[0]['source'] | undefined {
  switch (action.kind) {
    case 'read':
      return { kind: 'document', id: action.doc };
    case 'surveil':
      return { kind: 'surveillance', loc: action.at };
    case 'follow':
    case 'wait':
      // A follow/wait observes at the Proposition's own place when it has one.
      return prop.place === undefined
        ? undefined
        : { kind: 'surveillance', loc: prop.place };
    case 'intercept':
      // The intercept action reports message metadata; a broken Intercept's
      // recovered Propositions are filed as `intercept` Claims.
      return prop.place === undefined
        ? undefined
        : { kind: 'surveillance', loc: prop.place };
    case 'talk':
    case 'approach':
      return prop.subject.startsWith('npc:')
        ? { kind: 'npc', npc: prop.subject as NpcId }
        : undefined;
    default:
      return undefined;
  }
}

/**
 * Run a scripted list of actions through the pure engine and collect the Fact
 * Lines and the resulting Case File (checkpoint 12). Deterministic in
 * `(seed, actions, inputs)`: one world is generated, one PRNG is resumed from
 * it, and every action is folded through `resolve` with the advanced stream
 * persisted back onto the world after each step.
 */
export function runScript(
  seed: string,
  actions: readonly Action[],
  inputs: GenerateInputs = buildInputs(),
): ScriptResult {
  const { world: initial, truth } = generateGame(seed, inputs);
  let world = initial;
  const rng = createPrng(world.rng);
  const ctx: ResolverContext = { content: inputs.content, truth };
  const caseFile = new CaseFile();
  let at: GameTime = world.time;

  const steps: ScriptedStep[] = [];
  const allFactLines: string[] = [];

  actions.forEach((action, index) => {
    const q = quote(world, action, ctx);
    const { next, result, ended } = resolve(world, action, rng, ctx);
    // Persist the advanced PRNG stream onto the world, exactly as a replay would,
    // and write an End Condition the action produced (an arrest of the Cell
    // leader, a seizure of the Plot materiel) the way the Turn Pipeline commits
    // it: the first end wins.
    world = {
      ...next,
      rng: rng.state(),
      ...(ended !== undefined && next.ended === undefined ? { ended } : {}),
    };
    if (q.allowed) {
      at = addPhases(at, Math.max(1, q.phases));
      fileClaims(caseFile, action, result);
    }

    steps.push({
      index,
      action,
      allowed: q.allowed,
      reason: q.reason,
      phases: q.phases,
      money: q.money,
      factLines: result.factLines,
    });
    allFactLines.push(...result.factLines);
  });

  return {
    seed,
    finalState: world,
    steps,
    factLines: allFactLines,
    claims: listClaims(caseFile),
  };
}

/** Format a {@link GameTime} compactly for a Claim's observation time. */
function formatTime(t: GameTime): string {
  return `d${t.day}.p${t.phase}`;
}

/** Format a Proposition's object (an entity id or a {@link Literal}). */
function formatObject(object: Proposition['object']): string {
  if (typeof object === 'string') return object;
  const lit = object as Literal;
  if (lit.kind === 'time') return `time(${formatTime(lit.value)})`;
  return `${lit.kind}(${String(lit.value)})`;
}

/** Render one Claim as a single line. */
function formatClaim(claim: ClaimView): string {
  const p = claim.prop;
  const place = p.place === undefined ? '' : ` @${p.place}`;
  return `  [${claim.relation}] (${claim.source.kind}) ${p.subject} --${p.predicate}--> ${formatObject(
    p.object,
  )}${place}  (${formatTime(claim.observedAt)})`;
}

/**
 * Render a {@link ScriptResult} as human-readable, sectioned text for stdout:
 * a per-step section (the action, whether it was allowed, its cost and its Fact
 * Lines) and the resulting Case File.
 */
export function renderSimReport(result: ScriptResult): string {
  const stepSections = result.steps.map((step) => {
    const header = `-- step ${step.index}: ${step.action.kind} ${
      step.allowed ? `(ok, +${step.phases}ph, -${step.money}$)` : `(REJECTED: ${step.reason ?? 'not allowed'})`
    }`;
    const lines =
      step.factLines.length === 0
        ? ['    (no fact lines)']
        : step.factLines.map((line) => `    ${line}`);
    return [header, ...lines].join('\n');
  });

  const claimLines =
    result.claims.length === 0
      ? ['  (no claims)']
      : result.claims.map(formatClaim);

  return [
    `== Sim: seed ${result.seed} ==`,
    `actions: ${result.steps.length}   fact lines: ${result.factLines.length}   claims: ${result.claims.length}`,
    '',
    '== Fact Lines (per action) ==',
    ...stepSections,
    '',
    '== Case File ==',
    ...claimLines,
    '',
  ].join('\n');
}

/** Re-exported for the `sim` script's `--preset` passthrough, if it wants one. */
export type { DifficultyPresetId };
