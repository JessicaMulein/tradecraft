"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDaemonSocketDir = exports.DAEMON_OUTPUT_LOG_FILE = exports.DAEMON_DIR_FOR_CURRENT_WORKSPACE = exports.InvalidSocketDirConfigured = void 0;
exports.writeDaemonLogs = writeDaemonLogs;
exports.markDaemonAsDisabled = markDaemonAsDisabled;
exports.disableDaemonForThisProcess = disableDaemonForThisProcess;
exports.isDaemonDisabled = isDaemonDisabled;
exports.getSocketDir = getSocketDir;
exports.getPluginSocketDir = getPluginSocketDir;
exports.resetSocketDirWarningsForTesting = resetSocketDirWarningsForTesting;
exports.getSocketDirFallbackCause = getSocketDirFallbackCause;
exports.getRefusedConfiguredSocketDir = getRefusedConfiguredSocketDir;
exports.removeSocketDir = removeSocketDir;
/**
 * Where the daemon, forked task processes and plugin workers put their sockets.
 *
 * Not `os.tmpdir()`, and not one location: the root is a literal `/tmp/.nx` so a
 * sandbox can allowlist it once, and resolution walks an ordered chain —
 * `$NX_SOCKET_DIR`, then `/tmp/.nx/<uid>/sockets`, then `~/.nx/sockets`, then the
 * workspace data dir. The socket directory beneath the winning root is per-run,
 * since its name hashes the pid; clients read the daemon's path back out of the
 * process cache rather than deriving it.
 *
 * Daemon logs are not here — they live in the workspace data dir alongside the
 * `disabled` marker, which is why that path survives a socket-root change.
 */
const node_fs_1 = require("node:fs");
const path_1 = require("path");
const cache_directory_1 = require("../utils/cache-directory");
const owned_private_dir_1 = require("../utils/owned-private-dir");
const crypto_1 = require("crypto");
// Refused as a socket *directory* (see InvalidSocketDirConfigured), and also
// the socket root itself on Windows, where named pipes are not filesystem
// objects and there is nothing to lock down beneath it.
const tmp_1 = require("tmp");
const native_file_cache_location_1 = require("../native/native-file-cache-location");
const nx_tmp_dir_1 = require("../utils/nx-tmp-dir");
const is_sandbox_1 = require("../utils/is-sandbox");
const workspace_root_1 = require("../utils/workspace-root");
/**
 * Thrown when the socket dir resolves to a directory Nx will not accept.
 * Invalid configuration, not a recoverable failure.
 *
 * Three reasons, and they are not interchangeable. A directory other users can
 * reach is a security problem; the OS temp root is the user's own but holds
 * everything else that uses it, and Nx deletes the socket directory
 * recursively; an Nx container or cache root is refused because Nx manages what
 * lives there. Telling someone their own `0700` directory lets a local attacker
 * execute code would be false, which is why the reason is derived from the
 * directory rather than the platform.
 */
