/**
 * Intercept generation: turning the Hostile Service's (and noise owners')
 * transmissions into the ciphertext the player captures off a Channel.
 *
 * This is the Cipher Engine's `makeIntercept` step (design, "Cipher Engine";
 * Requirements 9.1, 9.4, 29.4). A transmission on an interceptable Channel —
 * raised by a Plot Stage trace (task 7.2), a Side Thread (task 6.2) or Noise
 * Traffic (task 6.3) — carries a handful of {@link Proposition}s describing what
 * is about to happen. Before it goes on the wire the Cipher Engine:
 *
 * 1. encodes the Propositions to a terse field message with
 *    {@link encodePropositions} (predicate-keyed plaintext, Requirement 9.1);
 * 2. draws a {@link CipherKind} weighted by the transmission's **owner** — the
 *    organisation whose tradecraft the traffic reflects (a hostile resident or
 *    the Cell favours numbers broadcasts with strong keys — book and one-time
 *    pad; the Station favours Vigenère; noise owners favour the simple hand
 *    ciphers so the player can triage them, design "Cipher Engine");
 * 3. resolves a drawn {@link CipherSpec} to a {@link CipherKey} and
 *    {@link encrypt}s the field message into the Intercept's ciphertext;
 * 4. at the preset's `tradecraftErrorProbability`, injects an operator mistake
 *    the player can exploit (Requirement 9.4): **pad reuse** — two one-time-pad
 *    Intercepts share a pad, so XORing their ciphertexts cancels the key — or a
 *    **fixed header** — a stereotyped crib (`NR` plus a date group) repeated
 *    across messages, a classic known-plaintext opening.
 *
 * The whole module is pure and deterministic: every random choice is drawn from
 * the passed {@link Prng} in a fixed order over the id-sorted transmission list,
 * exactly as the city, principal and comms generators do, so a seed plus the
 * same inputs always yields the same Intercepts (Requirement 1.2, underpinning
 * Property 1). It never reaches into the Plot, Side Thread or Noise modules: the
 * transmissions, the Propositions each carries and the owning Channel arrive as
 * explicit parameters, so the producers (tasks 7.2 / 6.2 / 6.3) can run
 * concurrently or later without a dependency here.
 *
 * **Intercept fidelity (Property 9).** For any generated Intercept, resolving
 * its true `spec`, {@link decrypt}ing the ciphertext and {@link parseFieldMessage}
 * -ing the result yields exactly its source Propositions. The tests next to this
 * file check that round-trip directly.
 */

import {
  revealTruth,
  type ChannelId,
  type DocId,
  type GameTime,
  type InterceptId,
  type Proposition,
  type Truth,
  asTruth,
} from '../model/core.js';
import { type Prng } from '../prng/prng.js';
import {
  isInterceptableKind,
  type Channel,
  type CommsOwner,
} from '../city/comms.js';
import type { CipherConventions } from '@tradecraft/content';
import { encrypt, decrypt, type CipherKey, type CipherKind } from './cipher.js';
import { encodePropositions, type FieldCodeSource } from './field-message.js';
import {
  resolveCipherSpec,
  BOOK_SCHEMES,
  type BookScheme,
  type CipherKeyLookup,
  type CipherSpec,
} from './spec.js';

// ---------------------------------------------------------------------------
// Owner category and cipher weighting
// ---------------------------------------------------------------------------

/**
 * Which organisation's tradecraft a transmission reflects, for cipher-kind
 * weighting. A {@link Channel}'s `owner` is a raw {@link CommsOwner} (an org or
 * NPC id) and does not by itself say whether the owner is the Hostile Service,
 * the Cell, the Station or a noise source — that mapping lives in the orgs the
 * generator built (tasks 5.2 / 6.x), which this leaf module deliberately does
 * not import. The caller therefore tags each transmission with its owner
 * *category*, and the weighting reads only the category.
 *
 * - `hostile` — the Hostile Service's resident (strongest tradecraft).
 * - `cell` — the Plot's Cell (strong, numbers-forward).
 * - `station` — the player's own Station (its link to HQ).
 * - `noise` — any Plot-unrelated owner (diplomatic, criminal, routine). Noise
 *   favours the simpler ciphers so the player can triage it (design, "Cipher
 *   Engine": diplomatic strong, criminal weak — modelled here as the single
 *   `noise` bucket leaning simple).
 */
export const INTERCEPT_OWNER_KINDS = [
  'hostile',
  'cell',
  'station',
  'noise',
] as const;

