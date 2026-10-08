declare const safeSharedRootBrand: unique symbol;
declare const sharedRootEstablishedBrand: unique symbol;
declare const ownedRealDirBrand: unique symbol;
declare const ownedPrivateDirBrand: unique symbol;
/** Verified safe to keep an owner-only directory under. Not created. */
export type SafeSharedRoot = string & {
    readonly [safeSharedRootBrand]: true;
};
/** Created if absent, then verified safe as above. */
export type EstablishedSharedRoot = string & {
    readonly [sharedRootEstablishedBrand]: true;
};
/** An existing real directory owned by us. Mode is *not* checked. */
export type OwnedRealDir = string & {
    readonly [ownedRealDirBrand]: true;
};
/**
 * POSIX: created if absent, owned by us, and carrying no group or other bits —
 * re-locked first if it was looser. The mode is checked on whichever branch
 * produced it, so the brand does not depend on who created the directory.
 *
 * Windows: only *is a real directory*. `getuid` is unavailable there, so
 * neither ownership nor mode is checked; `%TMP%` is already per-account.
 */
export type OwnedPrivateDir = string & {
    readonly [ownedPrivateDirBrand]: true;
};
/** Why a guard refused a directory. Data, not a sentence: `remedyFor` decides on it. */
export type DirRefusal = {
    kind: 'not-created';
    dir: string;
    code?: string;
} | {
    kind: 'not-inspectable';
    dir: string;
    code?: string;
} | {
    kind: 'not-a-directory';
    dir: string;
    symlink?: true;
} | {
    kind: 'foreign-owner';
    dir: string;
    uid: number;
} | {
    kind: 'foreign-shared-container';
    dir: string;
    uid: number;
} | {
    kind: 'not-tightenable';
    dir: string;
    mode: number;
} | {
    kind: 'peer-writable-not-sticky';
    dir: string;
    mode: number;
};
/** A guard's verdict. */
export type GuardResult<T> = {
    status: 'ok';
    path: T;
} | {
    status: 'refused';
    refusal: DirRefusal;
};
/** The user-facing sentence for a refusal. The only place wording is decided. */
export declare function describeRefusal(r: DirRefusal): string;
/** What the user can do about a refusal, or `undefined` when there is nothing. */
export declare function remedyFor(r: DirRefusal): string | undefined;
/** One refusal as an `Error`, so several can travel in an `AggregateError`. */
export declare class DirectoryRefusedError extends Error {
    readonly refusal: DirRefusal;
    constructor(refusal: DirRefusal);
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
export declare function canonicalDir(dir: string): string;
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
export declare function isSafeSharedRoot(dir: string): GuardResult<SafeSharedRoot>;
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
export declare function isPeerWritable(dir: string): boolean;
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
export declare function ensureSafeSharedRoot(dir: string): GuardResult<EstablishedSharedRoot>;
/**
 * Whether `dir` is an existing real directory owned by us. Unlike
 * `ensureOwnedPrivateDir` it creates nothing and repairs nothing — for callers
 * that only want to know whether a path is safe to act on, such as deleting.
 */
export declare function isOwnedRealDirectory(dir: string): OwnedRealDir | null;
/** The path segment separating one user's Nx runtime state from another's. */
export declare function getUserSegment(): string;
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
export declare function ensureOwnedPrivateDir(dir: string): GuardResult<OwnedPrivateDir>;
export {};
