/**
 * Verifying a player's decryption attempt against an Intercept's ground truth
 * (task 8.4; Requirement 9.5).
 *
 * The player works an Intercept in the cipher workbench by submitting a
 * candidate decryption — either a {@link KeySubmission} naming a worked-out key
 * (a guessed {@link CipherSpec}), or a plaintext they believe is the message.
 * The Sim must decide whether that submission is *correct* and, when it is,
 * yield the recovered Propositions into the player's Case File as Claims sourced
 * `intercept` (Requirement 9.5). A wrong submission is rejected and leaks
 * nothing: no spec, no plaintext, no hint beyond what the player already holds
 * (the ciphertext, the traffic metadata and any tradecraft error).
 *
 * ## Where this lives, and why
 *
 * Verification reads the Intercept's {@link Truth}-branded ground truth — the
 * true `spec` (via {@link revealedSpec}) and, through it, the true recovered
 * field message. That is a Sim operation, so it lives in the engine beside the
 * other cipher modules. Only its *result* — the recovered Propositions, or a
 * bare rejection — ever crosses into the Player View; the Case File integration
 * (task 8.4, player-view side) consumes that result and never touches Truth.
 * This preserves the truth boundary (Requirement 2.1): the Player View never
 * sees the Intercept's spec or plaintext, only the Propositions a *correct*
 * submission has already unlocked.
 *
 * ## What "correct" means
 *
 * The true recovered field message is `decryptToFieldMessage(intercept, trueKey)`
 * where `trueKey = resolveCipherSpec(revealedSpec(intercept), keyLookup)` — the
 * same inverse the fidelity property (Property 9) is stated against, with any
 * fixed-header crib already stripped. A submission is accepted when it
 * reproduces that message:
 *
 * - a **key** submission is resolved to a {@link CipherKey} via
 *   {@link resolveCipherSpec} and used to decrypt the ciphertext (stripping the
 *   crib exactly as the true decryption does); it is correct when the result
 *   equals the true recovered field message. This accepts *any* key that
 *   actually decrypts the Intercept to the right plaintext, not only the one
 *   true spec — a different spec that happens to decrypt identically is, for the
 *   player, just as good a break. A key that fails to resolve (an unknown book
 *   text or pad) or throws while decrypting is simply a wrong submission, never
 *   an exception out of verification.
 * - a **plaintext** submission is correct when the submitted text equals the
 *   true recovered field message.
 *
 * On acceptance the recovered Propositions are the true message parsed with
 * {@link parseFieldMessage}. Because a field message does not carry the
 * Sim-internal Proposition id (parse rebuilds ids as `fm:<line>`), the recovered
 * Propositions are re-tagged with the Intercept's true source ids from
 * `plaintextProps`, by message position, so the Case File records them under the
 * ids the rest of the Sim knows them by. (The source ids are themselves ground
 * truth; they are released only on a correct break, together with the content.)
 *
 * The function is pure and deterministic and draws nothing.
 */

import { revealTruth, type Proposition } from '../model/core.js';
import { decrypt, type CipherKey } from './cipher.js';
import {
  parseFieldMessage,
  type FieldCodeSource,
} from './field-message.js';
import {
  resolveCipherSpec,
  type CipherKeyLookup,
  type KeySubmission,
} from './spec.js';
import {
  decryptToFieldMessage,
  revealedSpec,
  type Intercept,
} from './intercept.js';

/**
 * The outcome of {@link verifySubmission}.
 *
 * - `{ ok: true; propositions }` — the submission decrypted the Intercept; the
 *   recovered Propositions (re-tagged with the Intercept's true source ids) are
 *   ready to be added to the Case File as `intercept` Claims.
 * - `{ ok: false }` — the submission was wrong. It carries nothing else: no
 *   spec, no plaintext, no partial decryption, so a rejection leaks no
 *   information about the answer (Requirement 9.5).
 */
export type VerifyResult =
  | { readonly ok: true; readonly propositions: Proposition[] }
  | { readonly ok: false };

