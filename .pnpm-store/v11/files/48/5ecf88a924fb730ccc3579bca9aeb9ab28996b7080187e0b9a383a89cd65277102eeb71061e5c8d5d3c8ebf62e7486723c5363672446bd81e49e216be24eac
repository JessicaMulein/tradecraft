import type { RegistryMetadata } from '../packument';
import { type PickOutcome } from '../pick';
import type { MinReleaseAgePolicy, MinReleaseAgePolicyReadResult } from '../policy';
/**
 * Reads bun's cooldown config from bunfig.toml. nx mirrors only the surfaces
 * bun reads at resolution time in this context: the project `bunfig.toml` and
 * the global bunfig, which lives at `$XDG_CONFIG_HOME/.bunfig.toml` when
 * XDG_CONFIG_HOME is set and at `$HOME/.bunfig.toml` otherwise (verified
 * against bun's getHomeConfigPath). Local overrides global per key. No env,
 * no .npmrc, no CLI surface exists in this context.
 */
export declare function readBunPolicy(root: string, pmVersion: string): Promise<MinReleaseAgePolicyReadResult>;
/**
 * bun resolution. Exact pins and ranges mirror bun's resolver
 * (find_best_version_with_filter, byte-identical 1.3.0 -> 1.3.14); dist-tag
 * degrade uses the shared cross-PM rule:
 * - exact pin too new -> hard error (TooRecentVersion), no fallback.
 * - range -> the `latest` dist-tag is checked first: in-range and age-passing ->
 *   return it immediately. Otherwise walk newest to oldest skipping age-blocked;
 *   the first age-passing candidate must also be stable (gap to the next-newer
 *   version >= min(window, 7d), inclusive); unstable -> keep walking but remember
 *   it; stop past `now - (window + 7d)`; no stable -> newest age-passing fallback.
 *   No in-range version at all -> err.not_found (a plain, non-cooldown error).
 * - dist-tag too new -> degrade via the shared channel-aware rule (see
 *   `degradeTagToCompliant` for the ordering); none compliant ->
 *   TooRecentVersion.
 * Missing/unparseable publish times are treated as timestamp 0 (always pass);
 * future timestamps are blocked.
 */
export declare function pickBunVersion(spec: string, metadata: RegistryMetadata, policy: MinReleaseAgePolicy): PickOutcome;