/** The owner category of a transmission, for cipher weighting. */
export type InterceptOwnerKind = (typeof INTERCEPT_OWNER_KINDS)[number];

/**
 * A weight table over the five cipher kinds. A kind with weight `0` is never
 * drawn for this owner; a larger weight is proportionally more likely. The
 * generator intersects the table with the preset's `allowedCiphers` before
 * drawing, so a preset that forbids a kind overrides any weight here.
 */
export type CipherWeights = Readonly<Record<CipherKind, number>>;

/**
 * The per-owner cipher-kind weighting (design, "Cipher Engine"). Hostile and
 * Cell traffic favours the strong ciphers — book and one-time pad, with some
 * Vigenère — matching a disciplined service; Station traffic favours Vigenère
 * (its routine HQ link); noise favours the simple hand ciphers (Caesar,
 * Vigenère, columnar) so a player can triage it quickly, with only a small
 * chance of a stronger key.
 *
 * These are weights, not probabilities: they need not sum to anything in
 * particular, and the generator normalises over whichever kinds the preset
 * allows.
 */
export const OWNER_CIPHER_WEIGHTS: Readonly<
  Record<InterceptOwnerKind, CipherWeights>
> = {
  hostile: { caesar: 0, vigenere: 2, columnar: 1, book: 3, otp: 4 },
  cell: { caesar: 0, vigenere: 2, columnar: 2, book: 3, otp: 3 },
  station: { caesar: 1, vigenere: 4, columnar: 2, book: 1, otp: 1 },
  noise: { caesar: 3, vigenere: 3, columnar: 2, book: 1, otp: 1 },
} as const;

/**
 * The fixed order the cipher kinds are considered in. Draw order is part of the
 * determinism contract, so a stable, declared order (not `Object.keys`) is used
 * everywhere a kind set is built.
 */
export const CIPHER_WEIGHT_ORDER: readonly CipherKind[] = [
  'caesar',
  'vigenere',
  'columnar',
  'book',
  'otp',
] as const;

/**
 * The era owner kinds an {@link InterceptOwnerKind} maps onto when the Era
 * Pack's {@link CipherConventions} supply the weights (Requirement 5.6). The
 * era weights its owners `hostile | diplomatic | commercial | criminal |
 * station`; the engine's intercept owner categories are the coarser `hostile |
 * cell | station | noise`. The mapping keeps the slice's tradecraft intent:
 *
 * - `hostile` → the era `hostile` weights (the Hostile Service's resident).
 * - `cell` → the era `hostile` weights too: the Plot's Cell runs the same
 *   disciplined, numbers-forward tradecraft as the service it answers to, so
 *   it draws from the same table.
 * - `station` → the era `station` weights (the player's own HQ link).
 * - `noise` → a blend of the era `commercial` and `criminal` weights: the
 *   single engine noise bucket stands in for routine, non-plot traffic, which
 *   the design models as commercial and criminal owners leaning on the simpler
 *   hand ciphers. The two tables are summed per kind (see
 *   {@link conventionWeightsFor}).
 *
 * Diplomatic traffic has no engine owner category of its own (the engine never
 * tags a transmission `diplomatic`); its era weights are therefore unused by
 * the mapping, which is deliberate — the engine only ever asks for the four
 * {@link InterceptOwnerKind}s above.
 */
const INTERCEPT_OWNER_TO_ERA: Readonly<
  Record<InterceptOwnerKind, readonly ('hostile' | 'diplomatic' | 'commercial' | 'criminal' | 'station')[]>
> = {
  hostile: ['hostile'],
  cell: ['hostile'],
  station: ['station'],
  noise: ['commercial', 'criminal'],
} as const;

/**
 * The effective {@link CipherWeights} for an owner: the Era Pack's
 * {@link CipherConventions} weights when `conventions` is supplied (Requirement
 * 5.6), otherwise the engine's built-in {@link OWNER_CIPHER_WEIGHTS} defaults
 * (the Core City / slice path, where no Era Pack is loaded).
 *
 * When drawing from conventions, the engine owner is mapped onto one or more
 * era owners by {@link INTERCEPT_OWNER_TO_ERA} and their partial weight tables
 * are summed per cipher kind (a kind absent from a partial table counts as 0).
 * The result is a full table over {@link CIPHER_WEIGHT_ORDER} so the rest of
 * the drawing code is unchanged.
 */
