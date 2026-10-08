/**
 * Era timeline (design, "Era timeline"; Requirements 17.2–17.4).
 *
 * A year belongs to one epoch. Tension for that year is drawn once from the
 * epoch range and kept on Campaign Truth, so a later posting in the same year
 * sees the same number and does not draw again. Allowed ciphers are the
 * overlap of the epoch and the difficulty preset; an empty overlap falls back
 * to the epoch's weakest cipher. Doctrine moves by the same tension shift the
 * officer modifiers already apply, and each end stays inside [0, 1].
 */

import type { DifficultyPreset } from '@tradecraft/content';
import type { Prng, Result } from '@tradecraft/engine';

import type { Epoch } from './content/schemas.js';
import type { CampaignTruth, DeepPartial } from './state.js';

/** Weaker ciphers come first. An empty overlap uses the earliest one allowed. */
const CIPHER_STRENGTH = ['caesar', 'columnar', 'vigenere', 'book', 'otp'] as const;

type CipherKind = (typeof CIPHER_STRENGTH)[number];

/** The epoch whose year span contains `year`, inclusive of both ends. */
export function epochAt(year: number, epochs: readonly Epoch[]): Result<Epoch, string> {
  const match = epochs.find((epoch) => year >= epoch.years[0] && year <= epoch.years[1]);
  if (match === undefined) {
    return { ok: false, error: `no epoch covers ${year}` };
  }
  return { ok: true, value: match };
}

/**
 * Tension for `year`. A year already stored in `tensionByYear` is returned as
 * stored and the PRNG is left alone. A new year is drawn inside the epoch
 * range and added to the map that belongs on Campaign Truth.
 */
export function tensionAt(
  year: number,
  epoch: Epoch,
  rng: Prng,
  tensionByYear: CampaignTruth['tensionByYear'] = {},
): { readonly tension: number; readonly tensionByYear: CampaignTruth['tensionByYear'] } {
  if (Object.hasOwn(tensionByYear, year)) {
    return { tension: tensionByYear[year] ?? epoch.tension[0], tensionByYear };
  }
  const [lo, hi] = epoch.tension;
  const drawn = lo + rng.next() * (hi - lo);
  const tension = Math.min(hi, Math.max(lo, drawn));
  return { tension, tensionByYear: { ...tensionByYear, [year]: tension } };
}

/**
 * Preset overrides for one posting year: the cipher intersection, or the
 * epoch's weakest cipher, and doctrine ranges shifted by tension.
 * `doctrineScale` defaults to the campaign config's 0.2.
 */
export function eraOverrides(
  epoch: Epoch,
  tension: number,
  preset: DifficultyPreset,
  doctrineScale = 0.2,
): DeepPartial<DifficultyPreset> {
  const allowed = new Set<string>(epoch.ciphers);
  const shared = preset.allowedCiphers.filter((cipher) => allowed.has(cipher));
  return {
    allowedCiphers: shared.length > 0 ? shared : [weakestCipher(epoch.ciphers)],
    doctrine: shiftDoctrine(preset.doctrine, tension, doctrineScale),
  };
}

/** Move every doctrine range by `(tension − 0.5) × doctrineScale`, then clamp. */
export function shiftDoctrine(
  doctrine: DifficultyPreset['doctrine'],
  tension: number,
  doctrineScale: number,
): DifficultyPreset['doctrine'] {
  const delta = (tension - 0.5) * doctrineScale;
  return {
    risk: shiftRange(doctrine.risk.min, doctrine.risk.max, delta),
    security: shiftRange(doctrine.security.min, doctrine.security.max, delta),
    deception: shiftRange(doctrine.deception.min, doctrine.deception.max, delta),
  };
}

function weakestCipher(ciphers: readonly string[]): CipherKind {
  let weakest: CipherKind = 'caesar';
  let rank: number = CIPHER_STRENGTH.length;
  for (const cipher of ciphers) {
    const next = CIPHER_STRENGTH.indexOf(cipher as CipherKind);
    if (next !== -1 && next < rank) {
      weakest = CIPHER_STRENGTH[next] ?? weakest;
      rank = next;
    }
  }
  return weakest;
}

function shiftRange(min: number, max: number, delta: number): { min: number; max: number } {
  const lo = clampUnit(min + delta);
  const hi = clampUnit(max + delta);
  return lo <= hi ? { min: lo, max: hi } : { min: hi, max: lo };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
