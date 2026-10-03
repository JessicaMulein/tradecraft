/**
 * The Hostile Service's daily comms traffic for the Cipher Engine (task 19.4;
 * design, "Hostile Service AI" `dailyTick` step 8: "Generation of comms traffic
 * for the Cipher Engine"; Requirement 29.4).
 *
 * The world is seeded at assembly with its opening stretch of interceptable
 * traffic — Plot Stage traces, Side Thread traces and Noise Traffic Channels —
 * by `../cipher/world-intercepts.ts` ({@link import('../cipher/world-intercepts.js').seedWorldIntercepts}),
 * which hands the Cipher Engine a list of {@link InterceptSource}s to encipher.
 * This leaf is the *daily* counterpart: on each day boundary the Hostile Service
 * runs its own channels (its link to the Cell and its decoy noise channels), and
 * the day-to-day transmissions it puts on the wire are the interceptable traffic
 * the Cipher Engine's intercept path collects on that day (Req 29.4).
 *
 * Like the seeding seam, this producer returns {@link InterceptSource}s as pure
 * data — it does **not** reach into `WorldState`, mint ciphertext, or touch the
 * Cipher Engine. The Turn Pipeline / clock threads the returned sources into the
 * same intercept path `seedWorldIntercepts` uses (encipher on the cipher stream,
 * write to `WorldState.transmissions`), so the day's hostile traffic competes
 * with the signal in the player's take exactly as the seeded noise does.
 *
 * ## What a day produces
 *
 * The Turn Pipeline projects in the interceptable Channels the service runs
 * today (a {@link HostileChannel} per Channel, with its owner category for the
 * Cipher Engine's cipher weighting and the day's firing phases from the
 * Channel's schedule). For each firing on the tick's day the producer mints one
 * source:
 *
 * - a **real** transmission carrying the Propositions the Turn Pipeline
 *   projected for that channel, when it supplied any; or
 * - a **decoy** transmission carrying a plausible-but-irrelevant `USES_CHANNEL`
 *   fact (mirroring the noise seeding), when the channel has no real payload for
 *   the day.
 *
 * Either way the source is tagged `origin: 'deception'` (see below).
 *
 * Each source is tagged with the Channel's owner category (`hostile` for the
 * service's own link, `noise` for a decoy channel it runs) so the Cipher Engine
 * weights the cipher kind correctly, and `origin: 'deception'` — the design's
 * fourth Intercept origin (`plot | side-thread | noise | deception`) — so a
 * later debrief can attribute the traffic to the Hostile Service's deception
 * programme rather than to the Plot or ordinary noise.
 *
 * ## Purity / determinism
 *
 * {@link produceCommsTraffic} makes **no draws** — it is a pure projection of
 * the day's channel firings into sources, with the decoy-vs-real choice decided
 * by whether a real payload was projected in. Threading it into the daily tick
 * therefore cannot shift the detection or arrest-article streams (it rides no
 * stream at all; the Cipher Engine draws its own ciphers on the cipher stream
 * when the pipeline later enciphers these sources). The firings are enumerated
 * in a fixed, id-sorted channel order, so the result is a pure function of the
 * inputs regardless of record order (Requirement 1.2). A day with no projected
 * channels, or none firing today, produces `[]`.
 */

import type {
  ChannelId,
  GameTime,
  Phase,
  Proposition,
  PropId,
} from '../model/core.js';
import type { CommsOwner } from '../city/comms.js';
import type {
  InterceptSource,
  InterceptOwnerKind,
} from '../cipher/intercept.js';

// ---------------------------------------------------------------------------
// The projected channels
// ---------------------------------------------------------------------------

/**
 * The owner category a hostile comms channel reports for the Cipher Engine's
 * cipher weighting: the service's own strong link is `hostile`; a decoy channel
 * it runs to muddy the player's take is `noise` (favouring the simpler ciphers,
 * so it reads as ordinary chatter). Only these two categories arise from the
 * service's traffic — Plot/Station traffic is produced elsewhere.
 */
export type HostileOwnerKind = Extract<InterceptOwnerKind, 'hostile' | 'noise'>;

/**
 * One interceptable Channel the Hostile Service runs, projected in by the Turn
 * Pipeline (this leaf is `WorldState`-free). It carries the Channel id (for the
 * minted source and its stable transmission id), the owner id and owner
 * *category* the Cipher Engine weights by, the day's firing phases (the phases
 * at which the Channel's schedule fires on the tick's day — enumerated by the
 * caller from the Channel schedule), and the real Propositions the service puts
 * on this channel today, if any. A channel with no real payload emits a decoy.
 */
