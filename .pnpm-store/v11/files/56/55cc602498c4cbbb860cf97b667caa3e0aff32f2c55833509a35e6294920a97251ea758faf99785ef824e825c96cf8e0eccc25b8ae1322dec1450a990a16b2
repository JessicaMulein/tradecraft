import type { BlockedVersion } from './errors';
import type { RegistryMetadata } from './packument';
import type { MinReleaseAgePolicy } from './policy';
export type VersionSpecType = 'exact' | 'range' | 'tag';
export interface PickOutcome {
    version: string;
    unconstrained: string;
    immature?: boolean;
}
/**
 * Classifies a version spec the way the package managers do: an exact semver is
 * a pin, a valid range is a range, anything else (latest, hot, canary, ...) is
 * a dist-tag. Catalog refs are dereferenced before this layer.
 */
export declare function classifySpec(spec: string): VersionSpecType;
/**
 * Splits an npm package descriptor into its name and the raw version part after
 * the separating `@`, honoring scoped names where the leading `@` is part of the
 * name. `versionPart` is null when there is no separator (bare name) and an
 * empty string for a trailing `@`; callers interpret the version part.
 */
export declare function splitPackageDescriptor(entry: string): {
    name: string;
    versionPart: string | null;
};
/**
 * Shared maturity test: a version passes when its publish time is at or before
 * the cutoff (inclusive), or when it is explicitly excluded.
 */
export declare function isVersionMature(name: string, version: string, metadata: RegistryMetadata, policy: MinReleaseAgePolicy): boolean;
/**
 * Newest version satisfying the range, ignoring the cooldown gate. Used only to
 * compute PickOutcome.unconstrained (messaging); never gates a pick. Falls back
 * to the raw range when nothing matches.
 */
export declare function newestInRange(metadata: RegistryMetadata, range: string): string;
/**
 * Degrades a too-new dist-tag target to a cooldown-compliant version "of the
 * same kind", shared by every package manager.
 *
 * The candidate pool is every version at or below the resolved target that is
 * stable, in the target's prerelease channel, or on a lower rung of the
 * channel ladder (alpha < beta < rc). It is ordered so that prereleases of
 * the target's exact release line come first - own channel, then lower rungs -
 * then everything else; within each group the most recently published version
 * comes first (semver breaks ties and orders versions with no publish time).
 * The first compliant version in that order wins.
 *
 * So a stable target degrades to the newest compliant stable, and a prerelease
 * target keeps a compliant prerelease of the release it points at when one
 * exists (an rc may fall to a same-line beta), otherwise drops to the newest
 * compliant version below it - never crossing into a channel with no place on
 * the ladder (e.g. an internal `pr` build) and never climbing up it. Returns
 * null when nothing in the pool is compliant; callers turn that into their
 * package manager's violation.
 *
 * `isCompliant` is the caller's per-PM maturity test (package managers differ
 * on missing publish times and excludes).
 */
export declare function degradeTagToCompliant(target: string, metadata: RegistryMetadata, isCompliant: (version: string) => boolean): string | null;
/**
 * Maps a list of held-back versions to the blocked-candidate shape carried by
 * MinReleaseAgeViolationError, keeping only versions the registry has a publish
 * time for.
 */
export declare function blockedVersionsFrom(metadata: RegistryMetadata, versions: string[]): BlockedVersion[];
/**
 * Resolves a spec to a version that complies with the effective cooldown
 * policy, dispatching to the per-PM pick rules. Throws
 * MinReleaseAgeViolationError when the PM at this version would fail.
 */
export declare function pickMinReleaseAgeCompliantVersion(spec: string, metadata: RegistryMetadata, policy: MinReleaseAgePolicy): PickOutcome;
