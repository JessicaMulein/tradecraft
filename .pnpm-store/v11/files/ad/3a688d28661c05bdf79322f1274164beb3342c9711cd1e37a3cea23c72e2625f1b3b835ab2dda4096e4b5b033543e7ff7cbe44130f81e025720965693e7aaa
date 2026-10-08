/**
 * Warning messages the inline hoist (`executor-to-plugin-migrator`) and the
 * batch finalize (`batch-conversion-finalize`) emit for the same outcomes. One
 * builder per message so both paths stay word for word identical.
 */
import type { TargetConfiguration } from 'nx/src/devkit-exports';
/** Which package.json signal authors a target's identity. */
export type PackageJsonIdentitySource = 'script' | 'nxTargets' | 'unparseable';
/** A migrated target was left untouched because package.json authors its identity. */
export declare function keptPreMigrationTargetWarning(targetName: string, projectName: string, source: PackageJsonIdentitySource): string;
/** A target's centralization was skipped before writing anything. */
export declare function retainedResidualsWarning(targetNames: string[], reason: string): string;
/** Projects whose target identity lives outside the plugin were not hoisted. */
export declare function excludedProjectsWarning(projectNames: string[], targetNames: string[]): string;
/** A hoisted target was reverted because it reached a non-migrated root. */
export declare function revertedTargetsWarning(targetNames: string[], errors: string[]): string;
/** A pair the verification pass did not infer at all. */
export interface MissingPair {
    pair: string;
    root: string;
    /** The target no longer exists once the residual is restored. */
    removed: boolean;
}
/** Whether Nx drops an explicit target with this configuration (target normalization). */
export declare function isDroppedTarget(target: TargetConfiguration): boolean;
export declare function unverifiedPairsWarning(divergent: string[], missing: MissingPair[], errors: string[]): string;
/** Verification errors that neither a revert nor a fallback warning carried. */
export declare function verificationErrorsWarning(errors: string[], anyFallback: boolean): string;
