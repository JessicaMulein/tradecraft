/**
 * The playability probe: an expert player bot that plays one seed to an ending
 * through the real Composition Root with the Fake Seams, used to measure and
 * calibrate how winnable each Difficulty Preset is.
 *
 * The bot is an *informed* player. It reads ground truth only to decide where to
 * look (where the Cell leader will be, which Intercept to break and with what
 * key), standing in for a skilled player's judgement and cryptanalysis. Every
 * move is still an option the action catalogue offers, and the arrest still has
 * to pass the real arrest gate on Case File evidence.
 *
 * It works the hard routes only: documents, surveillance, follows, Station
 * collection and decryption. Conversation is left out, because what an NPC says
 * is model-driven and the Fake Seams cannot stand in for it honestly. The probe
 * is therefore a lower bound on what a strong player can reach.
 */
import {
  revealTruth,
  scheduledLocationAt,
  type Action,
  type GameTime,
  type LocId,
  type NpcId,
  type WorldState,
} from '@tradecraft/engine';
import type { PlayerViewEngine, TurnChunk } from '@tradecraft/player-view';
import { ScriptedGame, type ScriptedPreset } from './scripted-games.js';

/** How a probed game ended, or why the probe stopped. */
export type ProbeOutcome =
  | 'win'
  | 'plot-completed'
  | 'burned'
  | 'wrongful'
  | 'stalled';

/** The result of probing one seed. */
export interface ProbeResult {
  readonly seed: string;
  readonly preset: ScriptedPreset;
  readonly outcome: ProbeOutcome;
  /** The End Condition's cause, when the game ended. */
  readonly cause?: string;
  /** The day the game ended (or the probe stopped). */
  readonly day: number;
  /** The day the Plot would have completed (its final stage deadline). */
  readonly finalDeadline: number;
  /** Turns played. */
  readonly turns: number;
  /** Arrest evidence against the leader at the end, and the threshold. */
  readonly evidence: number;
  readonly threshold: number;
  /**
   * The case score against the leader at the end of each day, from day 0 to the
   * last day played (recorded in calibration mode, where the probe never
   * arrests and plays until the Plot ends).
   */
  readonly trajectory?: readonly number[];
}

/** Options for {@link probeSeed}. */
export interface ProbeOptions {
  /**
   * Calibration mode: never arrest; play on until the game ends and record the
   * daily case score, so any arrest threshold can be evaluated after the fact.
   */
  readonly calibrate?: boolean;
}

/** The most turns the probe plays before it reports `stalled`. */
export const MAX_PROBE_TURNS = 1500;

/** Phases between Station collection runs. */
const SWEEP_EVERY_PHASES = 8;

function ordinal(t: GameTime): number {
  return t.day * 4 + t.phase;
}

function addPhases(t: GameTime, n: number): GameTime {
  const o = ordinal(t) + n;
  return { day: Math.floor(o / 4), phase: (o % 4) as GameTime['phase'] };
}

/** The live World State (the probe's oracle; never shown to the player). */
function world(game: ScriptedGame): WorldState {
  return (game.api as PlayerViewEngine).state;
}

function leaderOf(state: WorldState): NpcId {
  return revealTruth(state.plot.leader);
}

/** The ids the player may know the leader by: the npc id and any `unk:` alias. */
function leaderHandles(state: WorldState): Set<string> {
  const leader = leaderOf(state);
  const out = new Set<string>([leader]);
  const unk = state.player.unkIds[leader];
  if (unk !== undefined) out.add(unk);
  return out;
}

/** Play the first allowed catalogue option `pick` selects; false when none. */
async function tryPlay(
  game: ScriptedGame,
  pick: (a: Action) => boolean,
  complete?: (a: Action) => Action,
): Promise<boolean> {
  if (game.over) return false;
  const option = game.offered(pick);
  if (option === undefined) return false;
  await game.play(option, complete);
  return true;
}

async function readUnread(game: ScriptedGame): Promise<boolean> {
  const unread = game.api.views.documents().documents.filter((d) => !d.read);
  let any = false;
  for (const doc of unread) {
    if (await tryPlay(game, (a) => a.kind === 'read' && a.doc === doc.id)) any = true;
  }
  return any;
}

