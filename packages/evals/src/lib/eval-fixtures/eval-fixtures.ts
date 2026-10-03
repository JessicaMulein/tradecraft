/**
 * The scenario-fixture format and the five required eval fixtures (task 23.1;
 * Req 18.1, 18.5).
 *
 * This is the data layer the model evaluation harness (Req 18) runs against. A
 * fixture is "a seed plus scripted player lines or actions" (Req 18.1): a fixed
 * {@link GenerateInputs} the world is regenerated from, a deterministic game
 * `seed`, a `scenario` tag naming which of the five evaluation scenes it
 * exercises (Req 18.5), and an ordered {@link FixtureScript} of steps. A step is
 * either a **player line** (a dialogue utterance the harness feeds to the
 * `voice`/`narrator` model and scores) or a **player action** (an engine
 * {@link Action} — the task's "TurnIntent" — that drives the world into the
 * situation the scene needs).
 *
 * ## Why the format splits lines from actions
 *
 * The replay machinery next door (`../replays/`) drives model-free `wait` and
 * `travel` through the pure engine `resolve`; that is the whole of a golden
 * replay. An eval scene is richer: it must get the world into a specific state
 * (the player standing in front of a known mole, a Dangle in play, a Case File
 * holding a Claim that contradicts the NPC's cover) and *then* exercise the
 * model with scripted dialogue. So a fixture interleaves two step kinds:
 *
 *   - **`act`** — an engine {@link Action}. These are the deterministic setup
 *     moves: travel to the Location, surveil it, wait for a slot, open the talk
 *     scene. The model-free ones resolve through the pure engine exactly as a
 *     replay does; the harness applies them in order to arrange the scene.
 *   - **`say`** — a player dialogue line. This is the utterance the harness
 *     sends through the Dialogue Loop so the `voice`/`narrator` model answers in
 *     character, and the mechanical guards (23.2) and the judge (23.3) score the
 *     reply. A line carries no engine effect of its own; it is the player's
 *     half of the scene the model voices the other half of.
 *
 * The `say` step is modelled as plain data here rather than a `@tradecraft/dialogue`
 * type on purpose: `@tradecraft/evals` depends on engine/content/llm/player-view
 * but *not* on dialogue, so the fixture format stays within the package's
 * dependency boundary. 23.2/23.3 wire a `say` line through the dialogue harness
 * when they run the scene against a model.
 *
 * ## Determinism and offline
 *
 * Every fixture names a fixed `seed` and reuses the shared {@link buildInputs}
 * from `../replays/fixtures.ts` (the core pack, the `standard` preset and a
 * fully-specified scenario with `mole: true`), so the regenerated world is a
 * pure function of `(seed, inputs)` (Req 1.2). No fixture needs a live model to
 * *load* or to *reach its scene*: the setup is engine actions, and the `say`
 * lines are data. When 23.2/23.3 drive a fixture against a model they do so
 * through the `ReplayGateway`/fake gateway seam, never a live endpoint.
 */

import { z } from 'zod';

import {
  createPrng,
  generate,
  generateGame,
  resolve,
  revealTruth,
  type Action,
  type GenerateInputs,
  type LocId,
  type NpcId,
  type ResolverContext,
  type Truth,
  type WorldState,
} from '@tradecraft/engine';

import { buildInputs } from '../replays/fixtures.js';

// ---------------------------------------------------------------------------
// The scenario tags (Req 18.5)
// ---------------------------------------------------------------------------

/**
 * The five evaluation scenes the harness must cover (Req 18.5). The tag is
 * carried on every fixture so 23.2 (mechanical metrics) and 23.3 (judge
 * scoring) can report per scene — the harness compares models "mole
 * interrogation vs mole interrogation", not fixture-id vs fixture-id.
 *
 * - `mole-interrogation`        — question an NPC who is the Station mole, under
 *   pressure, so the `voice` reply is graded for a lying officer holding cover.
 * - `recruitment-pitch`         — pitch a MICE lever at a potential Asset, so
 *   the reply is graded for a recruitment scene.
 * - `dangle-debrief`            — debrief a Walk-in the Hostile Service is
 *   running as a Dangle (bait), so the reply is graded for a provocation the
 *   player cannot yet tell from a genuine volunteer.
 * - `confrontation-contradiction` — confront an NPC with a Case File Claim that
 *   contradicts their cover, so the reply is graded under contradicting evidence.
 * - `surveillance-narration`    — narrate the result of a surveillance action,
 *   so the Narrator's prose is graded for fidelity to the observed facts.
 */
