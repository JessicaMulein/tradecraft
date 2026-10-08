"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DirectoryRefusedError = void 0;
exports.describeRefusal = describeRefusal;
exports.remedyFor = remedyFor;
exports.canonicalDir = canonicalDir;
exports.isSafeSharedRoot = isSafeSharedRoot;
exports.isPeerWritable = isPeerWritable;
exports.ensureSafeSharedRoot = ensureSafeSharedRoot;
exports.isOwnedRealDirectory = isOwnedRealDirectory;
exports.getUserSegment = getUserSegment;
exports.ensureOwnedPrivateDir = ensureOwnedPrivateDir;
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
// A string discriminant, not a boolean `ok`: this repo compiles with
// `strict: false`, where TypeScript does not narrow a union on a boolean literal.
const allow = (path) => ({ status: 'ok', path });
const deny = (refusal) => ({
    status: 'refused',
    refusal,
});
const notADirectory = (dir, stats) => stats.isSymbolicLink()
    ? { kind: 'not-a-directory', dir, symlink: true }
    : { kind: 'not-a-directory', dir };
// Four octal digits, so a sticky container reads `1777` and a plain directory
// `0755` — the notation `chmod` and `ls` use. Prefixing a literal `0` instead
// renders sticky modes as `01777`, which is not a form anyone writes.
const asMode = (mode) => (mode & 0o7777).toString(8).padStart(4, '0');
/** The user-facing sentence for a refusal. The only place wording is decided. */
function describeRefusal(r) {
    switch (r.kind) {
        case 'not-created':
            return `${r.dir} could not be created${r.code ? ` (${r.code})` : ''}`;
        case 'not-inspectable':
            return `${r.dir} could not be inspected${r.code ? ` (${r.code})` : ''}`;
        case 'not-a-directory':
            return r.symlink
                ? `${r.dir} is a symlink, not a real directory — something replaced the path Nx expected to create`
                : `${r.dir} exists and is not a directory`;
        case 'foreign-owner':
            return `${r.dir} is owned by uid ${r.uid}, not by you`;
        case 'foreign-shared-container':
            return `${r.dir} belongs to another user (uid ${r.uid}) rather than to you or to root`;
        case 'not-tightenable':
            return `${r.dir} is reachable by other users (mode ${asMode(r.mode)}) and could not be tightened to 0700`;
        case 'peer-writable-not-sticky':
            return `${r.dir} is writable by other users but not sticky (mode ${asMode(r.mode)}), so a peer could replace directories inside it`;
        default: {
            // This repo sets `strict: false` and leaves `noImplicitReturns` unset, so
            // a new DirRefusal member would otherwise compile here and render as
            // `undefined` inside the aggregate message. Assignability to `never` still
            // holds under these settings, so this is a real compile-time guard.
            const unhandled = r;
            throw new Error(`Unhandled directory refusal: ${unhandled.kind}`);
        }
    }
}
/** Single-quoted for a shell, so a path with a space or quote survives a paste. */
const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
/** What the user can do about a refusal, or `undefined` when there is nothing. */
function remedyFor(r) {
    switch (r.kind) {
        case 'not-a-directory':
            return r.symlink
                ? `${r.dir} is a symlink where Nx expects a directory. If you did not create it, treat it as hostile: remove the link itself (not what it points at) and run the command again.`
                : undefined;
        case 'foreign-owner':
            return `${r.dir} belongs to another user on this machine, so Nx cannot keep its own directory there. Set NX_SOCKET_DIR to a short directory your user owns, or move it aside — which you can do yourself if you own the directory it sits in, and otherwise needs an administrator.`;
        case 'not-tightenable':
            // Both producers reach here having already established that the directory
            // is ours, so `chmod` is the user's to run. Names no cause: one producer
            // is a mount that discards the mode, the other is any `chmod` failure.
            return `${r.dir} is reachable by other users (mode ${asMode(r.mode)}) and Nx could not restrict it. Run \`chmod 0700 ${shellQuote(r.dir)}\` and try again; if the mode does not stick, set NX_SOCKET_DIR to a short directory on a filesystem that keeps POSIX permissions.`;
        case 'foreign-shared-container':
            // Unreachable today: `isSafeSharedRoot` denies with this kind only when
            // `stats.uid !== 0`, so a root-owned container never reaches here.
            if (r.uid === 0) {
                return undefined;
            }
            const q = shellQuote(r.dir);
            return `${r.dir} belongs to another user on this machine, so Nx cannot keep a private directory beneath it. Ask an administrator to hand it to root with \`sudo chown root ${q} && sudo chmod 1777 ${q}\`; every user can then keep their own directory under it.`;
        case 'not-created':
        case 'not-inspectable':
        case 'peer-writable-not-sticky':
            return undefined;
        default: {
            // Matches `describeRefusal`'s arm, so a new kind cannot ship with a
            // sentence and no advice — which is how `not-tightenable` went unadvised.
            const unhandled = r;
            return undefined;
        }
    }
}
/** One refusal as an `Error`, so several can travel in an `AggregateError`. */
class DirectoryRefusedError extends Error {
    constructor(refusal) {
        super(describeRefusal(refusal));
        this.refusal = refusal;
        this.name = 'DirectoryRefusedError';
    }
}
exports.DirectoryRefusedError = DirectoryRefusedError;
/**
 * chmod a path only if it is a real directory, never following a symlink at its
 * final component — `chmodSync` follows them, retargeting the mode change. The
 * directory check is on the descriptor, not the errno: a deny-list fails *open*
 * on codes it does not know. `O_NONBLOCK` stops a planted FIFO blocking `openSync`.
 */