export interface HostileChannel {
  /** The Channel id the traffic rides. */
  readonly channel: ChannelId;
  /** The raw owner id (an org or NPC), carried onto the source. */
  readonly owner: CommsOwner;
  /** The owner category for cipher weighting (`hostile` link / `noise` decoy). */
  readonly ownerKind: HostileOwnerKind;
  /** The phases at which this Channel fires on the tick's day. */
  readonly firings: readonly Phase[];
  /**
   * The real Propositions the service transmits on this channel today, if any.
   * Omitted / empty ⇒ the firing is a decoy carrying a `USES_CHANNEL` fact.
   */
  readonly payload?: readonly Proposition[];
}

/**
 * The day's hostile channels, keyed by Channel id (used to id-sort the channels
 * so the firing order — and thus the minted source order — is deterministic
 * regardless of record order). An empty map ⇒ the service runs no interceptable
 * traffic today, so the producer is a no-op.
 */
export type HostileChannelProjection = Readonly<Record<ChannelId, HostileChannel>>;

// ---------------------------------------------------------------------------
// Transmission ids and the decoy fact
// ---------------------------------------------------------------------------

/**
 * The stable transmission id of a daily hostile firing, mirroring
 * `../cipher/world-intercepts.ts`'s `noiseTransmissionId`: keyed by the Channel
 * and the firing time so it is stable, reads back to origin, and never collides
 * with the seeded ids (the `hostile-tx:` prefix is distinct from `noise-tx:`).
 */
export function hostileTransmissionId(
  channelId: ChannelId,
  at: GameTime,
): string {
  return `hostile-tx:${channelId}@${at.day}.${at.phase}`;
}

/**
 * A plausible-but-irrelevant Proposition for a decoy hostile firing: the
 * Channel's owner `USES_CHANNEL` the Channel (a true, routine fact that reveals
 * nothing). Mirrors the noise seeding's decoy fact so a hostile decoy is
 * indistinguishable from ordinary noise in the player's take.
 */
export function decoyProposition(channel: HostileChannel, at: GameTime): Proposition {
  const id: PropId = `prop:hostile-comms/${channel.channel}@${at.day}.${at.phase}`;
  return {
    id,
    subject: channel.owner,
    predicate: 'USES_CHANNEL',
    object: { kind: 'text', value: channel.channel },
  };
}

// ---------------------------------------------------------------------------
// produceCommsTraffic
// ---------------------------------------------------------------------------

/**
 * Produce the Hostile Service's daily comms traffic as {@link InterceptSource}s
 * (design `dailyTick` step 8; Req 29.4). Pure, no draws.
 *
 * The projected channels are id-sorted; for each, every firing phase on the
 * tick's day mints one source at `{ day: at.day, phase }`. A channel with a real
 * `payload` carries those Propositions; a channel with none carries a single
 * {@link decoyProposition}. Every source is tagged `origin: 'deception'` (the
 * design's fourth Intercept origin) and the channel's owner category, so the
 * Cipher Engine weights the cipher correctly and a debrief can attribute the
 * traffic to the service.
 *
 * The returned sources are the data the Turn Pipeline / clock threads into the
 * Cipher Engine's intercept path (the same path `seedWorldIntercepts` feeds), so
 * this leaf never enciphers, never draws, and never touches `WorldState`.
 */
export function produceCommsTraffic(
  channels: HostileChannelProjection,
  at: GameTime,
): InterceptSource[] {
  const ids = Object.keys(channels).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  ) as ChannelId[];

  const sources: InterceptSource[] = [];
  for (const id of ids) {
    const channel = channels[id];
    // Firings in schedule order; a stable phase sort keeps the per-channel
    // source order deterministic regardless of the projected firing order.
    const phases = [...channel.firings].sort((a, b) => a - b);
    for (const phase of phases) {
      const firingAt: GameTime = { day: at.day, phase };
      const real = channel.payload ?? [];
      const propositions =
        real.length > 0 ? [...real] : [decoyProposition(channel, firingAt)];
      sources.push({
        id: hostileTransmissionId(channel.channel, firingAt),
        channel: channel.channel,
        at: firingAt,
        ownerKind: channel.ownerKind,
        origin: 'deception',
        propositions,
      });
    }
  }
  return sources;
}
