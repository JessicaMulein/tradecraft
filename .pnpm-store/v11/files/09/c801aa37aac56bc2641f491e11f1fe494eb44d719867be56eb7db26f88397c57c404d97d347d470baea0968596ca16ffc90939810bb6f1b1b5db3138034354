"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NX_HOME_TMP_DIR = exports.NX_USER_TMP_DIR = exports.NX_TMP_DIR = exports.NX_TMP_DIR_POSIX = void 0;
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const owned_private_dir_1 = require("./owned-private-dir");
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
exports.NX_TMP_DIR_POSIX = '/tmp/.nx';
/**
 * Windows has no /tmp, named pipes are not subject to filesystem sandboxing,
 * and per-user temp dirs are stable there, so the OS temp dir is fine.
 */
exports.NX_TMP_DIR = (0, node_os_1.platform)() === 'win32' ? (0, node_path_1.join)((0, node_os_1.tmpdir)(), '.nx') : exports.NX_TMP_DIR_POSIX;
/**
 * Owner-only runtime root for the current user. No user segment on Windows —
 * `%TMP%` is already per-account, and the segment would only cost path length.
 */
exports.NX_USER_TMP_DIR = (0, node_os_1.platform)() === 'win32' ? exports.NX_TMP_DIR : (0, node_path_1.join)(exports.NX_TMP_DIR, (0, owned_private_dir_1.getUserSegment)());
/** Runtime root under the user's home, used when the shared container cannot be established. */
exports.NX_HOME_TMP_DIR = resolveHomeTmpDir();
/**
 * Absolute, not merely non-empty: a relative `$HOME` would make `join` return
 * `.nx`, putting sockets under the cwd and aiming `removeSocketDir`'s recursive
 * delete at it. A rootless container has no `$HOME` and no passwd entry, so
 * `homedir()` throws or returns empty — caught here because this runs at module
 * scope and the native binding loader imports this file.
 */
function resolveHomeTmpDir() {
    try {
        const home = (0, node_os_1.homedir)();
        return home && (0, node_path_1.isAbsolute)(home) ? (0, node_path_1.join)(home, '.nx') : undefined;
    }
    catch {
        return undefined;
    }
}