function chmodRealDirectory(path, mode) {
    let fd;
    try {
        fd = (0, node_fs_1.openSync)(path, node_fs_1.constants.O_RDONLY | node_fs_1.constants.O_NOFOLLOW | node_fs_1.constants.O_NONBLOCK);
    }
    catch {
        return false;
    }
    try {
        if (!(0, node_fs_1.fstatSync)(fd).isDirectory()) {
            return false;
        }
        (0, node_fs_1.fchmodSync)(fd, mode);
        return true;
    }
    catch {
        return false;
    }
    finally {
        (0, node_fs_1.closeSync)(fd);
    }
}
/**
 * The spelling to compare a directory by. `resolve` does not dereference
 * symlinks, and on macOS `/tmp` is a symlink to `/private/tmp`, so an
 * exact-match list would wave through an alias of a root it means to refuse.
 *
 * Resolves the longest ancestor that exists and re-appends the rest: Nx's own
 * roots are absent before its first run, and canonicalizing whole paths only
 * would degrade this to a string match on exactly a fresh machine.
 *
 * Only `ENOENT` walks up — any other errno means the path exists and cannot be
 * read through, which `ensureOwnedPrivateDir` cannot establish either.
 */
function canonicalDir(dir) {
    const resolved = (0, node_path_1.resolve)(dir);
    const missing = [];
    let candidate = resolved;
    // Terminates at the filesystem root, where `dirname` is a fixed point.
    while ((0, node_path_1.dirname)(candidate) !== candidate) {
        try {
            return (0, node_path_1.join)((0, node_fs_1.realpathSync)(candidate), ...missing);
        }
        catch (e) {
            if (e?.code !== 'ENOENT') {
                return resolved;
            }
            missing.unshift((0, node_path_1.basename)(candidate));
            candidate = (0, node_path_1.dirname)(candidate);
        }
    }
    // The root itself: resolve it directly rather than walking past it.
    try {
        return (0, node_path_1.join)((0, node_fs_1.realpathSync)(candidate), ...missing);
    }
    catch {
        return resolved;
    }
}
/**
 * Sticky. Restricts rename and unlink in a writable directory to the owner of
 * each entry — plus the directory's own owner, which is why the ownership check
 * below is not redundant with this one.
 */
const S_ISVTX = 0o1000;
/**
 * Whether a shared container is safe to keep an owner-only directory under.
 *
 * On POSIX, a container writable by other users must be sticky, and it must be
 * owned by either root or the current user. Windows short-circuits after the
 * directory test — the OS temp root is already scoped to one account, so there
 * is no shared level whose ownership could matter.
 *
 * Sticky directories still let the directory's own owner rename entries, so a
 * container owned by another unprivileged user could replace a previously
 * verified private directory beneath it.
 */
function isSafeSharedRoot(dir) {
    try {
        const stats = (0, node_fs_1.lstatSync)(dir);
        if (!stats.isDirectory()) {
            return deny(notADirectory(dir, stats));
        }
        if (process.platform === 'win32') {
            // The OS temp root is already scoped to the current Windows user.
            return allow(dir);
        }
        if (typeof process.getuid === 'function' &&
            stats.uid !== process.getuid() &&
            stats.uid !== 0) {
            return deny({ kind: 'foreign-shared-container', dir, uid: stats.uid });
        }
        return !(stats.mode & 0o022) || !!(stats.mode & S_ISVTX)
            ? allow(dir)
            : deny({ kind: 'peer-writable-not-sticky', dir, mode: stats.mode });
    }
    catch (e) {
        return deny({ kind: 'not-inspectable', dir, code: e?.code });
    }
}
/**
 * Whether other users on this machine can write into `dir`. Gates whether a
 * refusal message may cite other users, so it must not over-report: `false` on
 * Windows, where libuv synthesizes `st_mode` from the READONLY attribute and
 * reports an ordinary per-account directory as `0666`, and `false` on a path
 * that cannot be inspected.
 *
 * `statSync`, not `lstatSync`: the question is about the directory that will be
 * used, not the link pointing at it. Link modes mislead in both directions —
 * Linux creates symlinks `0777`, macOS applies the umask. Nothing here decides
 * whether a path is accepted, so following the link costs nothing the guards
 * do not already re-check.
 */