/** The shared, information-free rejection. */
const REJECTED: VerifyResult = { ok: false };

/**
 * Verify a player's {@link KeySubmission} against an Intercept's ground truth
 * (Requirement 9.5).
 *
 * Returns the recovered Propositions on a correct key or plaintext, or a bare
 * `{ ok: false }` on anything else. Reading the Intercept's true spec makes this
 * a Sim operation; only the returned result is fit to cross into the Player
 * View. Pure and deterministic.
 *
 * @param intercept the Intercept the player is working.
 * @param submission the player's candidate key or plaintext.
 * @param keyLookup supplies book-text / pad content for resolving a spec (both
 *   the Intercept's true spec and a key submission's guessed spec).
 * @param fieldCodes the predicate registry (or its `fieldCodes` map) used to
 *   parse the recovered field message back into Propositions.
 */
export function verifySubmission(
  intercept: Intercept,
  submission: KeySubmission,
  keyLookup: CipherKeyLookup,
  fieldCodes: FieldCodeSource,
): VerifyResult {
  // The ground-truth recovered field message: decrypt with the true key and
  // strip any fixed-header crib. Resolving the true spec is safe here (this is
  // the Sim); if the world cannot resolve its own Intercept's key material that
  // is a generation/save bug, so let it throw rather than masking it.
  const trueKey = resolveCipherSpec(revealedSpec(intercept), keyLookup);
  const truePlain = decryptToFieldMessage(intercept, trueKey);

  if (!submissionMatches(intercept, submission, keyLookup, truePlain)) {
    return REJECTED;
  }

  // Correct break: the note on the wire is words. The facts come from the
  // private field message, never from reading the English back as truth.
  // Intercepts minted before that split still carry the field message as the
  // plaintext, so those parse the decrypted text.
  const machine = intercept.encoded === undefined ? truePlain : revealTruth(intercept.encoded);
  const recovered = parseFieldMessage(machine, fieldCodes);
  const sourceIds = intercept.plaintextProps;
  const propositions = recovered.map((prop, i) =>
    i < sourceIds.length ? { ...prop, id: sourceIds[i] } : prop,
  );
  return { ok: true, propositions };
}

/**
 * Does the submission reproduce the true recovered field message? A key is
 * resolved and run against the ciphertext (crib stripped like the true
 * decryption); a plaintext is compared directly. A key that cannot be resolved
 * or throws while decrypting counts as a miss, never an exception.
 */
function submissionMatches(
  intercept: Intercept,
  submission: KeySubmission,
  keyLookup: CipherKeyLookup,
  truePlain: string,
): boolean {
  if (submission.kind === 'plaintext') {
    return submission.text === truePlain;
  }
  // A key submission: resolve the player's guessed spec and decrypt with it.
  let candidateKey: CipherKey;
  try {
    candidateKey = resolveCipherSpec(submission.spec, keyLookup);
  } catch {
    // The guessed key names a book text or pad the world cannot supply: wrong.
    return false;
  }
  let candidatePlain: string;
  try {
    candidatePlain = decryptWithKey(intercept, candidateKey);
  } catch {
    // A guessed key whose material is too short, or otherwise unusable, is a
    // wrong submission — not a crash.
    return false;
  }
  return candidatePlain === truePlain;
}

/**
 * Decrypt the Intercept's ciphertext with a candidate key, stripping any
 * fixed-header crib exactly as {@link decryptToFieldMessage} does for the true
 * key, so a correct candidate key compares equal to the true recovered message.
 */
function decryptWithKey(intercept: Intercept, key: CipherKey): string {
  const plain = decrypt(intercept.ciphertext, key);
  const err = intercept.tradecraftError;
  if (err !== undefined && err.kind === 'fixed-header') {
    const prefix = `${err.header}\n`;
    return plain.startsWith(prefix) ? plain.slice(prefix.length) : plain;
  }
  return plain;
}