/**
 * Whether a human cryptanalyst could break this Intercept: every hand cipher
 * can be worked, but a one-time pad only falls when the operator reused it.
 */
function breakable(game: ScriptedGame, id: string): boolean {
  const intercept = world(game).intercepts[id as keyof WorldState['intercepts']];
  if (intercept === undefined) return false;
  const spec = revealTruth(intercept.spec);
  return spec.kind !== 'otp' || intercept.tradecraftError?.kind === 'pad-reuse';
}

/** Break every collected Intercept a human could, through the catalogue's decrypt. */
async function decryptAll(game: ScriptedGame, done: Set<string>): Promise<boolean> {
  let any = false;
  for (const option of game.api.actions()) {
    const a = option.action;
    if (!option.quote.allowed || a.kind !== 'decrypt' || done.has(a.intercept)) continue;
    done.add(a.intercept);
    if (!breakable(game, a.intercept)) continue;
    const solution = game.solveIntercept(a.intercept);
    await game.play(option, (t) =>
      t.kind === 'decrypt' ? { ...t, submission: solution } : t,
    );
    any = true;
    if (game.over) break;
  }
  return any;
}

function stationId(game: ScriptedGame): LocId | undefined {
  return game.api.views
    .map()
    .districts.flatMap((d) => d.locations)
    .find((l) => l.type === 'station-hq' || l.type.endsWith('/station-hq'))?.id;
}

/** Travel by the direct route if the catalogue offers it now. */
async function travel(game: ScriptedGame, to: LocId): Promise<boolean> {
  if (game.api.status().location.id === to) return true;
  return tryPlay(
    game,
    (a) => a.kind === 'travel' && a.to === to && !a.countersurveillance,
  );
}

/**
 * The next time within `horizon` phases at which the leader is scheduled at a
 * Location the player can travel to, with that Location.
 */
function nextLeaderSighting(
  game: ScriptedGame,
  horizon: number,
): { loc: LocId; at: GameTime } | undefined {
  const state = world(game);
  const leader = state.npcs[leaderOf(state)];
  if (leader === undefined) return undefined;
  const travellable = new Set<string>(
    game.api
      .actions()
      .flatMap((o) => (o.action.kind === 'travel' ? [o.action.to] : [])),
  );
  travellable.add(game.api.status().location.id);
  for (let k = 0; k <= horizon; k += 1) {
    const at = addPhases(state.time, k);
    const loc = scheduledLocationAt(leader, at);
    if (loc !== undefined && travellable.has(loc)) return { loc, at };
  }
  return undefined;
}

/**
 * The next Plot event the player could watch: the earliest running stage's
 * deadline, at a trace's bound Location the player can travel to.
 */
function nextPlotEvent(game: ScriptedGame): { loc: LocId; at: GameTime } | undefined {
  const state = world(game);
  const travellable = new Set<string>(
    game.api
      .actions()
      .flatMap((o) => (o.action.kind === 'travel' ? [o.action.to] : [])),
  );
  travellable.add(game.api.status().location.id);
  const now = ordinal(state.time);
  const stages = [...state.plot.stages]
    .filter((st) => ordinal(st.deadline) >= now)
    .sort((a, b) => ordinal(a.deadline) - ordinal(b.deadline));
  for (const stage of stages) {
    for (const trace of stage.traces) {
      const place = trace.place;
      const loc =
        place?.kind === 'loc'
          ? place.loc
          : place?.kind === 'target' && place.entity.startsWith('loc:')
            ? (place.entity as LocId)
            : undefined;
      if (loc !== undefined && travellable.has(loc)) {
        return { loc, at: stage.deadline };
      }
    }
  }
  return undefined;
}

/** The classifier the probe plays with: its lines name their own Intent. */
async function statedIntent(line: string): Promise<string> {
  return line.startsWith('intent:') ? line.slice('intent:'.length) : 'small-talk';
}

async function drain(stream: AsyncIterable<TurnChunk>): Promise<void> {
  for await (const _chunk of stream) {
    void _chunk;
  }
}

type Lever = 'money' | 'ideology' | 'coercion' | 'ego';

