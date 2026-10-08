/**
 * Whether nx migrate should resolve versions via the npm registry (fast) rather
 * than via a real package-manager install. Precedence, highest first:
 *
 * 1. `NX_MIGRATE_USE_REGISTRY_RESOLUTION` ('true' -> enabled, 'false' -> disabled)
 * 2. legacy `NX_MIGRATE_SKIP_REGISTRY_FETCH` (deprecated, removed in Nx 24;
 *    'true' -> disabled, 'false' -> enabled)
 * 3. nx.json `migrate.useRegistryResolution`
 * 4. default: enabled
 */
export declare function isRegistryResolutionEnabled(root?: string): boolean;
/** Test-only: clear the module-level caches between cases. */
export declare function resetResolvePackageVersionState(): void;
/**
 * The single resolution entry point for ALL nx migrate version resolutions. It
 * resolves a package spec to a concrete version while honoring the effective
 * minimum-release-age (cooldown) policy of the user's package manager, matching
 * how that PM at its detected version would resolve. Falls back to a real PM
 * install when the policy can't be reasoned about, or when registry resolution
 * is opted out.
 */
export declare function resolvePackageVersionRespectingMinReleaseAge(packageName: string, version: string, options?: {
    applySideEffects?: boolean;
}): Promise<string>;