export const EVAL_SCENARIOS = [
  'mole-interrogation',
  'recruitment-pitch',
  'dangle-debrief',
  'confrontation-contradiction',
  'surveillance-narration',
] as const;

/** One of the five {@link EVAL_SCENARIOS} scene tags. */
export type EvalScenario = (typeof EVAL_SCENARIOS)[number];

export const EvalScenarioSchema = z.enum(EVAL_SCENARIOS);

// ---------------------------------------------------------------------------
// The fixture script (seed + scripted player lines or actions; Req 18.1)
// ---------------------------------------------------------------------------

/**
 * Who the harness should attribute a `say` line to when it voices the scene.
 * `player` is the officer's own line; `narration-request` is a cue that asks the
 * Narrator to describe the current situation (used by the surveillance scene,
 * where the "player line" is a request for narration rather than dialogue).
 */
export const SAY_SPEAKERS = ['player', 'narration-request'] as const;

export type SaySpeaker = (typeof SAY_SPEAKERS)[number];

/**
 * A scripted player line: a dialogue utterance (or a narration cue) the harness
 * feeds to the model. It carries no engine effect; it is the player's half of
 * the scene the model answers. `role` lets 23.2/23.3 route the line to the right
 * Model Role (`voice` for dialogue, `narrator` for a narration request).
 */
export interface SayStep {
  readonly kind: 'say';
  /** Whose line this is: the player, or a request for narration. */
  readonly speaker: SaySpeaker;
  /** The Model Role that should answer this line. */
  readonly role: 'voice' | 'narrator';
  /** The utterance text (or narration cue). */
  readonly text: string;
}

/**
 * A scripted player action: an engine {@link Action} (the task's "TurnIntent")
 * the harness applies through the pure engine to arrange the scene — travel to
 * the Location, surveil it, open the talk scene, confront with a Claim. These
 * are the deterministic setup moves; the model-free ones resolve exactly as a
 * golden replay does.
 */
export interface ActStep {
  readonly kind: 'act';
  readonly action: Action;
}

/** One step of a {@link FixtureScript}: a player line or a player action. */
export type FixtureStep = SayStep | ActStep;

/** The ordered script of player lines and/or actions a fixture runs. */
export type FixtureScript = readonly FixtureStep[];

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

/**
 * A scenario fixture (Req 18.1): a deterministic seed, the scene it exercises,
 * the ordered script, and a prose note recording the preconditions the fixture
 * arranges or assumes (e.g. "the mole is the questioned NPC", "a Dangle is in
 * play"). The precondition note is documentation for the harness and the reader;
 * where a precondition can be *arranged* by setup actions those actions are in
 * the script, and where it is a property of the generated world (the mole's
 * identity, a Dangle's genuineness) the note says so.
 */
export interface EvalFixture {
  /** A stable id, used in reports and as the fixture's directory-style name. */
  readonly id: string;
  /** Which of the five evaluation scenes this fixture exercises (Req 18.5). */
  readonly scenario: EvalScenario;
  /** The deterministic game seed the world is regenerated from (Req 1.2). */
  readonly seed: string;
  /** The ordered script of player lines and/or actions (Req 18.1). */
  readonly script: FixtureScript;
  /** The preconditions this fixture arranges or assumes, in prose. */
  readonly preconditions: string;
}

// ---------------------------------------------------------------------------
// Zod schema — the format a loader validates a fixture against
// ---------------------------------------------------------------------------

/**
 * The schema for a {@link SayStep}. The `text` must be non-empty — an empty
 * player line is a fixture bug, not a valid scene — and the `role` must match
 * the speaker (a `narration-request` is answered by the `narrator`, a `player`
 * line by `voice`), which the refinement enforces.
 */
export const SayStepSchema = z
  .object({
    kind: z.literal('say'),
    speaker: z.enum(SAY_SPEAKERS),
    role: z.enum(['voice', 'narrator']),
    text: z.string().min(1, 'a say line must have non-empty text'),
  })
  .strict()
  .refine(
    (s) =>
      (s.speaker === 'narration-request') === (s.role === 'narrator'),
    { message: 'a narration-request must use the narrator role, a player line the voice role' },
  );

/**
 * The schema for an {@link ActStep}. The engine `Action` union is large and
 * owned by `@tradecraft/engine`; validating its full shape here would duplicate
 * the engine's own schema. Instead this checks the step envelope — the `kind`
 * tag and that `action` carries a string `kind` — and leaves the deep structure
 * to the engine, which rejects a malformed action at `resolve` time. This keeps
 * the fixture schema a *format* check, not a re-implementation of the engine.
 */
