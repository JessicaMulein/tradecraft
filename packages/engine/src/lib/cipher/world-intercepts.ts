/**
 * World-assembly Intercept seeding: minting the real ciphertext Intercepts for
 * every interceptable firing a generated world produces (task 26.3; design,
 * "Noise Generator" / "Cipher Engine"; Requirements 9.1, 9.5, 25.3, 29.2,
 * 29.4).
 *
 * Task 8.3 built the Cipher Engine's {@link generateIntercepts}: given a list of
 * {@link InterceptSource} transmissions, each carrying the {@link Proposition}s
 * it puts on the wire, it draws an owner-weighted cipher, injects any tradecraft
 * error, and enciphers the field message into an {@link Intercept}. This module
 * is the seam that *feeds* that engine from a generated world and writes the
 * result back into `WorldState.transmissions` / `WorldState.intercepts`:
 *
 * - **Plot Stage transmission traces** (task 26.1/26.2) — each `transmission`
 *   trace of a Plot Stage, resolved to the interceptable Channel it runs on,
 *   carries the Plot's operation Propositions as plaintext (Req 9.1);
 * - **Side Thread transmission traces** (task 6.2) — each Side Thread's
 *   `transmission`/courier trace carries that thread's own true Propositions
 *   (Req 29.2);
 * - **Noise Traffic Channels** (task 6.3) — each decoy radio/numbers Channel
 *   mints a noise Intercept on each firing of its schedule inside the game's
 *   first days (Req 29.4), carrying a plausible-but-irrelevant `USES_CHANNEL`
 *   field so the noise competes with the signal in the player's take.
 *
 * The Cipher Engine needs key material to encipher (and to let the Sim later
 * verify a submission, task 8.4): a book cipher keys to a public text's letters,
 * a one-time pad to a pad's stream. {@link worldCipherKeyLookup} supplies both
 * from the world *deterministically* — book texts from the public-text
 * {@link import('../docs/document.js').Document}s the generator already placed in
 * `WorldState.documents`, and one-time pads from a seed-derived pool
 * ({@link derivePad}) keyed by a small set of pad ids. Because the pad pool is a
 * pure function of the world seed, no pad material needs to be stored on the
 * World State: a later verification rebuilds the identical lookup from
 * `(seed, documents)`.
 *
 * ## Determinism
 *
 * Seeding runs on its own PRNG stream ({@link CIPHER_STREAM_BASE}) so it never
 * perturbs a core or noise draw, and every list it feeds the engine is built in
 * a fixed, id-sorted order, so the Transmissions and Intercepts are a pure
 * function of `(seed, world)` (Requirement 1.2). The Intercept id a firing mints
 * is {@link interceptIdOf} of the firing's transmission id, so a `transmission`
 * SimEvent (task 26.2) can reference the real Intercept by computing the same id
 * from the stage/trace it fires (see {@link plotTransmissionId}).
 */

import {
  derive,
  createPrng,
  type Prng,
} from '../prng/prng.js';
import {
  type ChannelId,
  type DocId,
  type EntityId,
  type GameTime,
  type Proposition,
  type PropId,
} from '../model/core.js';
import {
  isInterceptableKind,
  transmissionTimes,
  type Channel,
} from '../city/comms.js';
import {
  type PlotState,
  type StageState,
  type StageTrace,
} from '../city/plot.js';
import {
  type SideThreadState,
  type SideThreadTrace,
} from '../noise/side-threads.js';
import type { DifficultyPreset } from '@tradecraft/content';
import type { Document } from '../docs/document.js';
import { type CipherKind } from './cipher.js';
import {
  type CipherKeyLookup,
} from './spec.js';
import {
  generateIntercepts,
  buildTransmissions,
  interceptIdOf,
  type InterceptSource,
  type InterceptOwnerKind,
  type Intercept,
  type Transmission,
} from './intercept.js';

// ---------------------------------------------------------------------------
// PRNG stream
// ---------------------------------------------------------------------------

