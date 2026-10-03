/**
 * The Scripted Full Games driver (`app/scripted-games.ts`) —
 * slice-integration task 18; design, "Testing Strategy → Scripted Full Games";
 * Requirement 23.
 *
 * Each Scripted Full Game plays one complete game, from `newGame` on a fixed
 * seed to an ending, through the real Composition Root (`createGame`), the real
 * Turn Pipeline and the real Engine API, with the Fake Seams in place of the
 * models (Req 23.1). The game is built with an in-memory Save Store and a
 * recording Outcome Sink and no Gateway, so no endpoint client exists and the
 * caller runs with no model and no network (Req 23.5).
 *
 * ## Why this is a plain lib module, not a `*.spec.ts`
 *
 * The harness, the three scripts and their helpers live here so they can be
 * shared by two callers that must not import vitest:
 *
 *  - `scripted-games.spec.ts` plays each script and makes the end-check
 *    assertions (Req 23.4); and
 *  - `evals/scripts/record-golden.ts` plays the win-by-arrest script to capture
 *    the concrete action log it played and freeze it as the `04-full-game`
 *    Golden Replay (slice-integration task 19.2; Req 23.6).
 *
 * It imports no vitest, so it is part of the `@tradecraft/app` lib build and is
 * re-exported from the package index (like `fake-seams.ts`), which is how the
 * golden-replay recorder in `@tradecraft/evals` reaches it across the package
 * boundary.
 *
 * ## The harness ({@link ScriptedGame})
 *
 * The harness is shared by every script. A script may only:
 *
 *  - read the Player View: `views.*`, the Case File, `status()`, the Game View
 *    `newGame` returned, and the chunks its own turns streamed; and
 *  - play an option the action catalogue offers (`actions()`), as offered, or
 *    a free-input template from it (a decrypt submission) completed with the
 *    player's input.
 *
 * So the scripts drive exactly the facade the TUI drives. They never read the
 * World State or the Truth Store to choose a move. The one exception is the
 * cipher puzzle: {@link ScriptedGame.solveIntercept} supplies an Intercept's
 * true key as the stand-in for the player solving it at the Workbench (see
 * there). Every turn's played {@link Action} is kept on {@link ScriptedGame.turns}
 * so a caller can read back the exact concrete action log the script produced.
 *
 * ## Seeds
 *
 * Each script's seed is pinned after a sweep confirmed the script reaches its
 * ending on that seed. When an intentional behaviour change moves a game off
 * its ending, re-run the sweep and re-pin the seed; do not loosen the expected
 * outcome.
 */

import { resolve as resolvePath } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { loadContent, type PredicateRegistry } from '@tradecraft/content';
import {
  revealedSpec,
  type Action,
  type DocId,
  type EntityId,
  type GameTime,
  type InterceptId,
  type KeySubmission,
  type LocId,
  type NpcId,
  type OutcomeRecord,
  type ScenarioConfig,
} from '@tradecraft/engine';
import { evaluateExtraction } from '@tradecraft/dialogue';
import {
  InMemorySaveStore,
  PlayerViewEngine,
  type ActionOption,
  type ClaimView,
  type EngineApi,
  type GameView,
  type TurnChunk,
  type TurnPipelineConfig,
} from '@tradecraft/player-view';

import { createGame, type Game } from './composition-root.js';
import { buildFakeSeams } from './fake-seams.js';
import { WALK_REPO_ROOT, walkModels, walkScenario } from './game-harness-config.js';

// ---------------------------------------------------------------------------
// The shared harness (Req 23.1, 23.5)
// ---------------------------------------------------------------------------

/** The Difficulty Presets the scripts run on. */
export type ScriptedPreset = 'easy' | 'standard' | 'hard';

/** How one Scripted Full Game is set up. */
export interface ScriptedGameOptions {
  /** The fixed seed the game is generated from. */
  readonly seed: string;
  /**
   * Turn Pipeline seams to use instead of the Fake Seams' (for example a
   * classifier that reads the player's stated Intent), applied on top of them.
   */
  readonly seams?: Partial<TurnPipelineConfig>;
  /** The Difficulty Preset id. */
  readonly preset: ScriptedPreset;
  /** Whether the internal mole is in play. Off by default, as in the shipped scenario. */
  readonly mole?: boolean;
}

/** One turn a script played: when it started, what was played and what streamed back. */
export interface PlayedTurn {
  /** The game time the turn started at. */
  readonly at: GameTime;
  /** The action played. */
  readonly action: Action;
  /** Every chunk the turn streamed, in order. */
  readonly chunks: readonly TurnChunk[];
}