export function conventionWeightsFor(
  owner: InterceptOwnerKind,
  conventions?: CipherConventions,
): CipherWeights {
  if (conventions === undefined) {
    return OWNER_CIPHER_WEIGHTS[owner];
  }
  const eraOwners = INTERCEPT_OWNER_TO_ERA[owner];
  const summed = {} as Record<CipherKind, number>;
  for (const k of CIPHER_WEIGHT_ORDER) {
    let total = 0;
    for (const eraOwner of eraOwners) {
      total += conventions.ownerWeights[eraOwner][k] ?? 0;
    }
    summed[k] = total;
  }
  return summed;
}

/**
 * The cipher kinds an owner may draw given the preset's allowed set: the kinds
 * with a positive owner weight that the preset also allows, in the fixed
 * {@link CIPHER_WEIGHT_ORDER}. If the intersection is empty (a preset that
 * allows only kinds the owner never uses), it falls back to the preset's
 * allowed kinds so generation never fails for want of a cipher.
 *
 * The owner weights come from the Era Pack's {@link CipherConventions} when
 * `conventions` is supplied (Requirement 5.6), otherwise from the built-in
 * {@link OWNER_CIPHER_WEIGHTS} defaults.
 */
export function weightedCipherKinds(
  owner: InterceptOwnerKind,
  allowed: readonly CipherKind[],
  conventions?: CipherConventions,
): readonly CipherKind[] {
  const weights = conventionWeightsFor(owner, conventions);
  const allow = new Set<CipherKind>(allowed);
  const kinds = CIPHER_WEIGHT_ORDER.filter(
    (k) => allow.has(k) && weights[k] > 0,
  );
  if (kinds.length > 0) {
    return kinds;
  }
  // No owner-favoured kind is allowed; fall back to the allowed set so a draw
  // is always possible. Keep the fixed order for determinism.
  return CIPHER_WEIGHT_ORDER.filter((k) => allow.has(k));
}

/**
 * Draw one cipher kind for an owner from a pre-computed, non-empty candidate
 * list, weighted by the owner's effective weights — the Era Pack's
 * {@link CipherConventions} when supplied, otherwise {@link OWNER_CIPHER_WEIGHTS}
 * (see {@link conventionWeightsFor}). Deterministic: one `prng.next()` draw
 * mapped onto the cumulative weights over `kinds`. A kind with no owner weight
 * (a fallback-set member) counts as weight 1 so the draw stays well defined.
 */
function drawCipherKind(
  prng: Prng,
  owner: InterceptOwnerKind,
  kinds: readonly CipherKind[],
  conventions?: CipherConventions,
): CipherKind {
  if (kinds.length === 0) {
    throw new Error(
      'generateIntercepts(): the preset allows no cipher kinds; ' +
        'check difficultyPreset.allowedCiphers',
    );
  }
  const weights = conventionWeightsFor(owner, conventions);
  // When the owner-favoured intersection was empty, weightedCipherKinds fell
  // back to the allowed set; treat those as weight 1 so the draw is uniform.
  const effective = kinds.map((k) => (weights[k] > 0 ? weights[k] : 1));
  const total = effective.reduce((a, b) => a + b, 0);
  let roll = prng.next() * total;
  for (let i = 0; i < kinds.length; i += 1) {
    roll -= effective[i];
    if (roll < 0) {
      return kinds[i];
    }
  }
  // Floating-point slack: fall back to the last kind.
  return kinds[kinds.length - 1];
}

// ---------------------------------------------------------------------------
// Tradecraft errors (Req 9.4)
// ---------------------------------------------------------------------------

/**
 * The crib a `fixed-header` tradecraft error stamps on an Intercept: a
 * stereotyped opening repeated across messages, which hands the player a
 * known-plaintext wedge (design, "Cipher Engine": a fixed header such as `NR`
 * plus a date group).
 */
export const FIXED_HEADER_CRIB = 'NR';

/**
 * The crib a `fixed-header` tradecraft error stamps on an Intercept, drawn from
 * the Era Pack's {@link CipherConventions} `headers` list when one is loaded
 * (Requirement 5.6), otherwise the built-in {@link FIXED_HEADER_CRIB} default
 * (the Core City / slice path). The draw is one `prng.pick` over the id-stable
 * header list so it stays deterministic and in the fixed per-Intercept draw
 * order; a convention with an empty `headers` list (which the schema forbids)
 * falls back to the default.
 */
function drawFixedHeader(prng: Prng, conventions?: CipherConventions): string {
  const headers = conventions?.headers;
  if (headers === undefined || headers.length === 0) {
    return FIXED_HEADER_CRIB;
  }
  return prng.pick(headers);
}