/**
 * The base offset of the **cipher** PRNG stream, `derive(seed, 0x30000)`. The
 * Intercept seeding draws its cipher-kind and tradecraft-error coins from this
 * stream, kept distinct from the core (`seed`), noise (`0x10000`) and daily
 * (`0x20000 + day`) streams so adding or changing a cipher draw never shifts a
 * core or noise draw (Requirement 1.2, 29.5).
 */
export const CIPHER_STREAM_BASE = 0x30000;

/**
 * How many days of a Channel's schedule are enumerated into firings when
 * seeding Intercepts. A world is seeded with the traffic of its opening stretch;
 * the clock mints further transmissions as play advances past this horizon
 * (that wiring is the Turn Pipeline's). Chosen comfortably longer than the
 * retention window so the opening days of play always have in-window traffic to
 * collect.
 */
export const SEED_HORIZON_DAYS = 14;

// ---------------------------------------------------------------------------
// Deterministic one-time pads
// ---------------------------------------------------------------------------

/** The number of pad ids the seeded pool offers (shared so pad reuse is possible). */
export const PAD_POOL_SIZE = 4;

/** The letter length of each seed-derived pad (long enough to key any field message). */
export const PAD_LENGTH = 2048;

/** The pad ids the seeded pool offers, in a fixed order: `pad:0 … pad:N-1`. */
export function padPoolIds(): string[] {
  const ids: string[] = [];
  for (let i = 0; i < PAD_POOL_SIZE; i += 1) {
    ids.push(`pad:${i}`);
  }
  return ids;
}

/**
 * Derive a deterministic one-time pad's letter stream from the world seed and a
 * pad id. A pad is a long run of A–Z letters drawn from a PRNG seeded by
 * `derive(seed, "pad:" + padId)`, so the same `(seed, padId)` always yields the
 * identical pad — which is what lets {@link worldCipherKeyLookup} rebuild the
 * pool for verification without storing pad material on the World State.
 */