/**
 * The informant the probe works: the non-hostile NPC whose routine shares the
 * most schedule slots with the leader's (so their Asset access covers the
 * leader), among those the player can reach. `undefined` when no one overlaps.
 */
function bestInformant(state: WorldState, exclude: ReadonlySet<NpcId>): NpcId | undefined {
  const cell = new Set<string>(
    state.plot.roles.flatMap((r) => (r.npc === undefined ? [] : [r.npc as string])),
  );
  // The places and times the operation will show itself: each observable trace
  // of each stage, at its bound Location on the stage's deadline.
  const sightings: { loc: string; at: GameTime }[] = [];
  for (const stage of state.plot.stages) {
    for (const trace of stage.traces) {
      const place = trace.place;
      const loc =
        place?.kind === 'loc'
          ? place.loc
          : place?.kind === 'target' && place.entity.startsWith('loc:')
            ? place.entity
            : undefined;
      if (loc !== undefined && trace.kind !== 'transmission') {
        sightings.push({ loc, at: stage.deadline });
      }
    }
  }
  let best: { id: NpcId; score: number } | undefined;
  for (const npc of Object.values(state.npcs)) {
    if (cell.has(npc.id) || exclude.has(npc.id)) continue;
    const org = revealTruth(npc.trueAllegiance).org;
    if (org === 'org:cell' || org.startsWith('org:hostile')) continue;
    const score = sightings.filter((s) => scheduledLocationAt(npc, s.at) === s.loc).length;
    if (score > 0 && (best === undefined || score > best.score)) {
      best = { id: npc.id, score };
    }
  }
  return best?.id;
}

/** The lever this NPC responds to best, read from its hidden MICE profile. */
function bestLever(state: WorldState, npc: NpcId): Lever {
  const mice = revealTruth(state.npcs[npc].mice);
  const levers: Lever[] = ['money', 'ideology', 'ego', 'coercion'];
  return levers.reduce((a, b) => (mice[b] > mice[a] ? b : a));
}

/** The next time the NPC is scheduled at a Location the player can travel to. */
function nextSighting(
  game: ScriptedGame,
  npcId: NpcId,
  horizon: number,
): { loc: LocId; at: GameTime } | undefined {
  const state = world(game);
  const npc = state.npcs[npcId];
  if (npc === undefined) return undefined;
  const travellable = new Set<string>(
    game.api.actions().flatMap((o) => (o.action.kind === 'travel' ? [o.action.to] : [])),
  );
  travellable.add(game.api.status().location.id);
  for (let k = 0; k <= horizon; k += 1) {
    const at = addPhases(state.time, k);
    const loc = scheduledLocationAt(npc, at);
    if (loc !== undefined && travellable.has(loc)) return { loc, at };
  }
  return undefined;
}

/** The probe's recruitment state for its informant. */
interface Recruitment {
  target?: NpcId;
  /** NPCs the probe gave up on (refused, unreachable). */
  readonly given: Set<NpcId>;
  /** Recruited Assets, with the phase each was last tasked. */
  readonly assets: Map<NpcId, number>;
}

/** The most informants the probe runs at once. */
const MAX_ASSETS = 3;

/**
 * One step of the asset route. Returns true when it played a turn. Order:
 * task a recruited informant on the leader; otherwise build rapport and pitch
 * in an open scene; otherwise go to where the informant will be and approach.
 */