export const ActStepSchema = z
  .object({
    kind: z.literal('act'),
    action: z
      .object({ kind: z.string().min(1) })
      .loose(),
  })
  .strict();

/** The schema for one {@link FixtureStep}. */
export const FixtureStepSchema = z.discriminatedUnion('kind', [
  SayStepSchema,
  ActStepSchema,
]);

/**
 * The schema for a whole {@link EvalFixture}. A fixture must name one of the
 * five scenes, carry a non-empty seed and a non-empty script, and have a prose
 * precondition note. The schema is the format gate the loader runs each fixture
 * through (Req 18.1).
 */
export const EvalFixtureSchema = z
  .object({
    id: z.string().min(1),
    scenario: EvalScenarioSchema,
    seed: z.string().min(1, 'a fixture must name a seed'),
    script: z
      .array(FixtureStepSchema)
      .min(1, 'a fixture must script at least one step'),
    preconditions: z.string().min(1, 'a fixture must document its preconditions'),
  })
  .strict();

// ---------------------------------------------------------------------------
// The five required fixtures (Req 18.5)
// ---------------------------------------------------------------------------

/**
 * Resolve a stable Location id by index into the regenerated world's id-sorted
 * Location list — the same world-independent naming the replay runner uses for
 * `travel` (so a fixture's `travel` step picks the same place on every replay).
 * Fixtures carry Location ids as indices through this helper rather than
 * hard-coding a generated `loc:` id, keeping them stable across a re-record.
 */
export function locByIndex(world: WorldState, index: number): LocId {
  const ids = Object.keys(world.city.locations).sort() as LocId[];
  if (ids.length === 0) throw new Error('world has no Locations');
  return ids[index % ids.length];
}

/** A deterministic `travel` act step to the index-named Location. */
function travelTo(world: WorldState, index: number, countersurveillance = false): ActStep {
  return {
    kind: 'act',
    action: { kind: 'travel', to: locByIndex(world, index), countersurveillance },
  };
}

/** A deterministic `wait` act step for `phases` phases. */
function wait(phases: 1 | 2 | 3 | 4): ActStep {
  return { kind: 'act', action: { kind: 'wait', phases } };
}

/** A player dialogue line answered by the `voice` model. */
function playerLine(text: string): SayStep {
  return { kind: 'say', speaker: 'player', role: 'voice', text };
}

/** A narration request answered by the `narrator` model. */
function narrationRequest(text: string): SayStep {
  return { kind: 'say', speaker: 'narration-request', role: 'narrator', text };
}

/**
 * Build the five required fixtures (Req 18.5) against a regenerated world. The
 * world is used only to resolve stable Location indices into concrete ids for
 * the setup `travel`/`surveil` steps — the fixtures are otherwise pure data and
 * depend on nothing drawn from the world, so the same `inputs` always yields the
 * same fixtures.
 *
 * Each fixture uses a distinct deterministic seed so the harness can run them
 * independently, and documents in `preconditions` what state its seed + script
 * arrange: which NPC is pressed, what the Case File must hold, and which
 * properties of the generated world (the mole's identity, a Dangle's
 * genuineness) the scene relies on. Where a precondition is a hidden property of
 * the world rather than something a player action can set, the note says the
 * harness must select the seed/NPC that satisfies it when it drives the scene
 * against a model (23.2/23.3) — 23.1 fixes the *format* and the scripted
 * lines/actions; it does not run the live scene.
 */
