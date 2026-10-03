/**
 * Retry and fallback policy (Requirement 16.2; design "LLM Gateway").
 *
 * Req 16.2: "IF a call exceeds its timeout THEN the LLM Gateway SHALL retry
 * once and then fall back to the `fast` role." This module is that policy,
 * expressed over an abstract attempt so it is independent of the transport: an
 * {@link AttemptFn} takes the Role to run under and returns the call's result.
 *
 * The sequence for a role is: run once; on failure (a timeout or any error),
 * retry once under the same role; if that also fails, fall back by running the
 * attempt under the `fast` role. The one exception is the `narrator` role,
 * which does **not** fall back — a narration failure surfaces to the narrator
 * layer, which drops to fact-only (Req 16.5, handled there). For the narrator
 * the policy is just: run once, retry once, then give up.
 *
 * "Timeout" is not special-cased here: a call that exceeds its timeout is
 * surfaced by the caller as a rejection (see {@link withTimeout}), so this
 * policy treats a timeout exactly like any other failure, which is what Req
 * 16.2 prescribes.
 */

import type { Role } from '../../config/models-config.js';

/**
 * Run one attempt under the given Role. Implementations issue the actual model
 * call for that role (its model id, settings and timeout). The policy calls
 * this up to three times with possibly different roles.
 */
export type AttemptFn<T> = (role: Role) => Promise<T>;

/** The role every non-narrator call falls back to, per Req 16.2. */
export const FALLBACK_ROLE: Role = 'fast';

/** Options for {@link runWithRetryAndFallback}. */
export interface RetryPolicyOptions {
  /**
   * Called when the first attempt fails and the policy is about to retry under
   * the same role. For observability/tests; failures here are ignored.
   */
  readonly onRetry?: (role: Role, error: unknown) => void;
  /**
   * Called when both attempts under the role fail and the policy is about to
   * fall back to `fast`. Not called for the narrator, which never falls back.
   */
  readonly onFallback?: (fromRole: Role, error: unknown) => void;
}

/**
 * Apply the retry-once-then-fall-back-to-`fast` policy to an attempt.
 *
 * - For any role other than `narrator`: attempt under `role`; on failure retry
 *   once under `role`; on a second failure attempt once under `fast` and return
 *   its result (or throw its error). If `role` is already `fast`, the fallback
 *   is a third attempt under `fast`.
 * - For `narrator`: attempt under `narrator`, retry once under `narrator`, and
 *   if both fail throw the last error — no fallback. The narrator layer turns
 *   that into fact-only narration (Req 16.5).
 */
export async function runWithRetryAndFallback<T>(
  role: Role,
  attempt: AttemptFn<T>,
  options: RetryPolicyOptions = {},
): Promise<T> {
  try {
    return await attempt(role);
  } catch (firstError) {
    options.onRetry?.(role, firstError);
    try {
      return await attempt(role);
    } catch (retryError) {
      if (role === 'narrator') {
        // The Narrator does not fall back; the narrator layer goes fact-only.
        throw retryError;
      }
      options.onFallback?.(role, retryError);
      return attempt(FALLBACK_ROLE);
    }
  }
}
