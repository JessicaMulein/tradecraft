import type { PackageManager } from '../package-manager';
export interface BlockedVersion {
    version: string;
    publishedAt: string;
}
export interface MinReleaseAgeViolationErrorOptions {
    packageManager: PackageManager;
    packageName: string;
    spec: string;
    pmShapedDetail: string;
    blocked: BlockedVersion[];
    remediation: string[];
}
/**
 * Raised when the user's package manager, at its detected version, would refuse
 * to resolve a version because it falls inside the minimum-release-age window.
 * Carries the PM-shaped detail and the blocked candidates so the migrate layer
 * can surface a friendly message or a PM-specific prompt.
 */
export declare class MinReleaseAgeViolationError extends Error {
    readonly packageManager: PackageManager;
    readonly packageName: string;
    readonly spec: string;
    readonly pmShapedDetail: string;
    readonly blocked: BlockedVersion[];
    readonly remediation: string[];
    constructor(opts: MinReleaseAgeViolationErrorOptions);
}