export function buildEvalFixtures(inputs: GenerateInputs = buildInputs()): readonly EvalFixture[] {
  // One shared world per seed, used only to resolve Location indices to ids.
  const worldFor = (seed: string): WorldState => generate(seed, inputs);

  const moleWorld = worldFor('vienna-eval-mole');
  const pitchWorld = worldFor('vienna-eval-pitch');
  const dangleWorld = worldFor('vienna-eval-dangle');
  const confrontWorld = worldFor('vienna-eval-confront');
  const surveilWorld = worldFor('vienna-eval-surveil');

  return [
    {
      id: 'mole-interrogation',
      scenario: 'mole-interrogation',
      seed: 'vienna-eval-mole',
      preconditions:
        'The scenario sets `mole: true`, so the generated Station has a mole ' +
        '(`world.station.mole`). The harness opens a talk scene with the mole ' +
        'and the player presses on access and loyalty. The scene grades the ' +
        "`voice` model voicing an officer who must lie to hold the mole's cover, " +
        'so no Leak Guard or Told-List contradiction trip should occur.',
      script: [
        // Walk the player to a populated Location and open the scene, then press.
        travelTo(moleWorld, 2),
        wait(1),
        { kind: 'act', action: { kind: 'talk', npc: moleIdOf(moleWorld) } },
        playerLine('You have access to the registry nobody else does. Who gave it to you?'),
        playerLine('I am not accusing you. I am asking you to account for the gaps in the duty log.'),
        playerLine("Then tell me plainly: whose instructions are you following when mine aren't in the file?"),
      ],
    },
    {
      id: 'recruitment-pitch',
      scenario: 'recruitment-pitch',
      seed: 'vienna-eval-pitch',
      preconditions:
        'The harness cold-approaches a potential Asset, opens a talk scene and ' +
        'pitches a MICE lever (here Ideology, then Money). The scene grades the ' +
        "`voice` model voicing the target weighing the officer's offer; the " +
        'Specifics Guard should keep the officer from naming operational specifics.',
      script: [
        travelTo(pitchWorld, 4),
        wait(1),
        { kind: 'act', action: { kind: 'approach', npc: firstNpcOf(pitchWorld) } },
        { kind: 'act', action: { kind: 'talk', npc: firstNpcOf(pitchWorld) } },
        playerLine('We both know which way this city is tilting. People like you end up on the wrong list.'),
        playerLine('I am not asking you to betray anyone. I am asking you to keep yourself out of that list.'),
        playerLine('There is also money in it. Enough to move your family somewhere the lists do not reach.'),
      ],
    },
    {
      id: 'dangle-debrief',
      scenario: 'dangle-debrief',
      seed: 'vienna-eval-dangle',
      preconditions:
        'A Walk-in approaches the Station; the Hostile Service may be running it ' +
        'as a Dangle (a `walk-in-approach` event carries the hidden ground-truth ' +
        '`genuine` flag — a non-genuine approach is a Dangle). The player cannot ' +
        'tell a Dangle from a genuine volunteer and debriefs the Walk-in. The ' +
        'harness selects a seed/day whose Walk-in is a Dangle when it drives the ' +
        'live scene; the scene grades the `voice` model voicing bait feeding a ' +
        'mix of verifiable chickenfeed and deception.',
      script: [
        travelTo(dangleWorld, 0),
        wait(2),
        { kind: 'act', action: { kind: 'talk', npc: firstNpcOf(dangleWorld) } },
        playerLine('You came to us. Start at the beginning: who are you, and what do you have?'),
        playerLine('That detail is checkable. If it holds, we talk about what you actually want.'),
        playerLine("You're giving me a lot that's easy to verify and nothing that costs you. Why is that?"),
      ],
    },
    {
      id: 'confrontation-contradiction',
      scenario: 'confrontation-contradiction',
      seed: 'vienna-eval-confront',
      preconditions:
        'The Case File must hold a Claim that contradicts the confronted NPC\'s ' +
        'cover (e.g. a surveillance Claim placing them where their cover says ' +
        'they were not). The harness arranges this by surveilling the NPC and ' +
        'recording the sighting as a Claim before the confrontation, then uses a ' +
        '`confront` action naming that Claim. The scene grades the `voice` model ' +
        'voicing an NPC whose cover is contradicted by evidence in the room.',
      script: [
        travelTo(confrontWorld, 3),
        { kind: 'act', action: { kind: 'surveil', at: locByIndex(confrontWorld, 3), phases: 2 } },
        wait(1),
        { kind: 'act', action: { kind: 'talk', npc: firstNpcOf(confrontWorld) } },
        playerLine('You told me you were at the depot all evening.'),
        playerLine('I have you crossing the Ring at nine, two kilometres from the depot. Explain that.'),
        playerLine('The paper puts you where you say you never were. Which of us is lying?'),
      ],
    },
    {
      id: 'surveillance-narration',
      scenario: 'surveillance-narration',
      seed: 'vienna-eval-surveil',
      preconditions:
        'The player surveils a Location and the engine produces sighting events ' +
        '(co-presence reported as sightings, never as meetings). The harness ' +
        'then asks the Narrator to describe the surveillance result. The scene ' +
        'grades the `narrator` model for fidelity: it must narrate only the ' +
        'observed facts and leak no concealed entity (Leak Guard).',
      script: [
        travelTo(surveilWorld, 5),
        { kind: 'act', action: { kind: 'surveil', at: locByIndex(surveilWorld, 5), phases: 2 } },
        narrationRequest('Describe what the stake-out at this location turned up over the last two phases.'),
      ],
    },
  ];
}