export function derivePad(seed: string, padId: string): string {
  // Seed a PRNG with a stable string derived from the world seed and the pad id
  // (createPrng takes a string seed); the same `(seed, padId)` always yields the
  // identical pad, so the pool is reproducible without storing pad material.
  const prng = createPrng(`${seed}|pad|${padId}`);
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < PAD_LENGTH; i += 1) {
    out += letters[prng.int(0, 25)];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cipher key lookup from the world
// ---------------------------------------------------------------------------

/**
 * Build the {@link CipherKeyLookup} the Cipher Engine resolves book and
 * one-time-pad specs against, from a generated world. Book ciphers key to the
 * letters of a public-text {@link Document} already in `WorldState.documents`
 * (so the key material the player can also read in-game is a real public text,
 * design "Cipher Engine"); one-time pads key to the seed-derived pool
 * ({@link derivePad}). Both are pure functions of `(seed, documents)`, so the
 * same lookup can be rebuilt for verification (task 8.4) without storing pad
 * material on the World State.
 */
export function worldCipherKeyLookup(
  seed: string,
  documents: Readonly<Record<DocId, Document>>,
): CipherKeyLookup {
  const padIds = new Set(padPoolIds());
  const padCache = new Map<string, string>();
  return {
    publicText(id: DocId): string | undefined {
      const doc = documents[id];
      return doc?.body;
    },
    pad(id: string): string | undefined {
      if (!padIds.has(id)) {
        return undefined;
      }
      let pad = padCache.get(id);
      if (pad === undefined) {
        pad = derivePad(seed, id);
        padCache.set(id, pad);
      }
      return pad;
    },
  };
}

/**
 * The public-text document ids a book cipher may key to: the `public-text`
 * Documents the generator placed in `WorldState.documents`, id-sorted so the
 * generator's draw against the pool is deterministic. Empty when the world has
 * no public text (book ciphers then simply never drawn — see
 * {@link generateIntercepts}).
 */
export function publicTextIdsOf(
  documents: Readonly<Record<DocId, Document>>,
): DocId[] {
  return (Object.values(documents) as Document[])
    .filter((d) => d.kind === 'public-text' && d.body.length > 0)
    .map((d) => d.id)
    .sort();
}

// ---------------------------------------------------------------------------
// Transmission ids (shared with plot-execution, task 26.2)
// ---------------------------------------------------------------------------

/**
 * The stable transmission id of a Plot Stage transmission trace. The seeding
 * mints the trace's Intercept under {@link interceptIdOf} of this id, and
 * `plot-execution.ts` (task 26.2) computes the same id so its `transmission`
 * SimEvent's `intercept` field references the real minted Intercept. Keyed by
 * the stage id and the trace's index so it is stable and reads back to origin.
 */
export function cellTrafficTransmissionId(channelId: ChannelId, at: GameTime): string {
  return `cell-tx:${channelId}@${at.day}.${at.phase}`;
}

/** The stable transmission id of a Plot stage transmission trace. */
export function plotTransmissionId(stageId: string, traceIndex: number): string {
  return `plot-tx:${stageId}/${traceIndex}`;
}

/** The stable transmission id of a Side Thread transmission trace. */
export function sideThreadTransmissionId(
  threadId: string,
  traceIndex: number,
): string {
  return `thread-tx:${threadId}/${traceIndex}`;
}

/** The stable transmission id of a Noise Traffic firing on a Channel. */
export function noiseTransmissionId(
  channelId: ChannelId,
  at: GameTime,
): string {
  return `noise-tx:${channelId}@${at.day}.${at.phase}`;
}

/**
 * The Intercept id a Plot Stage transmission trace mints — the id a
 * `transmission` SimEvent references. Shared with `plot-execution.ts` (task
 * 26.2) so the SimEvent and the seeded Intercept always agree.
 */
export function plotTraceInterceptId(stageId: string, traceIndex: number) {
  return interceptIdOf(plotTransmissionId(stageId, traceIndex));
}

// ---------------------------------------------------------------------------
// Owner category
// ---------------------------------------------------------------------------

/**
 * The owner category of a transmission, for the Cipher Engine's cipher-kind
 * weighting ({@link InterceptOwnerKind}). The seeding tags Plot traffic `cell`
 * (the Cell's own signal), Side Thread and Noise traffic `noise` (plausible
 * civilian/decoy chatter the simple ciphers reflect). The Hostile Service's and
 * the Station's own traffic are not seeded here (they are not Plot/Side-Thread/
 * Noise producers), so `hostile`/`station` do not arise.
 */
export type SeedOwnerKind = Extract<InterceptOwnerKind, 'cell' | 'noise'>;

// ---------------------------------------------------------------------------
// Channel resolution for a Plot transmission trace
// ---------------------------------------------------------------------------

/**
 * Resolve a Plot transmission trace's {@link StageTrace.channelKind} to the
 * concrete interceptable {@link Channel} it runs on, matching the resolution
 * `plot-execution.ts` (task 26.2) uses: a Channel of the trace's kind owned by
 * one of the trace's own participants, else by any bound Plot NPC, else the
 * first Channel of that kind by id. Only interceptable (radio/numbers) Channels
 * are considered — a courier trace is intercepted on its route, not seeded as
 * Station-collectable traffic. `undefined` when the Cell runs no interceptable
 * Channel of the trace's kind.
 */
function resolvePlotTraceChannel(
  trace: StageTrace,
  plot: PlotState,
  channels: Readonly<Record<ChannelId, Channel>>,
): Channel | undefined {
  if (trace.channelKind === undefined || !isInterceptableKind(trace.channelKind)) {
    return undefined;
  }
  const kind = trace.channelKind;
  const ofKind = (Object.values(channels) as Channel[])
    .filter((c) => c.kind === kind)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (ofKind.length === 0) {
    return undefined;
  }
  const participants = new Set<string>(trace.participants);
  const byParticipant = ofKind.find((c) => participants.has(c.owner));
  if (byParticipant !== undefined) {
    return byParticipant;
  }
  const plotOwners = new Set<string>(plotNpcs(plot));
  const byPlot = ofKind.find((c) => plotOwners.has(c.owner));
  return byPlot ?? ofKind[0];
}

/** The bound Plot NPC owner set (role holders plus the leader), as plain strings. */
function plotNpcs(plot: PlotState): string[] {
  const set = new Set<string>();
  for (const role of plot.roles) {
    if (role.npc !== undefined) {
      set.add(role.npc);
    }
  }
  set.add(plot.leader as unknown as string);
  return [...set];
}

// ---------------------------------------------------------------------------
// Source gathering
// ---------------------------------------------------------------------------

/**
 * The inputs {@link seedWorldIntercepts} reads from an assembled world: the
 * seed (for the cipher stream and the pad pool), the Plot, the Side Threads, the
 * world's Channels and Documents, and the resolved Difficulty Preset (its
 * `allowedCiphers` and `tradecraftErrorProbability`).
 */
export interface SeedInterceptsInputs {
  readonly seed: string;
  readonly plot: PlotState;
  readonly sideThreads: readonly SideThreadState[];
  readonly channels: Readonly<Record<ChannelId, Channel>>;
  readonly documents: Readonly<Record<DocId, Document>>;
  readonly preset: DifficultyPreset;
  readonly fieldCodes: ReadonlyMap<string, string>;
  /** The Plot's operation Propositions, the plaintext a Plot trace carries (Req 9.1). */
  readonly plotPropositions: readonly Proposition[];
  /** The game start time (the schedule floor for noise firings). */
  readonly start: GameTime;
}

/** The output of {@link seedWorldIntercepts}: the seeded transmissions + intercepts. */
export interface SeededIntercepts {
  readonly transmissions: readonly Transmission[];
  readonly intercepts: Readonly<Record<string, Intercept>>;
}

/**
 * Gather the Plot Stage transmission traces into {@link InterceptSource}s. Each
 * `transmission` trace of each stage, resolved to its interceptable Channel,
 * becomes one source firing at the stage's deadline (where its `transmission`
 * SimEvent lands, task 26.2), carrying the Plot's operation Propositions as
 * plaintext. Stages and traces are walked in order; a trace whose Channel does
 * not resolve to an interceptable one is skipped.
 */
function plotSources(inputs: SeedInterceptsInputs): InterceptSource[] {
  const out: InterceptSource[] = [];
  const props = [...inputs.plotPropositions];
  for (const stage of inputs.plot.stages) {
    for (const trace of stage.traces) {
      if (trace.kind !== 'transmission') {
        continue;
      }
      const channel = resolvePlotTraceChannel(trace, inputs.plot, inputs.channels);
      if (channel === undefined) {
        continue;
      }
      const carried = tracePropositions(props, trace, stage);
      if (carried.length === 0) {
        continue;
      }
      out.push({
        id: plotTransmissionId(stage.id, trace.index),
        channel: channel.id,
        at: stage.deadline,
        ownerKind: 'cell',
        origin: 'plot',
        propositions: carried,
      });
    }
  }
  return out;
}

/**
 * The Propositions a Plot transmission trace carries: the stage's key
 * Propositions ({@link stagePropositions}), which is what the design says the
 * Cipher Engine encodes ("Intercepts whose plaintexts encode that stage's
 * Propositions") and what the discovery verifier's signal route assumes.
 */
function tracePropositions(
  pool: readonly Proposition[],
  _trace: StageTrace,
  stage: StageState,
): Proposition[] {
  return stageTransmissionPropositions(pool, stage);
}

/**
 * A Plot stage's key Propositions: the operation facts (from `pool`) whose
 * predicate any trace of the stage evidences — the same definition the
 * discovery verifier uses for a stage's key facts. A stage whose traces
 * evidence nothing in the pool falls back to the whole pool, so a Plot
 * transmission always carries real signal. The stage's participants'
 * `MEMBER_OF` facts ride along (a signed message names its sender's Cell).
 * Shared by world assembly and the
 * runtime `plot` hook so both mint identical plaintexts.
 */
export function stagePropositions(
  pool: readonly Proposition[],
  stage: StageState,
): Proposition[] {
  const wanted = new Set(stage.traces.flatMap((t) => t.evidences));
  const matched = pool.filter((p) => wanted.has(p.predicate));
  // Cell traffic is signed: an operative's call sign ties the sender to the
  // Cell, so a stage's traffic also carries its participants' membership.
  const senders = new Set<string>(stage.traces.flatMap((t) => t.participants));
  const membership = pool.filter(
    (p) => p.predicate === 'MEMBER_OF' && senders.has(p.subject) && !matched.includes(p),
  );
  const carried = [...matched, ...membership];
  return carried.length > 0 ? carried : [...pool];
}

/**
 * A stage transmission's plaintext: the stage's key facts
 * ({@link stagePropositions}) and the plan (`PLANS`), without the target. The
 * target goes out only in the go-orders of the operation's later steps (see the
 * `plot` hook's routine traffic).
 */
export function stageTransmissionPropositions(
  pool: readonly Proposition[],
  stage: StageState,
): Proposition[] {
  const carried = stagePropositions(pool, stage).filter((p) => p.predicate !== 'TARGETS');
  const plans = pool.filter((p) => p.predicate === 'PLANS' && !carried.includes(p));
  // The shared case (membership of the leader and the person they meet) has to
  // ride on the traffic the Station actually collects, not only on the one
  // message whose sender happens to be that person.
  const caseFacts = pool.filter(
    (p) => p.id.startsWith('prop:library-case/') && !carried.includes(p) && !plans.includes(p),
  );
  const merged = [...carried, ...plans, ...caseFacts];
  return merged.filter((p) => !extraCellMembership(p, pool));
}

/**
 * A false-flag plot records the operation's own cell as a second membership.
 * The person is already a member of the cell the brief names. Sending both
 * makes the two disagree, and a disagreed membership counts for nothing.
 * Keep the brief's cell and leave the extra one off the air, whichever
 * message it would have ridden.
 */
/** The membership a message may carry for one person: the cell the brief names. */
export function membershipOnTheAir(pool: readonly Proposition[], subject: EntityId): Proposition[] {
  return pool.filter(
    (prop) =>
      prop.predicate === 'MEMBER_OF' && prop.subject === subject && !extraCellMembership(prop, pool),
  );
}

function extraCellMembership(prop: Proposition, pool: readonly Proposition[]): boolean {
  if (prop.predicate !== 'MEMBER_OF' || prop.object === 'org:cell') {
    return false;
  }
  return pool.some(
    (other) =>
      other.predicate === 'MEMBER_OF' &&
      other.subject === prop.subject &&
      other.object === 'org:cell',
  );
}

/**
 * Gather the Side Thread transmission traces into {@link InterceptSource}s. Each
 * thread's `transmission` trace, resolved to one of the thread's own
 * interceptable Channels, becomes a source carrying the thread's true
 * Propositions (Req 29.2). A thread with no interceptable Channel, or a trace
 * with no transmission kind, is skipped.
 */
function sideThreadSources(inputs: SeedInterceptsInputs): InterceptSource[] {
  const out: InterceptSource[] = [];
  for (const thread of inputs.sideThreads) {
    const signal = thread.channels
      .filter((c) => isInterceptableKind(c.kind))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
    if (signal === undefined) {
      continue;
    }
    if (thread.propositions.length === 0) {
      continue;
    }
    for (const trace of thread.traces) {
      if (trace.kind !== 'transmission') {
        continue;
      }
      out.push({
        id: sideThreadTransmissionId(thread.id, trace.index),
        channel: signal.id,
        at: traceTime(trace, inputs.start),
        ownerKind: 'noise',
        origin: 'side-thread',
        propositions: [...thread.propositions],
      });
    }
  }
  return out;
}

/** A Side Thread trace's firing time: the signal Channel's first firing (the thread start). */
function traceTime(_trace: SideThreadTrace, start: GameTime): GameTime {
  return start;
}

/**
 * Gather the Noise Traffic Channels into {@link InterceptSource}s: one firing
 * per schedule firing of each interceptable noise Channel inside
 * {@link SEED_HORIZON_DAYS}, carrying a plausible `USES_CHANNEL` noise field so
 * the decoy competes with the signal in the player's take (Req 29.4). Noise
 * Channels are the `chan:noise/…` ids (owned by a `org:noise-<family>` source);
 * their schedules are enumerated with {@link transmissionTimes}.
 */
function noiseSources(inputs: SeedInterceptsInputs): InterceptSource[] {
  const out: InterceptSource[] = [];
  const noiseChannels = (Object.values(inputs.channels) as Channel[])
    .filter((c) => c.id.startsWith('chan:noise/') && isInterceptableKind(c.kind))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const horizon = inputs.start.day + SEED_HORIZON_DAYS;
  for (const channel of noiseChannels) {
    const firings = transmissionTimes(channel.schedule, horizon);
    for (const at of firings) {
      out.push({
        id: noiseTransmissionId(channel.id, at),
        channel: channel.id,
        at,
        ownerKind: 'noise',
        origin: 'noise',
        propositions: [noiseProposition(channel, at)],
      });
    }
  }
  return out;
}

/**
 * A plausible-but-irrelevant Proposition for a noise firing: the Channel's owner
 * `USES_CHANNEL` the Channel (a true, routine fact that reveals nothing about
 * the Plot). `USES_CHANNEL` takes a text-literal object (the channel name), per
 * the core predicate vocabulary.
 */
function noiseProposition(channel: Channel, at: GameTime): Proposition {
  const id: PropId = `prop:noise/${channel.id}@${at.day}.${at.phase}`;
  return {
    id,
    subject: channel.owner,
    predicate: 'USES_CHANNEL',
    object: { kind: 'text', value: channel.id },
  };
}

// ---------------------------------------------------------------------------
// seedWorldIntercepts
// ---------------------------------------------------------------------------

/**
 * Seed a generated world's Intercepts and Transmissions (task 26.3; design,
 * "Cipher Engine"; Requirements 9.1, 9.5, 25.3, 29.2, 29.4).
 *
 * Gathers the Plot Stage transmission traces, the Side Thread transmission
 * traces and the Noise Traffic firings into one id-sorted list of
 * {@link InterceptSource}s, runs the Cipher Engine ({@link generateIntercepts})
 * over them on the cipher stream ({@link CIPHER_STREAM_BASE}), and pairs the
 * minted Intercepts back up into {@link Transmission} records. The returned
 * `transmissions` seed `WorldState.transmissions`; the returned `intercepts` are
 * the full ciphertext records (keyed by id) the collected Intercepts are copied
 * from — but `WorldState.intercepts` starts *empty* (the player has collected
 * nothing), so the caller writes only `transmissions` into the world and leaves
 * `intercepts` as `{}` until the intercept action delivers them.
 *
 * Pure and deterministic in `(seed, world)`: the only draws are the Cipher
 * Engine's, on the cipher stream, over an id-sorted source list.
 */
export function seedWorldIntercepts(
  inputs: SeedInterceptsInputs,
): SeededIntercepts {
  // Gather in a fixed producer order, then sort by transmission id so the
  // Cipher Engine's draw order (and therefore the result) is stable.
  const sources: InterceptSource[] = [
    ...plotSources(inputs),
    ...sideThreadSources(inputs),
    ...noiseSources(inputs),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const keyLookup = worldCipherKeyLookup(inputs.seed, inputs.documents);
  const allowedCiphers: readonly CipherKind[] = inputs.preset.allowedCiphers;

  const prng: Prng = createPrng(derive(inputs.seed, CIPHER_STREAM_BASE));
  const generated = generateIntercepts(prng, sources, {
    channels: inputs.channels,
    fieldCodes: inputs.fieldCodes,
    allowedCiphers,
    tradecraftErrorProbability: inputs.preset.tradecraftErrorProbability,
    publicTextIds: publicTextIdsOf(inputs.documents),
    padIds: padPoolIds(),
    keyLookup,
  });

  const transmissions = buildTransmissions(sources, generated, inputs.channels);
  return { transmissions, intercepts: generated.intercepts };
}
