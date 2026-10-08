import type { RegistryMetadata } from '../packument';
import { type PickOutcome } from '../pick';
import type { MinReleaseAgePolicy, MinReleaseAgePolicyReadResult } from '../policy';
/**
 * Reads yarn berry's effective cooldown config. yarn resolves its own rc chain
 * (project + home .yarnrc.yml), env (`YARN_NPM_MINIMAL_AGE_GATE`) and defaults,
 * so we ask it for the resolved values via `yarn config get ... --json` rather
 * than merging rc files ourselves. The returned `npmMinimalAgeGate` is already
 * normalized to minutes (DURATION >=4.11; parseInt minutes on 4.10.x). On 4.15+
 * we still mirror yarn's first-install migration that opts old lockfiles out of
 * the new default gate.
 */
export declare function readYarnPolicy(root: string, pmVersion: string): Promise<MinReleaseAgePolicyReadResult>;
/**
 * yarn resolution under an active cooldown. Exact pins and ranges mirror yarn
 * berry's NpmSemverResolver gate; dist-tag degrade uses the shared cross-PM rule:
 * - exact/range: newest approved match; none approved -> violation (YN0016
 *   wording >=4.13, YN0082 wording <4.13).
 * - dist-tag too new -> degrade via the shared channel-aware rule (see
 *   `degradeTagToCompliant` for the ordering); none compliant -> violation.
 */
export declare function pickYarnVersion(spec: string, metadata: RegistryMetadata, policy: MinReleaseAgePolicy): PickOutcome;
