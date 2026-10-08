import type { RegistryMetadata } from '../packument';
import { type PickOutcome } from '../pick';
import type { MinReleaseAgePolicy, MinReleaseAgePolicyReadResult } from '../policy';
/**
 * Reads npm's merged effective config (project + user + global + builtin npmrc
 * plus npm_config_* env) by spawning `npm config list --json` once at the
 * workspace root, then derives the cooldown cutoff from `min-release-age`
 * (days) and `before` (absolute date).
 */
export declare function readNpmPolicy(root: string, pmVersion: string, env?: NodeJS.ProcessEnv): Promise<MinReleaseAgePolicyReadResult>;
/**
 * npm resolution under an active `before` filter. Exact pins and ranges mirror
 * npm-pick-manifest@11.0.3; dist-tag degrade uses the shared cross-PM rule:
 * - exact pin too new -> ETARGET (no fallback).
 * - unknown dist-tag -> ETARGET (no version to resolve against).
 * - dist-tag too new -> degrade via the shared channel-aware rule (see
 *   `degradeTagToCompliant` for the ordering); none compliant -> ENOVERSIONS.
 * - range -> filter every version by maturity FIRST; empty -> ENOVERSIONS;
 *   else newest in-range survivor; survivors but none in range -> ETARGET.
 */
export declare function pickNpmVersion(spec: string, metadata: RegistryMetadata, policy: MinReleaseAgePolicy): PickOutcome;