class InvalidSocketDirConfigured extends Error {
    constructor(dir, reason) {
        super(reason === 'shared-with-other-users'
            ? `The configured Nx socket directory ${dir} is shared with the other users on this machine. Nx locks the socket directory to a single user, so pointing it at a shared one both shuts every other user out of it and — until it does — lets another local user connect to the daemon or plugin worker sockets and execute code in them. Set NX_SOCKET_DIR to a directory that only your user can access.`
            : reason === 'os-temp-root'
                ? // Two claims deliberately absent. "the temp files of everything else
                    // on the machine" is false here: this reason is chosen when the
                    // root is *not* peer-writable, so what it holds is this account's
                    // own. And "Nx already puts its sockets in a subdirectory of this
                    // root" is false on POSIX, where the default root is a literal
                    // /tmp/.nx and this one is os.tmpdir() — which is exactly when the
                    // two differ.
                    `The configured Nx socket directory ${dir} is the operating system temp directory. Nx deletes the socket directory and everything in it when the daemon stops, which here would take everything else using this temp directory with it. Point NX_SOCKET_DIR at a directory of your own instead — one nested beneath this root is fine.`
                : `The configured Nx socket directory ${dir} is a directory Nx keeps its own runtime state in, and Nx creates and removes socket directories beneath it. Point NX_SOCKET_DIR at a directory of your own instead — one nested beneath this root is fine.`);
        this.dir = dir;
        this.reason = reason;
        this.name = 'InvalidSocketDirConfigured';
    }
}
exports.InvalidSocketDirConfigured = InvalidSocketDirConfigured;
exports.DAEMON_DIR_FOR_CURRENT_WORKSPACE = (0, path_1.join)(cache_directory_1.workspaceDataDirectory, 'd');
exports.DAEMON_OUTPUT_LOG_FILE = (0, path_1.join)(exports.DAEMON_DIR_FOR_CURRENT_WORKSPACE, 'daemon.log');
const getDaemonSocketDir = () => (0, path_1.join)(getSocketDir(), 
// Kept intentionally short to stay under the socket/named pipe path length
// limit enforced by `assertValidSocketPath` in socket-utils.ts.
'd.sock');
exports.getDaemonSocketDir = getDaemonSocketDir;
function writeDaemonLogs(error) {
    const file = (0, path_1.join)(exports.DAEMON_DIR_FOR_CURRENT_WORKSPACE, 'daemon-error.log');
    (0, node_fs_1.writeFileSync)(file, error);
    return file;
}
function markDaemonAsDisabled(reason) {
    (0, node_fs_1.writeFileSync)((0, path_1.join)(exports.DAEMON_DIR_FOR_CURRENT_WORKSPACE, 'disabled'), reason);
}
let disabledForThisProcess;
/**
 * Turns the daemon off for this process only, leaving no marker behind.
 *
 * For a cause that belongs to the environment rather than to the workspace: a
 * sandbox refusing the socket says nothing about the next run from an ordinary
 * terminal, and the marker `markDaemonAsDisabled` writes would follow the
 * checkout there. It would also survive the user doing exactly what Nx told
 * them to do, since nothing clears it but `nx reset`.
 */
function disableDaemonForThisProcess(reason) {
    disabledForThisProcess = reason;
}
function isDaemonDisabled() {
    if (disabledForThisProcess !== undefined) {
        return true;
    }
    try {
        (0, node_fs_1.statSync)((0, path_1.join)(exports.DAEMON_DIR_FOR_CURRENT_WORKSPACE, 'disabled'));
        return true;
    }
    catch (e) {
        return false;
    }
}
/**
 * One short root beneath the current user's owner-only runtime directory. No
 * extra segment on Windows: `%TMP%` is already per-user and already contains the
 * username, so `\.nx\sockets` would spend 12 characters of the 95-char budget
 * `assertValidSocketPath` enforces and newly overrun it for long account names.
 */
function defaultSocketRoot() {
    return process.platform === 'win32'
        ? tmp_1.tmpdir
        : (0, path_1.join)(nx_tmp_dir_1.NX_USER_TMP_DIR, 'sockets');
}
function homeSocketRoot() {
    return nx_tmp_dir_1.NX_HOME_TMP_DIR ? (0, path_1.join)(nx_tmp_dir_1.NX_HOME_TMP_DIR, 'sockets') : undefined;
}
/**
 * Whether `~/.nx` is somewhere other than the shared container. With
 * `HOME=/tmp` they are the same path, and offering it as a second tier would
 * point `ensureOwnedPrivateDir` at `/tmp/.nx` itself — which, when the container
 * is already ours (or Nx runs as root), takes a `1777` container to `0700` and
 * undoes the documented provisioning, with nothing to put it back.
 */
