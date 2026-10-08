export type MinReleaseAgePolicyReadResult = {
    outcome: 'active';
    policy: MinReleaseAgePolicy;
} | {
    outcome: 'inactive';
} | {
    outcome: 'ambiguous';
    reason: string;
};
export interface MinReleaseAgePolicy {
    packageManagerVersion: string;
    cutoffMs: number;
    windowMs: number;
    sourceDescription: string;
    isExcluded(packageName: string, version: string): boolean;
    behavior: PmMinReleaseAgeBehavior;
}
export type PmMinReleaseAgeBehavior = {
    packageManager: 'npm';
} | {
    packageManager: 'pnpm';
    strict: boolean;
    looseFallback: boolean;
    writesExcludes: boolean;
    missingTimeMap: 'error' | 'skip';
} | {
    packageManager: 'yarn';
    missingVersionTime: 'pass' | 'quarantine';
} | {
    packageManager: 'bun';
};
/**
 * Reads the package manager, its version, and the relevant cooldown config
 * surfaces once, then dispatches to the per-PM reader. PM versions below the
 * feature's introduction boundary short-circuit to 'inactive' without touching
 * any config surface.
 */
export declare function readMinReleaseAgePolicy(root?: string): Promise<MinReleaseAgePolicyReadResult>;