async function workInformant(game: ScriptedGame, rec: Recruitment): Promise<boolean> {
  const state = world(game);
  const now = ordinal(state.time);

  // Task every running Asset on the leader (by name, or by the `unk:` handle
  // the player sighted them under), each at most every half day.
  const leaderIds = leaderHandles(state);
  for (const [asset, last] of rec.assets) {
    if (now - last < 2) continue;
    const tasked = await tryPlay(
      game,
      (a) =>
        a.kind === 'task' &&
        a.asset === asset &&
        a.task.kind === 'collect' &&
        leaderIds.has(a.task.target),
    );
    if (tasked) {
      rec.assets.set(asset, ordinal(world(game).time));
      return true;
    }
  }
  if (rec.assets.size >= MAX_ASSETS) return false;

  if (rec.target === undefined) {
    rec.target = bestInformant(state, new Set([...rec.given, ...rec.assets.keys()]));
    if (rec.target === undefined) return false;
  }
  const target = rec.target;
  const rel = state.relationships[target];
  if (rel?.recruited) {
    rec.assets.set(target, -Infinity);
    rec.target = undefined;
    return false;
  }

  // In a scene with them: two lines of rapport, then the pitch.
  const scene = state.player.scene;
  if (scene !== undefined && scene.npc === target) {
    if ((rel?.trust ?? 0) < 0.3) {
      await drain(game.api.say('intent:reassure'));
      return true;
    }
    const lever = bestLever(state, target);
    const need = revealTruth(state.npcs[target].moneyNeed);
    const offer = lever === 'money' ? Math.min(need, game.api.status().budget) : undefined;
    await drain(game.api.say(`intent:pitch-${lever}`, offer === undefined ? undefined : { offer }));
    const after = world(game).relationships[target];
    if (after?.recruited) {
      rec.assets.set(target, -Infinity);
    } else {
      // A refused pitch: try the next informant.
      rec.given.add(target);
    }
    rec.target = undefined;
    if (world(game).player.scene !== undefined) await drain(game.api.endScene());
    return true;
  }
  if (scene !== undefined) {
    await drain(game.api.endScene());
    return true;
  }

  // Find them and open a scene: talk if already a contact, else cold-approach.
  const sighting = nextSighting(game, target, 8);
  if (sighting === undefined) return false;
  const here = game.api.status().location.id;
  if (sighting.loc !== here) return travel(game, sighting.loc);
  if (ordinal(sighting.at) > now) return tryPlay(game, (a) => a.kind === 'wait' && a.phases === 1);
  if (await tryPlay(game, (a) => a.kind === 'talk' && a.npc === target)) return true;
  const handles = new Set<string>([target]);
  const unk = state.player.unkIds[target];
  if (unk !== undefined) handles.add(unk);
  if (await tryPlay(game, (a) => (a.kind === 'approach' || a.kind === 'talk') && handles.has(a.npc))) {
    return true;
  }
  rec.given.add(target);
  rec.target = undefined;
  return false;
}