/**
 * An operator mistake the player can exploit (Requirement 9.4), modelled
 * explicitly on an Intercept so later tasks and the workbench can surface it.
 *
 * - `pad-reuse` — this Intercept's one-time pad was reused on the Intercept
 *   named by `with`. XORing the two ciphertexts cancels the shared pad, the
 *   classic two-time-pad break. Only ever attached to an `otp` Intercept.
 * - `fixed-header` — the message opens with a stereotyped `header` crib, the
 *   same across every Intercept carrying this error, so a known-plaintext
 *   attack has a foothold.
 */
export type TradecraftError =
  | { readonly kind: 'pad-reuse'; readonly with: InterceptId }
  | { readonly kind: 'fixed-header'; readonly header: string };

// ---------------------------------------------------------------------------
// Traffic metadata
// ---------------------------------------------------------------------------

/**
 * The traffic metadata carried on an Intercept — what the player reads off the
 * capture before any decryption (design `Intercept.meta`, Requirement 25.3):
 * the ciphertext `length`, the optional stereotyped `header` crib (present only
 * when a `fixed-header` tradecraft error applies) and an optional `callsign`
 * derived from the owning Channel.
 */
export interface InterceptMeta {
  /** The ciphertext length (the first thing a frequency table reads). */
  readonly length: number;
  /** A stereotyped header crib, present only on a `fixed-header` error. */
  readonly header?: string;
  /** A call sign derived from the Channel, shown as traffic metadata. */
  readonly callsign?: string;
}

// ---------------------------------------------------------------------------
// Intercept
// ---------------------------------------------------------------------------

/**
 * The ciphertext the player captures off a Channel (the design's `Intercept`).
 * It carries its traffic metadata (which Channel, when, direction, the owning
 * org and a call sign/header), the ciphertext itself, and — fenced behind
 * {@link Truth} — the ground-truth `spec` that enciphered it, the source
 * Proposition ids, and the trace origin. The player must deduce the spec from
 * the metadata, the frequency table and any tradecraft error; the Sim verifies
 * their submission (task 8.4).
 *
 * Replaces the task-4.6 skeleton `Intercept` in `../model/state.ts` under the
 * same name, so `WorldState.intercepts` is a `Record<InterceptId, Intercept>`
 * of these.
 *
 * The truth-bearing fields (`spec`, `plaintextProps`, `origin`) are
 * {@link Truth}-branded: they are the secret the player works to recover, and
 * must never cross into a Player View projection (Requirement 2.1). The
 * metadata, ciphertext and any `tradecraftError` are unbranded — they are
 * exactly what the player sees in the workbench.
 */
export interface Intercept {
  readonly id: InterceptId;
  /** When the transmission fired (its Channel schedule time). */
  readonly at: GameTime;
  /** The Channel it was captured on. */
  readonly channel: ChannelId;
  /** The organisation that sent it (the Channel's owner). */
  readonly owner: CommsOwner;
  /** Direction of travel relative to the owner. */
  readonly direction: 'outbound' | 'inbound';
  /** Traffic metadata read before decryption. */
  readonly meta: InterceptMeta;
  /** The enciphered field message. */
  readonly ciphertext: string;
  /** The cipher spec that enciphered it (ground truth the player must deduce). */
  readonly spec: Truth<CipherSpec>;
  /** The ids of the source Propositions, in message order (ground truth). */
  readonly plaintextProps: Truth<readonly string[]>;
  /** Why this traffic exists (ground truth: plot, side thread or noise). */
  readonly origin: Truth<InterceptOriginKind>;
  /** An operator mistake the player can exploit, when one was injected (Req 9.4). */
  readonly tradecraftError?: TradecraftError;
  /**
   * Whether the player has broken this traffic. A successful `decrypt` sets it,
   * and a repeat `decrypt` on a broken Intercept leaves the Case File unchanged
   * (slice-integration Req 8.6). Absent until the traffic is broken.
   */
  readonly broken?: boolean;
}

/**
 * Why an Intercept's traffic exists — the trace origin, as a bare tag. Mirrors
 * the design's `Intercept.origin` (`'plot' | 'side-thread' | 'noise' |
 * 'deception'`); the three producers this task consumes map to `plot`,
 * `side-thread` and `noise`.
 */
export const INTERCEPT_ORIGINS = [
  'plot',
  'side-thread',
  'noise',
  'deception',
] as const;

