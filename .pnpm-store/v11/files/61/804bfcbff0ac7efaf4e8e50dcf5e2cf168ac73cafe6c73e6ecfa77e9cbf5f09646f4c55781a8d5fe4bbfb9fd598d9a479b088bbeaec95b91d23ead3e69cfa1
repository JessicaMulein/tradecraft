/**
 * Stable root for Nx runtime artifacts that need an OS tmp location. On POSIX a
 * literal `/tmp`, not `os.tmpdir()`, which honours `$TMPDIR` — per-user on
 * macOS, rewritten by sandboxes, stripped from the daemon env, so client and
 * daemon would disagree. Windows has no `/tmp`, and `%TMP%` is already per-user
 * and stable, so it keeps `os.tmpdir()`.
 *
 * Consumed by the native binding loader, so keep this file limited to local
 * helpers that themselves use Node builtins only.
 */
export declare const NX_TMP_DIR_POSIX = "/tmp/.nx";
/**
 * Windows has no /tmp, named pipes are not subject to filesystem sandboxing,
 * and per-user temp dirs are stable there, so the OS temp dir is fine.
 */
export declare const NX_TMP_DIR: string;
/**
 * Owner-only runtime root for the current user. No user segment on Windows —
 * `%TMP%` is already per-account, and the segment would only cost path length.
 */
export declare const NX_USER_TMP_DIR: string;
/** Runtime root under the user's home, used when the shared container cannot be established. */
export declare const NX_HOME_TMP_DIR: string;