/** Probe one seed on one preset. */
export async function probeSeed(
  seed: string,
  preset: ScriptedPreset,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const game = await ScriptedGame.start({ seed, preset, seams: { classify: statedIntent } });
  try {
    const initial = world(game);
    const finalDeadline = Math.max(...initial.plot.stages.map((s) => s.deadline.day));
    const decrypted = new Set<string>();
    let lastSweep = -Infinity;
    let traced = false;
    const rec: Recruitment = { given: new Set(), assets: new Map() };
    const trajectory: number[] = [];
    const record = (): void => {
      const st = world(game);
      const score = game.api.caseFile.evidence(leaderOf(st));
      while (trajectory.length <= st.time.day) {
        trajectory.push(trajectory.length === 0 ? 0 : trajectory[trajectory.length - 1]);
      }
      trajectory[st.time.day] = Math.max(trajectory[st.time.day], score);
    };

    while (!game.over && game.turns.length < MAX_PROBE_TURNS) {
      if (options.calibrate === true) record();
      await readUnread(game);
      if (game.over) break;
      await decryptAll(game, decrypted);
      if (game.over) break;

      const state = world(game);
      const handles = leaderHandles(state);

      // Arrest the leader the moment the gate opens (never in calibration mode).
      if (
        options.calibrate !== true &&
        (await tryPlay(game, (a) => a.kind === 'arrest' && handles.has(a.npc)))
      ) {
        break;
      }

      // Once the leader is a known entity, ask HQ for its file once.
      if (!traced && state.player.known.entities.includes(leaderOf(state))) {
        const station = stationId(game);
        if (station !== undefined && (await travel(game, station))) {
          traced = await tryPlay(
            game,
            (a) => a.kind === 'cable' && a.body.kind === 'trace' && a.body.target === leaderOf(state),
          );
          if (traced) continue;
        }
      }

      // A Plot event within the next day takes priority over everything else:
      // be at its Location when it happens and watch from that exact phase.
      const event = nextPlotEvent(game);
      if (event !== undefined) {
        const lead = ordinal(event.at) - ordinal(world(game).time);
        const at = game.api.status().location.id;
        if (lead <= 4) {
          if (event.loc !== at) {
            if (await travel(game, event.loc)) continue;
          } else if (lead === 0) {
            if (await tryPlay(game, (a) => a.kind === 'surveil' && a.phases === 1)) continue;
          } else if (await tryPlay(game, (a) => a.kind === 'wait' && a.phases === 1)) {
            continue;
          }
        }
      }

      // Collect traffic at the Station on a fixed rhythm.
      const now = ordinal(state.time);
      if (now - lastSweep >= SWEEP_EVERY_PHASES) {
        const station = stationId(game);
        if (station !== undefined && (await travel(game, station))) {
          if (await tryPlay(game, (a) => a.kind === 'intercept')) {
            lastSweep = ordinal(world(game).time);
            continue;
          }
        }
      }

      // With no handle on the leader yet, get a sighting first: go where they
      // will be and watch, so the player has an `unk:` id to task Assets on.
      const leaderNow = leaderOf(world(game));
      if (
        !world(game).player.known.entities.includes(leaderNow) &&
        world(game).player.unkIds[leaderNow] === undefined
      ) {
        const sight = nextLeaderSighting(game, 12);
        if (sight !== undefined) {
          const at = game.api.status().location.id;
          if (sight.loc !== at) {
            if (await travel(game, sight.loc)) continue;
          } else if (ordinal(sight.at) === ordinal(world(game).time)) {
            if (await tryPlay(game, (a) => a.kind === 'surveil' && a.phases === 1)) continue;
          } else if (await tryPlay(game, (a) => a.kind === 'wait' && a.phases === 1)) {
            continue;
          }
        }
      }

      // Recruit an informant close to the leader and task them on the leader.
      if (await workInformant(game, rec)) continue;

      // Follow the leader if they are in view, else stake out where they will be.
      if (await tryPlay(game, (a) => a.kind === 'follow' && handles.has(a.target))) continue;
      const here = game.api.status().location.id;
      const sighting = nextLeaderSighting(game, 8);
      if (sighting !== undefined) {
        if (sighting.loc !== here) {
          if (await travel(game, sighting.loc)) continue;
        } else if (ordinal(sighting.at) === ordinal(world(game).time)) {
          if (await tryPlay(game, (a) => a.kind === 'surveil' && a.phases === 1)) continue;
        }
      }
      if (await tryPlay(game, (a) => a.kind === 'wait' && a.phases === 1)) continue;
      break;
    }

    const end = world(game);
    const leader = leaderOf(end);
    const ended = end.ended;
    let outcome: ProbeOutcome = 'stalled';
    if (ended !== undefined) {
      if (ended.outcome === 'success') outcome = 'win';
      else if (ended.cause === 'burned') outcome = 'burned';
      else if (ended.cause === 'plot-completed') outcome = 'plot-completed';
      else outcome = 'wrongful';
    }
    return {
      seed,
      preset,
      outcome,
      ...(ended === undefined ? {} : { cause: ended.cause }),
      day: (ended?.at ?? end.time).day,
      finalDeadline,
      turns: game.turns.length,
      evidence: game.api.caseFile.evidence(leader),
      threshold: end.meta.preset.arrest.threshold,
      ...(options.calibrate === true ? { trajectory } : {}),
    };
  } finally {
    await game.close();
  }
}

/** The window a vetted seed's expert win must land in, as a timeline fraction. */
export const VETTED_WIN_WINDOW = [0.3, 0.8] as const;

/** The verdict on one candidate seed. */
export interface SeedVerdict {
  readonly ok: boolean;
  readonly result: ProbeResult;
}

/**
 * Vet a seed for the featured list: the expert must win, and the win must land
 * inside {@link VETTED_WIN_WINDOW} of the operation's timeline — a seed that can
 * be cracked in the opening days, or only on the final day, is not featured.
 */
export async function vetSeed(seed: string, preset: ScriptedPreset): Promise<SeedVerdict> {
  const result = await probeSeed(seed, preset);
  const fraction = result.day / result.finalDeadline;
  const ok =
    result.outcome === 'win' &&
    fraction >= VETTED_WIN_WINDOW[0] &&
    fraction <= VETTED_WIN_WINDOW[1];
  return { ok, result };
}