function isPeerWritable(dir) {
    if (process.platform === 'win32') {
        return false;
    }
    try {
        return !!((0, node_fs_1.statSync)(dir).mode & 0o022);
    }
    catch {
        return false;
    }
}
/**
 * Create a shared container as sticky + world-writable if it does not exist,
 * and report whether the resulting path is safe for the current user.
 *
 * **A container that already exists is never modified — only judged.** Do not
 * chmod before deciding trust: `CAP_FOWNER` (root's default in Docker and most
 * CI images) can chmod a directory it does not own, so a peer-owned root would
 * be widened to `1777` and then refused, and an operator who deliberately
 * tightened this root would have it re-widened on every `nx` process.
 */
function ensureSafeSharedRoot(dir) {
    if (process.platform === 'win32') {
        try {
            (0, node_fs_1.mkdirSync)(dir, { recursive: true });
            return allow(dir);
        }
        catch (e) {
            return deny({ kind: 'not-created', dir, code: e?.code });
        }
    }
    try {
        (0, node_fs_1.mkdirSync)(dir, { mode: 0o1777 });
        // Ours, created a statement ago. Load-bearing on macOS: XNU strips S_ISVTX
        // at mkdir, so the sticky bit exists solely because of this call.
        chmodRealDirectory(dir, 0o1777);
    }
    catch (e) {
        if (e?.code !== 'EEXIST') {
            return deny({ kind: 'not-created', dir, code: e?.code });
        }
    }
    // One verdict for both branches: the chmod above can fail and leave a
    // peer-writable non-sticky container, which trusting the creation would brand
    // safe.
    const verdict = isSafeSharedRoot(dir);
    return verdict.status === 'ok'
        ? allow(dir)
        : deny(verdict.refusal);
}
/**
 * Whether `dir` is an existing real directory owned by us. Unlike
 * `ensureOwnedPrivateDir` it creates nothing and repairs nothing — for callers
 * that only want to know whether a path is safe to act on, such as deleting.
 */
function isOwnedRealDirectory(dir) {
    try {
        const stats = (0, node_fs_1.lstatSync)(dir);
        if (!stats.isDirectory()) {
            return null;
        }
        return typeof process.getuid !== 'function' ||
            stats.uid === process.getuid()
            ? dir
            : null;
    }
    catch {
        return null;
    }
}
/** The path segment separating one user's Nx runtime state from another's. */
function getUserSegment() {
    try {
        if (typeof process.getuid === 'function') {
            return String(process.getuid());
        }
    }
    catch { }
    try {
        const { username } = (0, node_os_1.userInfo)();
        if (username) {
            return username;
        }
    }
    catch { }
    return 'unknown';
}
/**
 * Ensure `dir` exists, is a real directory owned by us, and carries no group or
 * other bits at all — read and search alone reach a socket inside it, so 0755 is
 * re-locked rather than accepted. A `refused` status carries which check said
 * no — usually `foreign-owner` for a directory another user planted, but also
 * `not-created`/`not-inspectable` for a filesystem error, `not-a-directory`, or
 * `not-tightenable` when the re-lock did not land.
 *
 * Node builtins only: reached from the native binding loader.
 */
function ensureOwnedPrivateDir(dir) {
    try {
        (0, node_fs_1.mkdirSync)(dir, { mode: 0o700 });
    }
    catch (e) {
        if (e?.code !== 'EEXIST') {
            return deny({ kind: 'not-created', dir, code: e?.code });
        }
    }
    // One verdict for both branches, as in `ensureSafeSharedRoot`: mounts that
    // ignore the mode argument can land a directory Nx asked for at 0700 on 0777,
    // so the creation path is judged like any other.
    try {
        const stats = (0, node_fs_1.lstatSync)(dir);
        // Before the Windows short-circuit: "is a real directory" holds on every
        // platform.
        if (!stats.isDirectory()) {
            return deny(notADirectory(dir, stats));
        }
        if (typeof process.getuid !== 'function') {
            // Windows: the roots there are per-user OS temp dirs, not a shared /tmp.
            return allow(dir);
        }
        if (stats.uid !== process.getuid()) {
            return deny({ kind: 'foreign-owner', dir, uid: stats.uid });
        }
        if (stats.mode & 0o077) {
            if (!chmodRealDirectory(dir, 0o700)) {
                return deny({ kind: 'not-tightenable', dir, mode: stats.mode });
            }
            // Read the mode back rather than trusting the chmod's return: mounts that
            // ignore modes report success and change nothing.
            const after = (0, node_fs_1.lstatSync)(dir);
            if (after.mode & 0o077) {
                return deny({ kind: 'not-tightenable', dir, mode: after.mode });
            }
        }
        return allow(dir);
    }
    catch (e) {
        return deny({ kind: 'not-inspectable', dir, code: e?.code });
    }
}
