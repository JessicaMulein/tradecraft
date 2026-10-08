/**
 * `readNxJson` rather than a raw read, so a `cacheDirectory` reached through
 * `extends` counts. It throws on malformed JSON, which must not take the
 * process down here: this runs at module scope, and a broken `nx.json` has a
 * better error waiting for it further in.
 */
export declare function readCacheDirectoryProperty(root: string): string | undefined;
/** The data a repository's checkouts share, each in its own directory. */
export type SharedDataKind = 'cache' | 'workspace-data';
/** The establish verdict is cached per process; tests need it cleared. */
export declare function resetSharedRootCacheForTesting(): void;
/**
 * Where this checkout's shared data lives.
 *
 * `none` keeps its own copy, `user` uses the per-user shared root.
 */
export type SharedDataLocation = {
    share: 'none';
} | {
    share: 'user';
    dirName: string;
};
/**
 * The one decision the cache and the workspace-data DB both follow.
 *
 * They have to move together. The DB's `cache_outputs` rows index the cache
 * directory's contents, so a checkout reading a shared DB while writing a
 * private cache takes a hit on a row whose artifacts it does not have -- and
 * `finalizeCacheHits` still calls that `local-cache`, with nothing restored.
 * Two predicates is how that happens, so there is only one.
 *
 * The per-user root is preferred for every checkout, not only for linked
 * worktrees, and an agent sandbox can be granted `~/.nx` by a committed
 * settings file where an absolute checkout path cannot (NXC-4625).
 */
export declare function resolveSharedDataLocation(root: string): SharedDataLocation;
/**
 * The per-user directory a workspace's checkouts share for `kind`.
 *
 * It lives outside every checkout because an agent sandbox grants paths, and a
 * checkout's absolute path is different on each machine so it cannot be
 * committed to a shared settings file. This root can (NXC-4625).
 */
export declare function sharedUserDataDir(dirName: string, kind: SharedDataKind): string;
/**
 * The directory `kind` resolves to, following the one sharing decision.
 *
 * The shared answer is the same shape for both kinds. The unshared one is not:
 * the cache honours a configured `cacheDirectory` and the lerna special case,
 * the DB honours `NX_WORKSPACE_DATA_DIRECTORY`.
 */
export declare function sharedDataDirectory(root: string, kind: SharedDataKind): string;
/**
 * Path to the directory where Nx stores its cache.
 *
 * Normally the shared per-user directory, so every checkout of the workspace
 * uses one cache. A configured `cacheDirectory` is honored instead, resolved
 * against the root that asks -- so two checkouts share a configured location
 * only when the value is absolute. See `resolveSharedDataLocation`.
 */
export declare const cacheDir: string;
export declare function cacheDirectoryForWorkspace(root: string): string;
/**
 * This checkout's own workspace-data directory, never the shared one. Daemon
 * logs and the `disabled` marker live here, and both describe this checkout.
 */
export declare const workspaceDataDirectory: string;
export declare function workspaceDataDirectoryForWorkspace(workspaceRoot: string): string;