function homeTierIsDistinct() {
    if (!nx_tmp_dir_1.NX_HOME_TMP_DIR) {
        return false;
    }
    // Hoisted: the callback runs once per root, and this operand does not change.
    const home = (0, owned_private_dir_1.canonicalDir)(nx_tmp_dir_1.NX_HOME_TMP_DIR);
    return ![
        tmp_1.tmpdir,
        nx_tmp_dir_1.NX_TMP_DIR,
        nx_tmp_dir_1.NX_USER_TMP_DIR,
        defaultSocketRoot(),
        native_file_cache_location_1.NATIVE_CACHE_ROOT,
    ].some((shared) => (0, owned_private_dir_1.canonicalDir)(shared) === home);
}
/**
 * Socket roots to try, best first. Each entry establishes its own containment
 * before it can be used; the first that succeeds wins, and the workspace data
 * dir is the last resort when none does.
 *
 * `/tmp` first because it is the shortest path — the socket budget is 95
 * characters. Home second because it needs no administrator. Windows has one
 * tier: named pipes are not filesystem objects, so there is nothing to establish.
 */
function socketRootTiers() {
    if (process.platform === 'win32') {
        return [{ root: tmp_1.tmpdir, establish: () => true }];
    }
    // Stops at the first refusal and records it: once the shared container is
    // unusable, whether the directories beneath it would also have failed says
    // nothing the user can act on.
    const establishAll = (dirs, refusals, guard) => dirs.every((d) => {
        const result = guard(d);
        if (result.status === 'refused') {
            refusals.push(result.refusal);
            return false;
        }
        return true;
    });
    return [
        {
            root: defaultSocketRoot(),
            establish: (refusals) => establishAll([nx_tmp_dir_1.NX_TMP_DIR], refusals, owned_private_dir_1.ensureSafeSharedRoot) &&
                establishAll([nx_tmp_dir_1.NX_USER_TMP_DIR, defaultSocketRoot()], refusals, owned_private_dir_1.ensureOwnedPrivateDir),
        },
        // Omitted entirely when there is no home directory to use, or when it is
        // the shared container under another name, rather than offered and then
        // damaging what it lands on.
        ...(homeTierIsDistinct() && homeSocketRoot()
            ? [
                {
                    root: homeSocketRoot(),
                    // No shared level to verify: the home directory is the user's own,
                    // so there is no container another user could have created first.
                    establish: (refusals) => establishAll([nx_tmp_dir_1.NX_HOME_TMP_DIR, homeSocketRoot()], refusals, owned_private_dir_1.ensureOwnedPrivateDir),
                },
            ]
            : []),
    ];
}
/**
 * The first socket root whose containment could be established, or `undefined`
 * when none could and the caller should fall back to the workspace.
 */
function establishSocketRoot(refusals) {
    const tiers = socketRootTiers();
    for (const [index, tier] of tiers.entries()) {
        if (tier.establish(refusals)) {
            // `preferred` is set only on a demotion, and names the tier that was
            // skipped — the caller records it so a later length failure can say the
            // path was not the one Nx wanted.
            return index === 0
                ? { root: tier.root }
                : { root: tier.root, preferred: tiers[0].root };
        }
    }
    return undefined;
}
/** Directories that may not *be* the socket directory, and why. */
function dirsUnusableAsSocketDir() {
    const onWindows = process.platform === 'win32';
    return [
        // Refused even when no peer can reach it: a configured directory becomes the
        // socket directory itself, and `removeSocketDir` deletes that recursively —
        // here, the user's whole temp directory.
        {
            dir: tmp_1.tmpdir,
            reason: (0, owned_private_dir_1.isPeerWritable)(tmp_1.tmpdir)
                ? 'shared-with-other-users'
                : 'os-temp-root',
        },
        {
            dir: nx_tmp_dir_1.NX_TMP_DIR,
            reason: (0, owned_private_dir_1.isPeerWritable)(nx_tmp_dir_1.NX_TMP_DIR)
                ? 'shared-with-other-users'
                : 'nx-managed',
        },
        { dir: nx_tmp_dir_1.NX_USER_TMP_DIR, reason: 'nx-managed' },
        { dir: defaultSocketRoot(), reason: 'nx-managed' },
        // Skipped on Windows, where the home tier is never offered.
        ...(!onWindows && nx_tmp_dir_1.NX_HOME_TMP_DIR
            ? [
                { dir: nx_tmp_dir_1.NX_HOME_TMP_DIR, reason: 'nx-managed' },
                { dir: homeSocketRoot(), reason: 'nx-managed' },
            ]
            : []),
        { dir: native_file_cache_location_1.NATIVE_CACHE_ROOT, reason: 'nx-managed' },
    ];
}
/**
 * The configured socket dir, normalized. `resolve` strips a trailing slash,
 * which would otherwise defeat the `O_NOFOLLOW` guard downstream — this is the
 * one socket path built from user input rather than by `join`.
 *
 * `||` rather than `??`: an empty value means unset. An empty string survives
 * `??`, and `resolve('')` is the working directory — which `removeSocketDir`
 * then deletes recursively. `NX_SOCKET_DIR=` with no value is ordinary in a
 * .env file or a compose environment list.
 */