/** The origin tag of an Intercept. */
export type InterceptOriginKind = (typeof INTERCEPT_ORIGINS)[number];

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * One transmission to encode into an Intercept — the source traffic the
 * generator consumes. The producers (Plot Stage traces, Side Threads, Noise
 * Traffic) raise these; the generator consumes them without knowing which
 * producer made which, so they arrive fully described. (Named `InterceptSource`
 * rather than `Transmission`: the design's `WorldState.transmissions`
 * `Transmission` is a separate, broader record owned by task 8, which this task
 * deliberately does not touch.)
 *
 * - `id` — a stable id for the transmission, used to mint the Intercept id and
 *   to sort the inputs deterministically.
 * - `channel` — the id of the interceptable Channel it fired on.
 * - `at` — the firing time (from the Channel schedule).
 * - `ownerKind` — the owner *category* for cipher weighting (see
 *   {@link InterceptOwnerKind}); the raw owner id comes from the Channel.
 * - `origin` — why the traffic exists (`plot` / `side-thread` / `noise`).
 * - `propositions` — the Propositions the message carries, with their original
 *   ids, which the generator records as the Intercept's `plaintextProps`.
 * - `direction` — optional direction of travel; defaults to `outbound`.
 */
export interface InterceptSource {
  readonly id: string;
  readonly channel: ChannelId;
  readonly at: GameTime;
  readonly ownerKind: InterceptOwnerKind;
  readonly origin: InterceptOriginKind;
  readonly propositions: readonly Proposition[];
  readonly direction?: 'outbound' | 'inbound';
}

/**
 * The inputs {@link generateIntercepts} needs beyond the transmissions and the
 * PRNG: the interceptable Channels keyed by id (so owner and kind are known),
 * the field-code lookup for {@link encodePropositions}, the preset's allowed
 * ciphers and tradecraft-error probability, and the pools of key material a
 * book or one-time-pad spec names (public-text ids and pad ids). The pools let
 * the generator mint a `CipherSpec` whose references the world can later
 * resolve; a {@link CipherKeyLookup} supplies the actual content so the
 * ciphertext can be produced here (and the round-trip checked).
 */
export interface GenerateInterceptsInputs {
  /** The Channels transmissions fire on, keyed by id. */
  readonly channels: Readonly<Record<ChannelId, Channel>>;
  /** The predicate registry (or its `fieldCodes` map) for encoding. */
  readonly fieldCodes: FieldCodeSource;
  /** The cipher kinds the preset allows (`difficultyPreset.allowedCiphers`). */
  readonly allowedCiphers: readonly CipherKind[];
  /**
   * The preset's tradecraft-error probability
   * (`difficultyPreset.tradecraftErrorProbability`). The chance each eligible
   * Intercept carries an operator mistake (Requirement 9.4).
   */
  readonly tradecraftErrorProbability: number;
  /**
   * Public-text document ids a book cipher may key to. The default scheme is
   * the slice's one (`page-line-word`). Empty means book ciphers are not drawn
   * even when allowed.
   */
  readonly publicTextIds: readonly DocId[];
  /** Pad ids a one-time pad may name. Empty means OTP is not drawn even when allowed. */
  readonly padIds: readonly string[];
  /** Supplies the content a drawn `book`/`otp` spec refers to, for encryption. */
  readonly keyLookup: CipherKeyLookup;
  /**
   * The Era Pack's cipher conventions, when an Era Pack is loaded
   * (content-expansion Requirement 5.6): the per-owner cipher-kind weights, the
   * message `headers` (a `fixed-header` tradecraft error draws its crib from
   * these), the pad format and the numbers-broadcast format. The generator
   * reads these in place of its built-in defaults — the owner weights replace
   * {@link OWNER_CIPHER_WEIGHTS} (mapped onto the era owner kinds by
   * {@link conventionWeightsFor}) and the fixed-header crib is drawn from
   * `headers` instead of the constant {@link FIXED_HEADER_CRIB}. The
   * `padFormat` and `numbersFormat` are carried for the Intercept presentation
   * the workbench and Preview CLI render.
   *
   * Absent on the Core City / slice path, where no Era Pack is loaded: the
   * generator then falls back to the built-in defaults, preserving slice
   * behaviour exactly.
   */
  readonly cipherConventions?: CipherConventions;
}

/** The result of {@link generateIntercepts}: the Intercepts keyed by id. */
export interface GeneratedIntercepts {
  /** Every Intercept keyed by id, as `WorldState.intercepts` holds them. */
  readonly intercepts: Readonly<Record<InterceptId, Intercept>>;
  /** The Intercept ids in generation order. */
  readonly order: readonly InterceptId[];
}

// ---------------------------------------------------------------------------
// Transmission (the design's WorldState.transmissions element)
// ---------------------------------------------------------------------------