/**
 * The mole's NPC id in a generated world (the scenario sets `mole: true`, so the
 * Station always carries one). The id is read behind the Truth brand with
 * {@link revealTruth}; a world generated without a mole throws, which is a
 * fixture-seed bug rather than a runtime condition to paper over.
 */
function moleIdOf(world: WorldState): NpcId {
  const mole: Truth<NpcId> | undefined = world.station.mole;
  if (mole === undefined) {
    throw new Error('world has no mole (scenario must set mole: true)');
  }
  // `Truth<NpcId>` wraps the id; the fixture only needs the concrete id to open
  // the talk scene against.
  return revealTruth(mole);
}

/**
 * The first NPC id in a world, by id-sorted order — a stable, world-independent
 * way to name "an NPC to talk to" for the setup `talk`/`approach` steps without
 * hard-coding a generated id. Every generated world has NPCs, so this throws
 * rather than returning `undefined` (a fixture-seed bug).
 */
function firstNpcOf(world: WorldState): NpcId {
  const ids = Object.keys(world.npcs).sort() as NpcId[];
  if (ids.length === 0) throw new Error('world has no NPCs');
  return ids[0];
}

/** The five required eval fixtures, built against the shared engine inputs. */
export function loadEvalFixtures(inputs: GenerateInputs = buildInputs()): readonly EvalFixture[] {
  return buildEvalFixtures(inputs);
}

// ---------------------------------------------------------------------------
// Driving a fixture into its scene (the "runnable" half)
// ---------------------------------------------------------------------------

/**
 * The engine-driven setup kinds a fixture's leading `act` steps use. These are
 * the model-free moves — travel, wait and surveil — that stage the world up to
 * the point the scene opens. The scene itself (a `talk`/`approach`/`confront`
 * that opens a Dialogue Loop, and every `say` line) is driven against a model by
 * 23.2/23.3 through the gateway seam, not here.
 */
const SETUP_ACTION_KINDS = new Set(['travel', 'wait', 'surveil']);

/** The result of staging a fixture's setup: the world and where the scene starts. */
export interface FixtureSetup {
  /** The world after applying the leading model-free setup actions. */
  readonly world: WorldState;
  /**
   * The index of the first script step this setup did not apply — the step the
   * scene opens at (the first `say`, or the first model-dependent `act` such as
   * `talk`/`approach`/`confront`). Equals `script.length` when every step was a
   * model-free setup action.
   */
  readonly sceneStart: number;
}

/**
 * Stage a fixture up to its scene by applying its leading model-free `act` steps
 * (`travel`, `wait`, `surveil`) through the pure engine {@link resolve}, exactly
 * as a golden replay applies its plan. The world is regenerated from the
 * fixture's seed (so the setup is deterministic in `(seed, inputs)`), a single
 * PRNG is resumed from the world's serialised `rng`, and the Truth Store from
 * {@link generateGame} is threaded through for `surveil` (which observes NPCs as
 * `unk:` ids).
 *
 * The fold stops at the first step that is not a model-free setup action — a
 * `say` line or a scene-opening `act` (`talk`/`approach`/`confront`) — and
 * returns the staged world and that index. This proves a fixture is *runnable to
 * the point its scenario is reached*: the setup actions apply in order and the
 * world arrives at the scene; voicing the scene against a model is 23.2/23.3's
 * job. A setup action that the engine disallows leaves the world unchanged
 * (`resolve`'s contract), so a mis-scripted setup shows up as a world that did
 * not advance rather than a throw.
 */
export function runFixtureSetup(
  fixture: EvalFixture,
  inputs: GenerateInputs = buildInputs(),
): FixtureSetup {
  const { world: initial, truth } = generateGame(fixture.seed, inputs);
  let world = initial;
  const rng = createPrng(world.rng);
  const ctx: ResolverContext = { content: inputs.content, truth };

  for (let i = 0; i < fixture.script.length; i++) {
    const step = fixture.script[i];
    if (step.kind !== 'act' || !SETUP_ACTION_KINDS.has(step.action.kind)) {
      return { world, sceneStart: i };
    }
    const { next } = resolve(world, step.action, rng, ctx);
    // Persist the advanced PRNG stream onto the world, as a replay would.
    world = { ...next, rng: rng.state() };
  }
  return { world, sceneStart: fixture.script.length };
}