function configuredSocketDir() {
    const dir = process.env.NX_SOCKET_DIR || process.env.NX_DAEMON_SOCKET_DIR;
    return dir ? (0, path_1.resolve)(dir) : undefined;
}
function socketDirName(root) {
    const hasher = (0, crypto_1.createHash)('sha256');
    hasher.update(workspace_root_1.workspaceRoot.toLowerCase());
    hasher.update(String(process.pid));
    const unique = hasher.digest('hex').substring(0, 20);
    return (0, path_1.join)(root, unique);
}
function pluginSocketDirName(root) {
    // Short so the socket file name still fits under assertValidSocketPath's limit.
    const hash = (0, crypto_1.createHash)('sha256')
        .update(workspace_root_1.workspaceRoot.toLowerCase())
        .digest('hex')
        .substring(0, 8);
    return (0, path_1.join)(root, hash);
}
/**
 * A socket dir under the first usable root, falling back to the workspace data
 * dir when no root can be established. Either way it is locked to the current
 * user.
 */
function socketDirUnderFirstUsableRoot(leafFor) {
    const configuredDir = configuredSocketDir();
    if (configuredDir !== undefined) {
        return createOwnerOnlySocketDir(configuredDir, false);
    }
    // Cleared here too: the no-tier exit below returns without entering
    // createOwnerOnlySocketDir, and a stale value would have assertValidSocketPath
    // blame an NX_SOCKET_DIR the user no longer has set.
    socketDirFallbackCause = undefined;
    refusedConfiguredSocketDir = undefined;
    const refusals = [];
    const established = establishSocketRoot(refusals);
    if (established === undefined) {
        return fallBackToWorkspaceSocketDir(socketRootsUnavailable(refusals), undefined, refusals);
    }
    const dir = createOwnerOnlySocketDir(leafFor(established.root), true, refusals);
    // Only when the directory we actually got is the demoted tier: if
    // createOwnerOnlySocketDir fell back to the workspace, it recorded its own,
    // more specific cause and that one should survive.
    if (established.preferred !== undefined &&
        socketDirFallbackCause === undefined) {
        noteSocketRootDemotion(established.preferred, established.root, refusals);
    }
    return dir;
}
/**
 * Record a successful demotion to a later tier. Verbose, not warn: nothing
 * failed. The cause is still set because `assertValidSocketPath` keys its
 * "run with --verbose" block off it, and without it a later length failure
 * reads as though the user chose the path.
 *
 * `refusals` can name any of the three directories tier 0 establishes, so it is
 * not always `preferred`.
 */
function noteSocketRootDemotion(preferred, used, refusals) {
    socketDirFallbackCause = new Error(`Nx could not establish its preferred socket root ${preferred}, so it used ${used}.`);
    // Lazily required for the import-cycle reason spelled out in
    // fallBackToWorkspaceSocketDir below.
    const { logger } = require('../utils/logger');
    logger.verbose(`Nx could not use the default socket directory ${preferred}. Using ${used} instead.` +
        (refusals.length
            ? ` ${refusals.map((r) => (0, owned_private_dir_1.describeRefusal)(r)).join('; ')}.`
            : ''));
}
function getSocketDir() {
    return socketDirUnderFirstUsableRoot(socketDirName);
}
/**
 * Plugin worker sockets get their own workspace-scoped directory rather than
 * sitting in the shared system temp dir, which cannot be locked down.
 */
