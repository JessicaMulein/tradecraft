export declare const NEW_MIGRATE_FLAGS_FLOOR = "23.2.0";
export declare const NEW_MIGRATE_FLAGS: readonly ['--run-migration', '--runMigration', '--run-id', '--runId', '--step-action', '--stepAction'];
export declare function findNewMigrateFlag(argv: string[]): string | undefined;
/**
 * Whether the invocation names an existing orchestrated run. Such an
 * invocation has to execute against the workspace-local nx that owns the run's
 * state under `.nx/migrate-runs`, so it never routes to a temp installation.
 */
export declare function targetsExistingRun(argv: string[]): boolean;
/**
 * Guard A (local side, before hop A). The current nx knows the new flags, but
 * the temp CLI 'nx migrate' is about to install may be older and would
 * silently drop them. Decides where a new-flag invocation runs:
 *
 * - No new flag in `argv`, or the temp CLI version resolves at or above the
 *   feature floor: 'temp-cli', the normal temp-installation path.
 * - The temp CLI resolves below the floor, or resolution fails (a registry
 *   error, or a minimum-release-age violation that a temp install must not
 *   bypass): 'local-nx', provided the workspace-local nx can take the flags.
 *   The local nx qualifies when it is the exact version running this code
 *   (it parsed the flag, so it supports it regardless of the floor) or is at
 *   or above the floor. An unreadable local version throws: the hand-off's
 *   spawn normally lands on the very install this read verifies, and a
 *   layout where the version cannot be read gives no such assurance, so
 *   handing off blind could run a below-floor nx that silently drops the
 *   flag.
 * - Neither side is capable: throw with remediation.
 *
 * An explicit NX_MIGRATE_CLI_VERSION pinned below the floor throws instead of
 * silently overriding the user's pin with the local fallback.
 *
 * `cliVersionSpec` is NX_MIGRATE_CLI_VERSION when set, else 'latest'.
 */
export declare function resolveNewMigrateFlagsRunTarget(options: {
    argv: string[];
    cliVersionSpec: string;
    fromEnvOverride: boolean;
    ownNxVersion: string;
    resolveVersion: (spec: string) => Promise<string>;
    readLocalNxVersion: () => string | undefined;
}): Promise<'temp-cli' | 'local-nx'>;
/**
 * Guard B (temp side, before hop B). The temp CLI knows the new flags, but the
 * workspace-local nx it is about to hand off to may be older and would silently
 * drop them.
 *
 * A workspace pinned to a feature-carrying 23.2.0 prerelease is refused here
 * too: published prereleases that predate the feature cannot be told apart by
 * version alone. Guard A's same-version bypass does not apply on this side
 * because the invoking nx's version is not forwarded across hop A; the
 * refusal names the workspace update that resolves it.
 *
 * `readLocalNxVersion` returning undefined does not block: the hand-off then
 * resolves nx as it always does, which may fail visibly or land on another nx
 * the package manager locates.
 */
export declare function assertWorkspaceNxSupportsNewMigrateFlags(options: {
    argv: string[];
    readLocalNxVersion: () => string | undefined;
}): void;