/** The `ended` chunk a turn streams when it commits an End Condition. */
export type EndedChunk = Extract<TurnChunk, { readonly kind: 'ended' }>;

/** The compiled predicate registry the Fake extraction seam derives its schema from. */
function loadPredicates(scenario: ScenarioConfig): PredicateRegistry {
  const dirs = scenario.packs.dirs.map((dir) =>
    resolvePath(WALK_REPO_ROOT, dir),
  );
  const content = loadContent(dirs, [...scenario.packs.load]);
  if (!content.ok) {
    throw new Error('the Scripted Full Games could not load the Content Packs');
  }
  return content.value.predicates;
}

/** Drain a turn stream to its chunks. */
async function drain(stream: AsyncIterable<TurnChunk>): Promise<TurnChunk[]> {
  const chunks: TurnChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * One Scripted Full Game: the game `createGame` assembled with the Fake Seams,
 * an in-memory Save Store and a recording Outcome Sink, started with `newGame`
 * on a fixed seed, plus the record of every turn a script played on it.
 */
export class ScriptedGame {
  /** The turns played so far, in order. */
  readonly turns: PlayedTurn[] = [];

  private constructor(
    private readonly game: Game,
    /** The seed the game was generated from. */
    readonly seed: string,
    /** The Game View `newGame` returned: the opening status and the brief Cable. */
    readonly view: GameView,
    /** Every Outcome Record the recording Outcome Sink received. */
    readonly outcomes: readonly OutcomeRecord[],
  ) {}

  /**
   * Assemble the game through the Composition Root and start it on the seed.
   * No Gateway option is passed and the Fake Seams override the Live Seams, so
   * `createGame` builds no endpoint client (Req 23.5).
   */
  static async start(options: ScriptedGameOptions): Promise<ScriptedGame> {
    const scenario = walkScenario(options.preset);
    const holder: { engine?: PlayerViewEngine } = {};
    const seams: Partial<TurnPipelineConfig> = {
      ...buildFakeSeams({
        seed: options.seed,
        getState: () => {
          if (holder.engine === undefined) {
            throw new Error('a seam read the game before it was assembled');
          }
          return holder.engine.state;
        },
        predicates: loadPredicates(scenario),
      }),
      // The real phase-2 extraction evaluator, so the Fake extraction runner's
      // results commit exactly as in the shared reachable walk.
      evaluateExtraction,
      ...options.seams,
    };

    const outcomes: OutcomeRecord[] = [];
    const game = createGame({
      repoRoot: WALK_REPO_ROOT,
      scenario,
      models: walkModels(),
      seams,
      saveStore: new InMemorySaveStore(),
      outcomes: (record: OutcomeRecord): void => {
        outcomes.push(record);
      },
    });
    if (game.gateway !== undefined) {
      throw new Error('a Scripted Full Game must not build a model Gateway');
    }
    if (!(game.api instanceof PlayerViewEngine)) {
      throw new Error('the Composition Root returned an unexpected Engine API');
    }
    holder.engine = game.api;

    const view = await game.api.newGame({
      seed: options.seed,
      preset: options.preset,
      mole: options.mole ?? false,
      narration: scenario.narration,
    });
    return new ScriptedGame(game, options.seed, view, outcomes);
  }

  /** The Engine API the scripts drive (the facade the TUI uses). */
  get api(): EngineApi {
    return this.game.api;
  }

  /** The `ended` chunk the game streamed, once it has ended. */
  get ended(): EndedChunk | undefined {
    for (const turn of this.turns) {
      for (const chunk of turn.chunks) {
        if (chunk.kind === 'ended') {
          return chunk;
        }
      }
    }
    return undefined;
  }

  /** Whether the game has ended. */
  get over(): boolean {
    return this.ended !== undefined;
  }

  /** The current game time, from the status bar. */
  get time(): GameTime {
    return this.api.status().time;
  }

  /** The first allowed option the action catalogue offers whose action `pick` selects. */
  offered(pick: (action: Action) => boolean): ActionOption | undefined {
    return this.api
      .actions()
      .find((option) => option.quote.allowed && pick(option.action));
  }

  /**
   * Play one option from the action catalogue. `complete` fills a free-input
   * template (a decrypt submission) the way the TUI does before it commits; it
   * may not change the action's kind. The option must still be offered and
   * allowed, so a script can only play what `actions()` lists.
   */
  async play(
    option: ActionOption,
    complete?: (template: Action) => Action,
  ): Promise<readonly TurnChunk[]> {
    if (this.over) {
      throw new Error('the game has already ended');
    }
    const stillOffered = this.api
      .actions()
      .some(
        (o) => o.quote.allowed && isDeepStrictEqual(o.action, option.action),
      );
    if (!stillOffered) {
      throw new Error(
        `the catalogue no longer offers ${JSON.stringify(option.action)}`,
      );
    }
    const action =
      complete === undefined ? option.action : complete(option.action);
    if (action.kind !== option.action.kind) {
      throw new Error('completing a template must keep its action kind');
    }

    const at = this.time;
    const chunks = await drain(this.api.act(action));
    this.turns.push({ at, action, chunks });
    return chunks;
  }

  /**
   * The player's solution to an Intercept's cipher puzzle, as a key submission.
   *
   * This is the one place a script reads ground truth before the end. Breaking
   * a cipher is the player's own work at the Workbench, which shows the
   * ciphertext, a frequency table and a caesar shift preview. The Cell enciphers
   * its traffic with Vigenère, columnar, book or one-time-pad keys and never
   * with caesar, so the Player View offers no mechanical way to read the key off
   * it. The scripts stand in for the player's cryptanalysis with the
   * Intercept's true key, read from its Truth-branded cipher spec, and still
   * submit it through the decrypt template the catalogue offers.
   */
  solveIntercept(id: InterceptId): KeySubmission {
    const engine = this.game.api as PlayerViewEngine;
    const intercept = engine.state.intercepts[id];
    if (intercept === undefined) {
      throw new Error(`no collected Intercept ${id}`);
    }
    return { kind: 'key', spec: revealedSpec(intercept) };
  }

  /**
   * Whether a player at the Workbench could break this Intercept: any hand
   * cipher, but a one-time pad only when the operator reused it (the
   * two-time-pad break). Reads the cipher kind the way the player infers it.
   */
  workbenchBreakable(id: InterceptId): boolean {
    const engine = this.game.api as PlayerViewEngine;
    const intercept = engine.state.intercepts[id];
    if (intercept === undefined) {
      return false;
    }
    const spec = revealedSpec(intercept);
    return spec.kind !== 'otp' || intercept.tradecraftError?.kind === 'pad-reuse';
  }

  /** Release the game. */
  close(): Promise<void> {
    return this.game.close();
  }
}

// ---------------------------------------------------------------------------
// Player-View reads the scripts share
// ---------------------------------------------------------------------------

/** Every Claim in the player's Case File. */
export function claimsOf(game: ScriptedGame): ClaimView[] {
  return game.api.caseFile.list({});
}

/** The local name of a predicate (`core/PLANS` → `PLANS`). */
function localPredicate(predicate: string): string {
  return predicate.slice(predicate.lastIndexOf('/') + 1);
}

/** Whether an entity id names a Location. */
function isLocation(id: EntityId): id is LocId {
  return id.startsWith('loc:');
}

/** The Locations a Claim names: its place, or a Location it points at. */
function locationsNamedBy(claim: ClaimView): LocId[] {
  const out: LocId[] = [];
  if (claim.prop.place !== undefined) {
    out.push(claim.prop.place);
  }
  if (typeof claim.prop.object === 'string' && isLocation(claim.prop.object)) {
    out.push(claim.prop.object);
  }
  return out;
}

/** Read every listed Document, through the catalogue's `read` options. */
async function readAll(
  game: ScriptedGame,
  docs: readonly DocId[],
): Promise<void> {
  for (const doc of docs) {
    const read = game.offered((a) => a.kind === 'read' && a.doc === doc);
    if (read === undefined) {
      throw new Error(`the catalogue offers no read of ${doc}`);
    }
    await game.play(read);
  }
}

/** Play the catalogue's `wait` for exactly `phases` phases. */
async function wait(game: ScriptedGame, phases: 1 | 2 | 3 | 4): Promise<void> {
  const option = game.offered((a) => a.kind === 'wait' && a.phases === phases);
  if (option === undefined) {
    throw new Error(`the catalogue offers no ${phases}-phase wait`);
  }
  await game.play(option);
}

/** How many phases a script waits for a closed Location to open. */
const MAX_OPENING_WAIT = 4;

/**
 * Travel to a Location by the direct route, through the catalogue's `travel`
 * option, waiting a phase at a time while the destination is closed. Returns
 * `false` when the catalogue offers no travel there (the player does not know
 * the Location) or it stays closed.
 */
async function travelTo(game: ScriptedGame, to: LocId): Promise<boolean> {
  for (let waited = 0; ; waited += 1) {
    if (game.api.status().location.id === to) {
      return true;
    }
    const option = game.api
      .actions()
      .find(
        (o) =>
          o.action.kind === 'travel' &&
          o.action.to === to &&
          !o.action.countersurveillance,
      );
    if (option === undefined) {
      return false;
    }
    if (option.quote.allowed) {
      await game.play(option);
      return true;
    }
    if (waited === MAX_OPENING_WAIT) {
      return false;
    }
    await wait(game, 1);
  }
}

/**
 * Surveil the player's Location for one phase through the catalogue's
 * `surveil` option, waiting while it is closed (the Map's opening hours).
 * Returns `false` when the Location is open but its type allows no
 * surveillance, or it stays closed.
 */
async function surveilHere(game: ScriptedGame): Promise<boolean> {
  for (let waited = 0; ; waited += 1) {
    const option = game.api.actions().find((o) => o.action.kind === 'surveil');
    if (option?.quote.allowed === true) {
      await game.play(option);
      return true;
    }
    const here = game.api.status().location.id;
    const place = game.api.views
      .map()
      .districts.flatMap((district) => district.locations)
      .find((loc) => loc.id === here);
    const closedNow = place !== undefined && !place.hours[game.time.phase];
    if (!closedNow || waited === MAX_OPENING_WAIT) {
      return false;
    }
    await wait(game, 1);
  }
}

/** Fail loudly when a script finds the game over before its own ending. */
function assertRunning(game: ScriptedGame, step: string): void {
  if (game.over) {
    throw new Error(
      `the game ended (${JSON.stringify(game.ended)}) before the script could ${step}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Script: win by arresting the Cell leader (Req 23.1)
// ---------------------------------------------------------------------------

/**
 * The win-by-arrest game: a fixed seed on `easy` (design, "Scripted Full
 * Games" 1). A sweep of `win-by-arrest-0` … `win-by-arrest-99` on easy reaches
 * `success` / `leader-arrested` on most of them; this seed wins after the
 * brief, the leads (with a surveillance observation), the trace Cable and
 * several days of the Cell's traffic, so every step of the script does real
 * work.
 *
 * The seeds that stop short are the ones where the scripted route (signals
 * only, no human sources) cannot reach the threshold before the operation
 * ends, or where surveilling the leads sees no one. When re-pinning, sweep the
 * same range and pick a seed with the same properties. Re-pinned to
 * `win-by-arrest-22` under the content-expansion `generatorVersion` bump (the
 * setting step moved slice step 1 to the setting stream, changing every seed's
 * world); `-22` is the lowest seed in the range on which the full script —
 * including a surveillance Claim at a lead — still holds.
 */
export const WIN_BY_ARREST: ScriptedGameOptions = {
  seed: 'win-by-arrest-22',
  preset: 'easy',
};

/** The most days the script waits at the Station for traffic to collect. */
const MAX_MONITOR_DAYS = 60;

/** The most phases the script waits for HQ's reply to a trace Cable. */
const MAX_REPLY_WAIT = 8;

/** What the win-by-arrest script did, for the assertions. */
export interface WinByArrestRun {
  /** The Case File size after `newGame` (the brief's lead Claims). */
  readonly leadClaims: number;
  /** The Case File size after reading the brief Cable again. */
  readonly claimsAfterBriefRead: number;
  /** The person the Case File names as planning the operation. */
  readonly suspect: NpcId;
  /** The lead Locations the script surveilled. */
  readonly surveilled: readonly LocId[];
  /** The Intercept the script broke. */
  readonly broken: InterceptId;
  /** The Fact Lines the decrypt turn showed. */
  readonly decryptLines: readonly string[];
  /** The arrest evidence against the suspect before the script corroborated. */
  readonly evidenceBeforeCorroboration: number;
  /** The arrest evidence the Case File held against the suspect at the arrest. */
  readonly evidenceAtArrest: number;
}

/**
 * The win-by-arrest script (design, "Scripted Full Games" 1). It reads the
 * brief, surveils the brief's leads, breaks one Intercept with its true key,
 * gathers the arrest threshold of corroborated Claims against the Cell leader
 * and arrests. Every move comes from the action catalogue and every decision
 * from the Player View:
 *
 *  1. **Read the brief.** The brief Cable `newGame` returned (its leads are
 *     already filed) and every HQ Dossier delivered with it.
 *  2. **Name the suspect.** The person a held `PLANS` Claim says is planning
 *     the operation (a `TARGETS` Claim if none does): the Cell's leader.
 *  3. **Surveil the brief's leads.** Go to each Location a lead names and
 *     watch it for a phase.
 *  4. **Collect traffic.** Go to the Station and sweep the known Channels until
 *     an Intercept comes in.
 *  5. **Break it** with the decrypt template, completed with the true key
 *     ({@link ScriptedGame.solveIntercept}).
 *  6. **Corroborate.** While the arrest is not yet allowed, cable HQ for a
 *     trace on the suspect and read what comes back, then keep sweeping the
 *     Station and breaking the Cell's traffic as the operation advances.
 *  7. **Arrest** the suspect.
 */
export async function playWinByArrest(game: ScriptedGame): Promise<WinByArrestRun> {
  // 1. Read the brief: the Cable, then the Dossiers that came with it.
  const leadClaims = claimsOf(game).length;
  await readAll(game, [game.view.brief.id]);
  const claimsAfterBriefRead = claimsOf(game).length;
  const dossiers = game.api.views
    .documents()
    .documents.filter((doc) => doc.kind === 'dossier' && !doc.read)
    .map((doc) => doc.id);
  await readAll(game, dossiers);

  // 2. The suspect: whoever the Case File says is planning the operation.
  const claims = claimsOf(game);
  const named =
    claims.find((c) => localPredicate(c.prop.predicate) === 'PLANS') ??
    claims.find((c) => localPredicate(c.prop.predicate) === 'TARGETS');
  if (named === undefined || !named.prop.subject.startsWith('npc:')) {
    throw new Error(
      'the brief and the Dossiers name no one planning the operation',
    );
  }
  const suspect = named.prop.subject as NpcId;

  // 3. Surveil every Location the brief's leads name. When none of them can
  //    be watched, surveil the first Location a Dossier names instead. A
  //    Location the player cannot reach, or whose type allows no surveillance,
  //    is passed over.
  const briefId = game.view.brief.id;
  const fromBrief = claims.filter(
    (c) => c.source.kind === 'document' && c.source.id === briefId,
  );
  const briefPlaces = [...new Set(fromBrief.flatMap(locationsNamedBy))];
  const filePlaces = [...new Set(claims.flatMap(locationsNamedBy))].filter(
    (loc) => !briefPlaces.includes(loc),
  );
  const surveilled: LocId[] = [];
  const surveilAt = async (place: LocId): Promise<void> => {
    assertRunning(game, 'surveil the leads');
    if ((await travelTo(game, place)) && (await surveilHere(game))) {
      surveilled.push(place);
    }
  };
  for (const place of briefPlaces) {
    await surveilAt(place);
  }
  for (const place of filePlaces) {
    if (surveilled.length > 0) {
      break;
    }
    await surveilAt(place);
  }
  if (surveilled.length === 0) {
    throw new Error('no Location the leads name could be surveilled');
  }

  // 4. Collect traffic at the Station: sweep, then wait, until an Intercept is in.
  const station = game.api.views
    .map()
    .districts.flatMap((district) => district.locations)
    .find(
      (loc) => loc.type === 'station-hq' || loc.type.endsWith('/station-hq'),
    );
  if (station === undefined) {
    throw new Error('the Map shows no Station');
  }
  assertRunning(game, 'go to the Station');
  if (!(await travelTo(game, station.id))) {
    throw new Error('the catalogue offers no way to the Station');
  }
  const collected = (): InterceptId | undefined =>
    game.api.views.intercepts().intercepts[0]?.id;
  const giveUpDay = game.time.day + MAX_MONITOR_DAYS;
  while (collected() === undefined) {
    assertRunning(game, 'collect an Intercept');
    if (game.time.day > giveUpDay) {
      throw new Error(
        `no traffic was collected at the Station within ${MAX_MONITOR_DAYS} days`,
      );
    }
    const sweep = game.offered((a) => a.kind === 'intercept');
    if (sweep === undefined) {
      throw new Error('the catalogue offers no intercept at the Station');
    }
    await game.play(sweep);
    if (collected() === undefined && !game.over) {
      await wait(game, 3);
    }
  }
  const broken = collected() as InterceptId;

  // 5. Break it: open the capture on the Workbench, then complete the decrypt
  //    template from the catalogue with the player's solution.
  assertRunning(game, 'break the Intercept');
  if (game.api.views.workbench(broken).ciphertext.length === 0) {
    throw new Error(`the Workbench shows no ciphertext for ${broken}`);
  }
  const decrypt = game.offered(
    (a) => a.kind === 'decrypt' && a.intercept === broken,
  );
  if (decrypt === undefined) {
    throw new Error(`the catalogue offers no decrypt of ${broken}`);
  }
  const solution = game.solveIntercept(broken);
  const decryptChunks = await game.play(decrypt, (template) =>
    template.kind === 'decrypt'
      ? { ...template, submission: solution }
      : template,
  );
  const decryptLines = decryptChunks.flatMap((c) =>
    c.kind === 'fact' ? [c.text] : [],
  );

  // 6. Corroborate until the arrest gate opens: a trace Cable on the suspect,
  //    then every Document the reply brings.
  const arrestOption = (): ActionOption | undefined =>
    game.offered((a) => a.kind === 'arrest' && a.npc === suspect);
  const evidenceBeforeCorroboration = game.api.caseFile.evidence(suspect);
  if (arrestOption() === undefined) {
    assertRunning(game, 'cable for a trace');
    const trace = game.offered(
      (a) =>
        a.kind === 'cable' &&
        a.body.kind === 'trace' &&
        a.body.target === suspect,
    );
    if (trace === undefined) {
      throw new Error(`the catalogue offers no trace Cable on ${suspect}`);
    }
    const held = new Set(
      game.api.views.documents().documents.map((doc) => doc.id),
    );
    await game.play(trace);
    const replies = (): DocId[] =>
      game.api.views
        .documents()
        .documents.filter((doc) => !held.has(doc.id) && !doc.read)
        .map((doc) => doc.id);
    for (let waited = 0; replies().length === 0; waited += 1) {
      if (waited === MAX_REPLY_WAIT) {
        throw new Error('no reply came back from the trace Cable');
      }
      assertRunning(game, 'wait for the trace reply');
      await wait(game, 1);
    }
    await readAll(game, replies());
  }

  // 6b. Keep working the traffic until the case is strong enough: the Cell's
  //     messages follow the operation, so each sweep at the Station brings the
  //     next step's orders. Break every new Intercept a Workbench can break
  //     (any hand cipher; a one-time pad only when the operator reused it).
  const workDeadline = game.time.day + MAX_MONITOR_DAYS;
  const tried = new Set<InterceptId>([broken]);
  while (arrestOption() === undefined) {
    assertRunning(game, 'build the case');
    if (game.time.day > workDeadline) {
      throw new Error(`the case against ${suspect} never reached the arrest threshold`);
    }
    const sweep = game.offered((a) => a.kind === 'intercept');
    if (sweep !== undefined) {
      await game.play(sweep);
    }
    for (const view of game.api.views.intercepts().intercepts) {
      if (game.over || tried.has(view.id)) {
        continue;
      }
      tried.add(view.id);
      if (!game.workbenchBreakable(view.id)) {
        continue;
      }
      const option = game.offered((a) => a.kind === 'decrypt' && a.intercept === view.id);
      if (option === undefined) {
        continue;
      }
      const key = game.solveIntercept(view.id);
      await game.play(option, (t) => (t.kind === 'decrypt' ? { ...t, submission: key } : t));
    }
    if (arrestOption() === undefined && !game.over) {
      await wait(game, 4);
    }
  }

  // 7. Arrest.
  assertRunning(game, 'make the arrest');
  const arrest = arrestOption();
  if (arrest === undefined) {
    throw new Error(
      `the Case File still holds too little to arrest ${suspect}`,
    );
  }
  const evidenceAtArrest = game.api.caseFile.evidence(suspect);
  await game.play(arrest);

  return {
    leadClaims,
    claimsAfterBriefRead,
    suspect,
    surveilled,
    broken,
    decryptLines,
    evidenceBeforeCorroboration,
    evidenceAtArrest,
  };
}

// ---------------------------------------------------------------------------
// Script: lose by letting the Plot run to its final stage (Req 23.2)
// ---------------------------------------------------------------------------

/**
 * The Plot-failure game: a fixed seed on `easy` (design, "Scripted Full Games"
 * 2). Pinned after a sweep of `plot-fail-0` … `plot-fail-39` on easy: the
 * player does nothing but wait, and on every one of them the Cell runs its
 * operation to its final stage and the game ends `failure` / `plot-completed`.
 * This seed completes on day 34 — mid-range for the sweep — so the script
 * exercises a full operation's worth of Day-Boundary Hooks and Phase Steps
 * without waiting needlessly long.
 *
 * Waiting is the whole script: the player never surveils, never collects, never
 * approaches anyone, so the Plot is never disrupted and the player is never
 * burned, and the only End Condition the clock can reach is the Plot running
 * its final stage. When re-pinning, sweep the same range and pick a seed that
 * still ends `plot-completed` on a wait-only game.
 */
export const PLOT_FAILURE: ScriptedGameOptions = {
  seed: 'plot-fail-7',
  preset: 'easy',
};

/**
 * The most phases the script waits for the Plot to run its final stage before
 * giving up. The sweep's slowest seed completes within ~45 days; a day is four
 * phases, so this bound is generous while still terminating a stuck game.
 */
const MAX_PLOT_WAIT_PHASES = 400;

/** What the Plot-failure script did, for the assertions. */
export interface PlotFailureRun {
  /** The game time the game started at. */
  readonly startedAt: GameTime;
  /** The number of `wait` turns the script played before the game ended. */
  readonly waits: number;
  /** The game time the Plot completed at. */
  readonly endedAt: GameTime;
}

/**
 * The Plot-failure script (design, "Scripted Full Games" 2). The player does
 * the one thing a passive player does: wait. On each turn the script plays the
 * catalogue's longest `wait` (four phases, a full day), advancing the integrated
 * Turn Pipeline — the Day-Boundary Hooks run the Plot, the Hostile tick and the
 * Phase Step — until the Plot runs its final stage and the game ends. Every move
 * comes from the action catalogue; the script reads nothing but the status bar.
 */
export async function playPlotFailure(game: ScriptedGame): Promise<PlotFailureRun> {
  const startedAt = game.time;
  let waits = 0;
  for (let phases = 0; !game.over; ) {
    if (phases >= MAX_PLOT_WAIT_PHASES) {
      throw new Error(
        `the Plot did not complete within ${MAX_PLOT_WAIT_PHASES} phases`,
      );
    }
    // The longest wait the catalogue offers (a full day of four phases), so the
    // game advances a day per turn and the Plot's one-stage-per-day pacing shows.
    const option =
      game.offered((a) => a.kind === 'wait' && a.phases === 4) ??
      game.offered((a) => a.kind === 'wait');
    if (option === undefined) {
      throw new Error('the catalogue offers no wait');
    }
    const played = option.action;
    await game.play(option);
    waits += 1;
    phases += played.kind === 'wait' ? played.phases : 1;
  }
  return { startedAt, waits, endedAt: game.time };
}

// ---------------------------------------------------------------------------
// Script: lose by being burned (Req 23.3)
// ---------------------------------------------------------------------------

/**
 * The burned game: a fixed seed on `hard` (design, "Scripted Full Games" 3).
 * A sweep of `burned-0` … `burned-99` on hard, driving each with the
 * {@link playBurned} script below, burns the player on 99 of them: travelling
 * direct routes into risky places lets the Hostile Service's watchers spot the
 * player, a tail follows, and cold approaches add to it. This seed burns on
 * day 3. When re-pinning, sweep the same range and pick a seed on which
 * {@link playBurned} still reaches `burned` before `plot-completed`.
 */
export const BURNED: ScriptedGameOptions = {
  seed: 'burned-7',
  preset: 'hard',
};

/**
 * The most turns the burn script plays before giving up. The script makes
 * progress every turn (a cold approach, a move through the city, or a phase
 * wait), so a burn is reached well within this bound on the pinned seed; it only
 * terminates a game that is not converging, before the Plot can finish its six
 * `hard` stages.
 */
const MAX_BURN_TURNS = 400;

/** What the burn script did, for the assertions. */
export interface BurnedRun {
  /** The game time the game started at. */
  readonly startedAt: GameTime;
  /** The number of cold approaches the script played (failed brush-offs raise suspicion). */
  readonly approaches: number;
  /** The number of tailed-risky travels the script played toward the riskiest Location. */
  readonly travels: number;
  /** The highest Location risk the Map showed among the player's known Locations. */
  readonly peakKnownRisk: number;
  /** The game time the player was burned at. */
  readonly endedAt: GameTime;
}

/** The player's known Locations on the Map, by id, each with its risk rating. */
function knownLocations(game: ScriptedGame): { id: LocId; risk: number }[] {
  return game.api.views
    .map()
    .districts.flatMap((district) => district.locations)
    .map((loc) => ({ id: loc.id, risk: loc.risk }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The highest risk among the player's known Locations (the Map's risk ratings). */
function peakKnownRisk(game: ScriptedGame): number {
  return knownLocations(game).reduce((max, loc) => Math.max(max, loc.risk), 0);
}

/** The clock as a single ordinal (`day × 4 + phase`), to tell whether a turn advanced it. */
function clockOrdinal(game: ScriptedGame): number {
  const { day, phase } = game.time;
  return day * 4 + phase;
}

/**
 * Travel to a Location by the **plain** (non-countersurveillance) route, so a
 * tail is never shaken. Returns `false` when the catalogue offers no such travel
 * now (the player does not know it, it is closed this phase, or it is the
 * current Location). Unlike {@link travelTo} this does not wait for a closed
 * destination to open — the burn script simply moves on to the next Location.
 */
async function travelPlain(game: ScriptedGame, to: LocId): Promise<boolean> {
  if (game.api.status().location.id === to) {
    return true;
  }
  const option = game.offered(
    (a) => a.kind === 'travel' && a.to === to && !a.countersurveillance,
  );
  if (option === undefined) {
    return false;
  }
  await game.play(option);
  return game.api.status().location.id === to;
}

/**
 * The burn script (design, "Scripted Full Games" 3). Burning the player needs
 * Cover Suspicion to climb, and only two player moves raise it with no model: a
 * **failed cold approach** (a brush-off adds a little and leaves the NPC
 * approachable) and a **tailed arrival in a risky place** (adds the Location's
 * risk × a preset factor). The script does both, continuously:
 *
 *  1. **Cold-approach someone present here.** The first offered `approach`, as
 *     the catalogue lists it. A brush-off raises Cover Suspicion and keeps the
 *     NPC approachable, so approaches ratchet suspicion toward the tail-start
 *     cutoff; a success instead opens a Channel (that NPC drops out of future
 *     approaches), which is fine.
 *  2. **Roam the known Locations.** With no one to approach here, travel the
 *     plain route to the next known Location in id order, cycling. The player
 *     keeps passing through the places people appear (so there is always someone
 *     to approach next) and arriving in risky Locations (where a running tail
 *     raises suspicion on arrival).
 *  3. **Advance the clock.** If neither an approach nor a plain travel moved the
 *     clock this turn (a zero-cost hop between adjacent Locations), wait a single
 *     phase, so every turn advances time and the daily Hostile tick runs — the
 *     tick starts the tail once suspicion is high enough, adds the standing-tail
 *     cost, and checks the burn threshold.
 *
 * Every move comes from the action catalogue (`approach`, `travel`, `wait`) and
 * every decision from the Player View (the Map's Locations and risks, the status
 * bar). The script never reads Cover Suspicion or the tail flag — both are
 * hidden ground truth — so it drives suspicion up blindly and stops only when
 * the game ends (`failure` / `burned` on the pinned seed).
 */
export async function playBurned(game: ScriptedGame): Promise<BurnedRun> {
  const startedAt = game.time;
  const locations = knownLocations(game);
  if (locations.length === 0) {
    throw new Error('the Map shows no known Location to roam');
  }
  let approaches = 0;
  let travels = 0;
  let peakRisk = peakKnownRisk(game);
  let cursor = 0;

  for (let turn = 0; !game.over; turn += 1) {
    if (turn >= MAX_BURN_TURNS) {
      throw new Error(
        `the player was not burned within ${MAX_BURN_TURNS} turns`,
      );
    }
    peakRisk = Math.max(peakRisk, peakKnownRisk(game));
    const before = clockOrdinal(game);

    // 1. A cold approach: a brush-off raises suspicion and keeps the NPC
    //    approachable, so prefer it to climb toward the tail-start cutoff.
    const approach = game.offered((a) => a.kind === 'approach');
    if (approach !== undefined) {
      await game.play(approach);
      approaches += 1;
      continue;
    }

    // 2. Roam: travel the plain route to the next known Location in id order,
    //    so the player keeps passing through peopled and risky places alike.
    const ring = knownLocations(game);
    for (let step = 0; step < ring.length; step += 1) {
      const candidate = ring[(cursor + step) % ring.length];
      cursor += 1;
      if (candidate.id === game.api.status().location.id) {
        continue;
      }
      if (await travelPlain(game, candidate.id)) {
        travels += 1;
        break;
      }
    }
    if (game.over) {
      break;
    }

    // 3. If nothing advanced the clock this turn, wait a phase so the daily
    //    Hostile tick runs (it starts the tail and checks the burn threshold).
    if (clockOrdinal(game) === before) {
      await wait(game, 1);
    }
  }

  return {
    startedAt,
    approaches,
    travels,
    peakKnownRisk: peakRisk,
    endedAt: game.time,
  };
}