function getPluginSocketDir() {
    return socketDirUnderFirstUsableRoot(pluginSocketDirName);
}
let socketDirFallbackCause;
let refusedConfiguredSocketDir;
let warnedAboutWorkspaceFallback = false;
let warnedAboutConfiguredSocketDir = false;
/**
 * Exported for tests: both fallback warnings fire once per process, so a suite
 * that stages either fallback more than once has to clear the latches between
 * cases.
 */
function resetSocketDirWarningsForTesting() {
    warnedAboutWorkspaceFallback = false;
    warnedAboutConfiguredSocketDir = false;
}
function getSocketDirFallbackCause() {
    return socketDirFallbackCause;
}
/**
 * The NX_SOCKET_DIR that was refused, if that is why we are in the fallback.
 * Reflects the most recent resolution only — both accessors are cleared at the
 * top of every `createOwnerOnlySocketDir` call, and the daemon and plugin socket
 * paths each drive one. Read it immediately after the call that produced the
 * path, which is what `assertValidSocketPath` does.
 */
function getRefusedConfiguredSocketDir() {
    return refusedConfiguredSocketDir;
}
/**
 * @param dir the resolved socket directory to create and lock down.
 * @param usingDefaultRoot whether `dir` sits under the default root, in which
 *        case Nx verifies the stable shared container and establishes the
 *        current user's owner-only roots first.
 * @param priorRefusals why the tiers above this one were skipped. Ignored unless
 *        `usingDefaultRoot`.
 */
function createOwnerOnlySocketDir(dir, usingDefaultRoot, priorRefusals = []) {
    socketDirFallbackCause = undefined;
    refusedConfiguredSocketDir = undefined;
    // Outside the try so it is not swallowed by the fallback. Exact matches only,
    // so the per-user directories under those roots never trip it.
    const canonical = (0, owned_private_dir_1.canonicalDir)(dir);
    const unusable = dirsUnusableAsSocketDir().find((d) => canonical === (0, owned_private_dir_1.canonicalDir)(d.dir));
    if (unusable) {
        throw new InvalidSocketDirConfigured(dir, unusable.reason);
    }
    try {
        // A default root has already had its containment established by the tier it
        // came from; a configured one is the user's to create.
        if (!usingDefaultRoot) {
            (0, node_fs_1.mkdirSync)((0, path_1.dirname)(dir), { recursive: true });
        }
        // Separately from its parents: mkdirSync does not throw on a pre-planted
        // symlink, so creating and locking down in one step would adopt it.
        const created = (0, owned_private_dir_1.ensureOwnedPrivateDir)(dir);
        if (created.status === 'refused') {
            throw new owned_private_dir_1.DirectoryRefusedError(created.refusal);
        }
        return dir;
    }
    catch (e) {
        const refusals = e instanceof owned_private_dir_1.DirectoryRefusedError
            ? [...priorRefusals, e.refusal]
            : priorRefusals;
        // Recoverable: fall back to the owner-controlled workspace data dir.
        if (usingDefaultRoot) {
            return fallBackToWorkspaceSocketDir(refusals.length ? socketRootsUnavailable(refusals) : e, dir, refusals);
        }
        // Never swap out a configured directory silently — the substitute is longer
        // and would resurface as a length complaint about a path the user never set.
        // Latched: a task-per-PseudoTerminal command resolves this once per task.
        if (!warnedAboutConfiguredSocketDir) {
            warnedAboutConfiguredSocketDir = true;
            console.warn(`Nx could not use the configured socket directory ${dir}: ${e instanceof Error ? e.message : e}\nFalling back to ${exports.DAEMON_DIR_FOR_CURRENT_WORKSPACE}.`);
        }
        // Tracked separately from socketDirFallbackCause so the length error stops
        // telling someone to shorten an NX_SOCKET_DIR that was refused for another
        // reason.
        refusedConfiguredSocketDir = dir;
        return establishWorkspaceSocketDir(e);
    }
}
/**
 * The refusals as one error. `AggregateError` because there genuinely are
 * several — one per root the chain tried — and its `errors` stay inspectable
 * rather than being flattened into the message that `--verbose` prints.
 */
