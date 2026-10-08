export declare function cloneFromUpstream(url: string, destination: string, { originName, depth }?: {
    originName: string;
    depth?: number;
}): Promise<GitRepository>;
export declare class GitRepository {
    private directory;
    root: string;
    constructor(directory: string);
    getGitRootPath(cwd: string): string;
    hasUncommittedChanges(): Promise<boolean>;
    addFetchRemote(remoteName: string, branch: string): Promise<string>;
    showStat(): Promise<string>;
    listBranches(): Promise<string[]>;
    getGitFiles(path: string): Promise<string[]>;
    reset(ref: string): Promise<string>;
    mergeUnrelatedHistories(ref: string, message: string): Promise<string>;
    fetch(remote: string, ref?: string): Promise<string>;
    checkout(branch: string, opts: {
        new: boolean;
        base: string;
    }): Promise<string>;
    move(path: string, destination: string): Promise<string>;
    push(ref: string, remoteName: string): Promise<string>;
    commit(message: string): Promise<string>;
    amendCommit(): Promise<string>;
    deleteGitRemote(name: string): Promise<string>;
    addGitRemote(name: string, url: string): Promise<string>;
    hasFilterRepoInstalled(): Promise<boolean>;
    filterRepo(source: string, destination: string): Promise<void>;
    filterBranch(source: string, destination: string, branchName: string): Promise<void>;
    private execGit;
}
export interface VcsRemoteInfo {
    domain: string;
    slug: string;
}
export declare function parseVcsRemoteUrl(url: string): VcsRemoteInfo | null;
export declare function locateGitDir(directory: string): {
    gitRoot: string;
    commonDir: string;
} | null;
export declare function getVcsRemoteInfo(directory?: string): VcsRemoteInfo | null;
export declare function getGitRootPath(cwd?: string): string;
/**
 * Path of `directory` relative to its git root, posix-separated so it is
 * identical on every OS, and '' when the directory is the git root itself.
 * Null outside a git repository.
 */
export declare function getGitRootRelativePath(directory: string): string | null;
/** A shallow clone's truncated history has no stable root commit. */
export declare function isShallowRepository(directory?: string): boolean;
/**
 * SHA of the repository's first commit. Merged unrelated histories leave
 * several root commits — the sorted-first one is picked so every clone
 * agrees. Null when there are no commits, or outside a git repository.
 */
export declare function getFirstCommitSha(directory?: string): string | null;
export declare function isGitRepository(directory?: string): boolean;
export type GitRepositoryStatus = 'git' | 'not-git' | 'unknown';
/**
 * Like `isGitRepository`, but separates "this is not a git repository" from
 * "the probe itself failed" (git not installed, permissions). Callers gating
 * destructive or unverifiable behavior on the answer must fail closed on
 * 'unknown' instead of reading a broken probe as a missing repository.
 */
export declare function getGitRepositoryStatus(directory?: string): GitRepositoryStatus;
export declare function getGitCurrentBranch(directory?: string): string | null;
export declare function getGitRemoteNames(directory?: string): string[];
export type WorkingTreeStatus = 'dirty' | 'clean' | 'unknown';
export declare function getWorkingTreeStatus(directory?: string, excludePaths?: string[]): WorkingTreeStatus;
export declare function hasUncommittedChanges(directory?: string, excludePaths?: string[]): boolean;
export type PathCommitExposure = 'ignored' | 'tracked' | 'unignored' | 'unknown';
export declare function getPathCommitExposure(dirPath: string, directory?: string): PathCommitExposure;
export declare function getUncommittedChangesSnapshot(directory?: string): string;
export declare function commitChanges(commitMessage: string, directory?: string): string | null;
/**
 * Throws on git failure with the real stderr attached. Use this when the
 * caller needs to distinguish hook rejection / GPG signing failures / LFS
 * lock errors from a successful no-op. Callers should pre-check
 * `hasUncommittedChanges` to avoid the "nothing to commit" rejection
 * (which `git commit` exits non-zero for).
 *
 * Returns `null` (rather than throwing) when the commit itself succeeded
 * but `git rev-parse HEAD` failed transiently — by contract the diff is
 * no longer in the working tree, so callers must NOT report it as such.
 *
 * `excludePaths` are `directory`-relative paths the commit must not capture,
 * whatever the ignore rules say. Their working-tree files are left intact;
 * only their index entries are put back to HEAD's state. Paths come from
 * callers' own constants, never from user input.
 */
export declare function tryCommitChanges(commitMessage: string, directory: string, excludePaths?: string[]): string | null;
export declare function getLatestCommitSha(directory?: string): string | null;
/**
 * The shape of a recorded `git rev-parse` output: 40 hex chars, or 64 in a
 * sha256 repository. Anything a caller persists and later interpolates into a
 * command line has to be checked against this first.
 */
export declare const GIT_SHA: RegExp;
/**
 * Whether `ancestor` is reachable from `descendant`, i.e. resetting to
 * `descendant` keeps `ancestor` in history. Returns false when the answer
 * cannot be established (invalid input, not a repository, unknown commits),
 * so callers treat an unverifiable commit as not preserved.
 */
export declare function isAncestorCommit(ancestor: string, descendant: string, directory?: string): boolean;