/**
 * A sent transmission (the design's `Transmission`, the element of
 * `WorldState.transmissions`). It is the record of a signal that went on the
 * wire — a Plot Stage transmission trace, a Side Thread transmission trace, or a
 * Noise Traffic firing — paired with the ciphertext {@link Intercept} the Cipher
 * Engine minted for it (task 26.3; Requirements 9.1, 29.4). The world is seeded
 * with one Transmission per interceptable firing at generation; the intercept
 * action (Req 25.3) sweeps `WorldState.transmissions` and *delivers* a
 * transmission's Intercept into `WorldState.intercepts` when the player collects
 * it off a known Channel inside the retention window.
 *
 * Replaces the task-4.6 skeleton `Transmission` placeholder in
 * `../model/state.ts` under the same name, so `WorldState.transmissions` is a
 * `Transmission[]` of these.
 *
 * `WorldState.transmissions` is *what happened on the wire* (every firing, held
 * from generation); `WorldState.intercepts` is *what the player has captured*
 * (empty at generation, filled by the intercept action). The split is why a
 * transmission carries its own Intercept here: delivery copies the Intercept
 * across without re-running the Cipher Engine, so collection stays a pure,
 * deterministic sweep (Property 18 — delivered at most once; delivered if an
 * intercept action occurs within the retention window).
 */
export interface Transmission {
  /** A stable id for the firing (`<producer>:<local>`); also mints the Intercept id. */
  readonly id: string;
  /** When the transmission fired (its Channel schedule / stage deadline time). */
  readonly at: GameTime;
  /** The Channel it fired on. */
  readonly channel: ChannelId;
  /** The organisation or person that sent it (the Channel's owner). */
  readonly owner: CommsOwner;
  /** Why the traffic exists (ground truth: plot, side thread or noise). */
  readonly origin: Truth<InterceptOriginKind>;
  /** The ciphertext Intercept the Cipher Engine minted for this firing. */
  readonly intercept: Intercept;
}

/**
 * Pair the Intercepts from a {@link generateIntercepts} run back up with their
 * source transmissions into {@link Transmission} records, keyed by the Intercept
 * id {@link interceptIdOf} assigns a source. A source whose Intercept was
 * skipped (an absent/non-interceptable Channel, or no Propositions) yields no
 * Transmission. Pure; preserves the sources' order.
 */
