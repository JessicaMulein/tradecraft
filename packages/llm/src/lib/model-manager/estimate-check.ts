/**
 * The Model Manager's memory-estimate check (Requirement 43.3; design "Model
 * Manager", step 3).
 *
 * Before any load, the preflight sizes the active profile's resident set at the
 * configured context length and refuses to load a profile that will not fit,
 * rather than letting macOS silently push layers off the GPU into a slow,
 * partially-resident load. This module is the pure comparison over a
 * {@link ResidentSetEstimate} the client already produced (via
 * `LmStudioClient.estimateResidentSet`, which does the SDK's estimate-only
 * sizing and loads nothing).
 *
 * Like the download check, "won't fit" is a *result*, not a thrown error, and
 * it never loads: it reports the shortfall (required, available, deficit) so the
 * preflight (task 25.2) can compose it with the other checks and report every
 * cause at once, the way config validation reports every issue (Requirement
 * 41.2). The fit verdict is the estimate's own `fits` — the SDK applies
 * guardrails the raw byte totals alone do not capture — so this check trusts it
 * and only computes the human-facing shortfall when it is false.
 */

import type { ResidentSetEstimate } from './client-interface.js';

/** How far over budget a resident set is: `requiredBytes - availableBytes`. */
export interface MemoryShortfall {
  /** Estimated memory the resident set needs, in bytes. */
  readonly requiredBytes: number;
  /** Memory available to make the set resident, in bytes. */
  readonly availableBytes: number;
  /** The overflow, `requiredBytes - availableBytes`, clamped at 0, in bytes. */
  readonly deficit: number;
}

/**
 * The outcome of the estimate check. `ok` is true only when the whole resident
 * set fits. Both branches carry the raw `requiredBytes`/`availableBytes` so the
 * preflight can surface the figures either way (they feed the design's
 * `PreflightResult.estimatedBytes`/`fitsBytes`). On a shortfall, `shortfall`
 * additionally carries the `deficit`.
 */
export type EstimateCheckResult =
  | {
      readonly ok: true;
      readonly requiredBytes: number;
      readonly availableBytes: number;
    }
  | {
      readonly ok: false;
      readonly requiredBytes: number;
      readonly availableBytes: number;
      readonly shortfall: MemoryShortfall;
    };

/**
 * Decide whether a resident set fits, from an estimate the client produced.
 *
 * Pure and side-effect free: it reads the estimate and returns a result. It
 * never loads — refusing to load is expressed as `ok: false` with the shortfall
 * attached. The verdict is the estimate's `fits`; when it is false the deficit
 * is the overflow of required over available, clamped at 0 so a guardrail-only
 * failure (one where the byte figures happen not to show a gap) still reports a
 * non-negative deficit.
 *
 * @param estimate the resident-set estimate from `estimateResidentSet`
 */
export function checkEstimate(
  estimate: ResidentSetEstimate,
): EstimateCheckResult {
  const { fits, requiredBytes, availableBytes } = estimate;
  if (fits) {
    return { ok: true, requiredBytes, availableBytes };
  }
  const deficit = Math.max(0, requiredBytes - availableBytes);
  return {
    ok: false,
    requiredBytes,
    availableBytes,
    shortfall: { requiredBytes, availableBytes, deficit },
  };
}

/** Render a byte count as a compact `GiB` figure for operator-facing messages. */
function formatGiB(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  return `${gib.toFixed(2)} GiB`;
}

/**
 * Render a failed estimate check as the one-line shortfall message the preflight
 * prints, naming required, available and the deficit. Returns the empty string
 * when the set fits.
 */
export function formatMemoryShortfall(result: EstimateCheckResult): string {
  if (result.ok) {
    return '';
  }
  const { requiredBytes, availableBytes, deficit } = result.shortfall;
  return (
    `the active profile needs ${formatGiB(requiredBytes)} but only ` +
    `${formatGiB(availableBytes)} is available ` +
    `(short by ${formatGiB(deficit)})`
  );
}