function socketRootsUnavailable(refusals) {
    return new AggregateError(refusals.map((r) => new owned_private_dir_1.DirectoryRefusedError(r)), `Nx could not establish any of its default socket directories: ${refusals
        .map((r) => (0, owned_private_dir_1.describeRefusal)(r))
        .join('; ')}.`);
}
/**
 * The last resort once no default root could be used. Retains the cause so
 * `assertValidSocketPath` can explain a length failure the user did not cause.
 */
function fallBackToWorkspaceSocketDir(cause, attempted, refusals = []) {
    socketDirFallbackCause = cause;
    // Required lazily, and only on a path that is already failing. A static
    // import closes a cycle — utils/logger reads `serverLogger` from
    // daemon/logger while it is still evaluating, and daemon/logger imports this
    // module — which throws whenever `isOnDaemon()` is true as this module loads.
    // Production escapes it only because server.ts sets `global.NX_DAEMON` after
    // its imports, so daemon boot rests on import order.
    const { logger } = require('../utils/logger');
    logger.verbose(`Nx could not use the default socket ${attempted ? `directory ${attempted}` : 'directories'}. Falling back to ${exports.DAEMON_DIR_FOR_CURRENT_WORKSPACE}.`, cause);
    // Warned rather than verbose: the workspace path grows with checkout depth, so
    // this is where the 95-character budget is most likely to trip, and an
    // allowlist scoped to Nx's usual roots no longer covers it.
    //
    // Latched once per process — neither socket-dir accessor is memoized and one
    // CLI process resolves several, so without it a single command repeats this
    // many times.
    if (!warnedAboutWorkspaceFallback) {
        warnedAboutWorkspaceFallback = true;
        logger.warn([
            `Nx could not use any of its usual socket directories and fell back to ${exports.DAEMON_DIR_FOR_CURRENT_WORKSPACE}.`,
            ...new Set(refusals.map(owned_private_dir_1.remedyFor).filter(Boolean)),
            (0, is_sandbox_1.isSandbox)()
                ? // NX_HOME_TMP_DIR is undefined when there is no home directory,
                    // which is itself one reason this fallback is reached.
                    `A sandbox allowlist covering only ${[nx_tmp_dir_1.NX_TMP_DIR, nx_tmp_dir_1.NX_HOME_TMP_DIR]
                        .filter(Boolean)
                        .join(' or ')} does not cover this path.`
                : undefined,
            'Run with --verbose to see why the others were rejected.',
        ]
            .filter(Boolean)
            .join(' '));
    }
    return establishWorkspaceSocketDir(cause);
}
function establishWorkspaceSocketDir(cause) {
    (0, node_fs_1.mkdirSync)((0, path_1.dirname)(exports.DAEMON_DIR_FOR_CURRENT_WORKSPACE), { recursive: true });
    // The fallback is only safe if it passes the same checks the primary did.
    const established = (0, owned_private_dir_1.ensureOwnedPrivateDir)(exports.DAEMON_DIR_FOR_CURRENT_WORKSPACE);
    if (established.status === 'refused') {
        // With the remedy: this is the one refusal path with nowhere left to fall,
        // so it is where the user most needs it and the only one that cannot reach
        // the warning's copy.
        const remedy = (0, owned_private_dir_1.remedyFor)(established.refusal);
        throw new Error(`Nx could not establish a socket directory: ${(0, owned_private_dir_1.describeRefusal)(established.refusal)}.${remedy ? ` ${remedy}` : ''}`, { cause });
    }
    return exports.DAEMON_DIR_FOR_CURRENT_WORKSPACE;
}
function removeSocketDir() {
    try {
        (0, node_fs_1.rmSync)(getSocketDir(), { recursive: true, force: true });
    }
    catch (e) { }
}