export function buildTransmissions(
  sources: readonly InterceptSource[],
  generated: GeneratedIntercepts,
  channels: Readonly<Record<ChannelId, Channel>>,
): Transmission[] {
  const out: Transmission[] = [];
  for (const src of sources) {
    const id = interceptIdOf(src.id);
    const intercept = generated.intercepts[id];
    if (intercept === undefined) {
      continue;
    }
    const channel = channels[src.channel];
    out.push({
      id: src.id,
      at: src.at,
      channel: src.channel,
      owner: channel?.owner ?? intercept.owner,
      origin: asTruth(src.origin),
      intercept,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Id minting
// ---------------------------------------------------------------------------

/**
 * Mint an Intercept id in the `int:` namespace from a transmission id. This is
 * the exact id {@link generateIntercepts} assigns an Intercept, so a producer
 * that knows a transmission's id (a Plot Stage trace, a Side Thread trace, a
 * Noise Traffic firing) can compute the id of the Intercept it will mint
 * *before* generation runs — which is how a `transmission` SimEvent's
 * `intercept` field (task 26.2) references the real minted Intercept (task
 * 26.3). Pure and deterministic; the slug normalisation matches the one the
 * generator used so the two always agree.
 */
export function interceptIdOf(transmissionId: string): InterceptId {
  const slug = transmissionId
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `int:${slug.length > 0 ? slug : 'tx'}` as InterceptId;
}

/** A short call sign derived from a Channel id, for traffic metadata. */
function callsignOf(channel: Channel): string {
  const local = channel.id.slice(channel.id.indexOf(':') + 1);
  // Keep the leading alphanumerics, upper-cased, as a terse station sign.
  const sign = local.replace(/[^A-Za-z0-9]+/g, '').toUpperCase().slice(0, 4);
  return sign.length > 0 ? sign : 'STN';
}

// ---------------------------------------------------------------------------
// Spec drawing
// ---------------------------------------------------------------------------

/**
 * Draw a {@link CipherSpec} of the given kind on the stream. Caesar shifts land
 * in `[1, 25]` (0 is the identity), Vigenère/columnar take a short drawn
 * keyword, book names a drawn public text and OTP a drawn pad. Book and OTP
 * require a non-empty pool; the caller only draws those kinds when the pool is
 * non-empty (see {@link usableKinds}).
 */
function drawSpec(
  prng: Prng,
  kind: CipherKind,
  inputs: GenerateInterceptsInputs,
): CipherSpec {
  switch (kind) {
    case 'caesar':
      return { kind: 'caesar', shift: prng.int(1, 25) };
    case 'vigenere':
      return { kind: 'vigenere', key: drawKeyword(prng) };
    case 'columnar':
      return { kind: 'columnar', key: drawKeyword(prng) };
    case 'book': {
      const textId = prng.pick([...inputs.publicTextIds].sort());
      const scheme: BookScheme = BOOK_SCHEMES[0];
      return { kind: 'book', textId, scheme };
    }
    case 'otp': {
      const padId = prng.pick([...inputs.padIds].sort());
      return { kind: 'otp', padId };
    }
  }
}

/** A short pronounceable keyword for Vigenère/columnar keys. */
function drawKeyword(prng: Prng): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const length = prng.int(4, 7);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += letters[prng.int(0, 25)];
  }
  return out;
}

/**
 * The kinds that are actually usable given the inputs: a `book` needs a public
 * text and an `otp` needs a pad, so those drop out when their pool is empty.
 * The substitution/transposition kinds are always usable.
 */
function usableKinds(
  kinds: readonly CipherKind[],
  inputs: GenerateInterceptsInputs,
): readonly CipherKind[] {
  return kinds.filter((k) => {
    if (k === 'book') {
      return inputs.publicTextIds.length > 0;
    }
    if (k === 'otp') {
      return inputs.padIds.length > 0;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// generateIntercepts
// ---------------------------------------------------------------------------

/**
 * Generate Intercepts from a list of transmissions (design, "Cipher Engine";
 * Requirements 9.1, 9.4, 29.4).
 *
 * For each transmission on an interceptable Channel, in id-sorted order, this:
 *
 * 1. encodes its Propositions to a field message with {@link encodePropositions};
 * 2. draws a cipher kind weighted by the transmission's owner category — from
 *    the loaded Era Pack's {@link CipherConventions} when `inputs` supplies them
 *    (Requirement 5.6), otherwise the built-in {@link OWNER_CIPHER_WEIGHTS}
 *    defaults — restricted to the preset's allowed and key-material-backed
 *    kinds, and draws a matching {@link CipherSpec};
 * 3. at the preset's `tradecraftErrorProbability`, injects a tradecraft error —
 *    `pad-reuse` when this and a prior OTP Intercept can share a pad, otherwise
 *    a `fixed-header` crib drawn from the Era Pack's `headers` (or the default
 *    {@link FIXED_HEADER_CRIB} on the slice path); the field message is prefixed
 *    with the crib before encryption so the known plaintext is really present;
 * 4. {@link encrypt}s the (possibly crib-prefixed) field message under the
 *    resolved key into the Intercept's ciphertext.
 *
 * A transmission whose Channel is absent from `channels`, is not an
 * interceptable kind, or carries no Propositions is skipped — such traffic has
 * no Intercept. The function is pure and draws every choice from `prng` in the
 * fixed order described above, so the result is a deterministic function of the
 * seed and the inputs.
 */
export function generateIntercepts(
  prng: Prng,
  transmissions: readonly InterceptSource[],
  inputs: GenerateInterceptsInputs,
): GeneratedIntercepts {
  const intercepts: Record<InterceptId, Intercept> = {};
  const order: InterceptId[] = [];

  // Deterministic order: by transmission id, then firing time as a tie-break.
  const sorted = [...transmissions].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  // Track OTP intercepts available to reuse a pad with, keyed by pad id, so a
  // `pad-reuse` error can link to a concrete prior Intercept sharing the pad.
  const otpByPad = new Map<string, { id: InterceptId; spec: CipherSpec }>();

  for (const tx of sorted) {
    const channel = inputs.channels[tx.channel];
    if (channel === undefined) {
      continue;
    }
    if (!isInterceptableKind(channel.kind)) {
      continue;
    }
    if (tx.propositions.length === 0) {
      continue;
    }

    const id = interceptIdOf(tx.id);
    const fieldMessage = encodePropositions(tx.propositions, inputs.fieldCodes);

    // --- cipher kind + spec ------------------------------------------------
    const kinds = usableKinds(
      weightedCipherKinds(
        tx.ownerKind,
        inputs.allowedCiphers,
        inputs.cipherConventions,
      ),
      inputs,
    );
    if (kinds.length === 0) {
      throw new Error(
        `generateIntercepts(): no usable cipher kind for owner "${tx.ownerKind}"; ` +
          'check allowedCiphers and the book/pad pools',
      );
    }
    const kind = drawCipherKind(
      prng,
      tx.ownerKind,
      kinds,
      inputs.cipherConventions,
    );
    let spec = drawSpec(prng, kind, inputs);

    // --- tradecraft error roll (Req 9.4) ----------------------------------
    // One roll per eligible Intercept against the preset probability.
    const injectError = prng.bool(clampProbability(inputs.tradecraftErrorProbability));
    let tradecraftError: TradecraftError | undefined;
    let plaintext = fieldMessage;
    let header: string | undefined;

    if (injectError) {
      if (spec.kind === 'otp') {
        // Prefer pad reuse: link to a prior OTP intercept, sharing its pad so
        // the two-time-pad break is real.
        const prior = otpByPad.get(spec.padId);
        if (prior !== undefined) {
          spec = { kind: 'otp', padId: spec.padId, reusedWith: prior.id };
          tradecraftError = { kind: 'pad-reuse', with: prior.id };
        } else {
          // No prior pad to reuse yet: fall back to a fixed-header crib.
          header = drawFixedHeader(prng, inputs.cipherConventions);
          plaintext = withHeader(fieldMessage, header);
          tradecraftError = { kind: 'fixed-header', header };
        }
      } else {
        header = drawFixedHeader(prng, inputs.cipherConventions);
        plaintext = withHeader(fieldMessage, header);
        tradecraftError = { kind: 'fixed-header', header };
      }
    }

    // --- encrypt -----------------------------------------------------------
    const key = resolveCipherSpec(spec, inputs.keyLookup);
    const ciphertext = encrypt(plaintext, key);

    const meta: InterceptMeta = {
      length: ciphertext.length,
      ...(header !== undefined ? { header } : {}),
      callsign: callsignOf(channel),
    };

    const intercept: Intercept = {
      id,
      at: tx.at,
      channel: tx.channel,
      owner: channel.owner,
      direction: tx.direction ?? 'outbound',
      meta,
      ciphertext,
      spec: asTruth(spec),
      plaintextProps: asTruth(tx.propositions.map((p) => p.id)),
      origin: asTruth(tx.origin),
      ...(tradecraftError !== undefined ? { tradecraftError } : {}),
    };

    intercepts[id] = intercept;
    order.push(id);

    // Record this OTP intercept so a later one can reuse its pad. Only record
    // the first user of each pad, so `reusedWith` always points at the origin.
    if (spec.kind === 'otp' && !otpByPad.has(spec.padId)) {
      otpByPad.set(spec.padId, { id, spec });
    }
  }

  return { intercepts, order };
}

/** Prefix a field message with a stereotyped header crib on its own line. */
function withHeader(fieldMessage: string, header: string): string {
  return `${header}\n${fieldMessage}`;
}

/** Clamp a probability into `[0, 1]`; non-finite collapses to 0 (no error). */
function clampProbability(p: number): number {
  if (!Number.isFinite(p)) {
    return 0;
  }
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** The ground-truth cipher spec of an Intercept, revealed for the Sim or tests. */
export function revealedSpec(intercept: Intercept): CipherSpec {
  return revealTruth(intercept.spec);
}

/**
 * Decrypt an Intercept with its true spec and recover its source field message,
 * stripping the stereotyped header crib if a `fixed-header` tradecraft error
 * prefixed one. This is the inverse of what {@link generateIntercepts} enciphers,
 * and Property 9 (intercept fidelity) is stated against it: feeding the result
 * to {@link parseFieldMessage} yields exactly the Intercept's source
 * Propositions (with ids reconstructed as `fm:<line>` — the originals live in
 * `plaintextProps`).
 *
 * The `key` is the resolved {@link CipherKey} for the Intercept's spec; callers
 * resolve it via {@link resolveCipherSpec} against the same key material the
 * generator used.
 */
export function decryptToFieldMessage(
  intercept: Intercept,
  key: CipherKey,
): string {
  const plain = decrypt(intercept.ciphertext, key);
  const err = intercept.tradecraftError;
  if (err !== undefined && err.kind === 'fixed-header') {
    return stripHeader(plain, err.header);
  }
  return plain;
}

/** Remove a leading `<header>\n` crib line added at generation time. */
function stripHeader(plain: string, header: string): string {
  const prefix = `${header}\n`;
  return plain.startsWith(prefix) ? plain.slice(prefix.length) : plain;
}
