import type { RegistryMetadata } from '../packument';
import { type PickOutcome } from '../pick';
import type { MinReleaseAgePolicy, MinReleaseAgePolicyReadResult } from '../policy';
/**
 * Reads pnpm's effective cooldown configuration once by asking pnpm itself
 * (`pnpm config list --json`) instead of re-implementing how it layers config
 * surfaces (a moving target across pnpm versions). The window and excludes come
 * straight from pnpm; the strict default, exclude grammar, and loose-fallback
 * semantics stay version-keyed because pnpm does not report those resolved
 * values.
 */
export declare function readPnpmPolicy(root: string, pmVersion: string): Promise<MinReleaseAgePolicyReadResult>;
/**
 * pnpm resolution under an active cooldown. Exact pins and ranges mirror pnpm's
 * resolver; dist-tag degrade uses the shared cross-PM rule:
 * - exact pin too new -> strict/v10 violation; v11 loose installs it (immature).
 * - range -> newest mature; none -> v10/strict violation, v11 loose lowest
 *   (least-immature) version unfiltered (immature).
 * - dist-tag too new -> degrade via the shared channel-aware rule (see
 *   `degradeTagToCompliant` for the ordering); none compliant -> violation
 *   (v11 loose installs the original target immature).
 */
export declare function pickPnpmVersion(spec: string, metadata: RegistryMetadata, policy: MinReleaseAgePolicy): PickOutcome;
