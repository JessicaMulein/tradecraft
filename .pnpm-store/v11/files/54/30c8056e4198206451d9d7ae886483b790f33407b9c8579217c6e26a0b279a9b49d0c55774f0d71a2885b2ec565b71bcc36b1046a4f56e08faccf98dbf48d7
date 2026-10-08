import type { ResolvedAgentic } from './agentic/types';
/**
 * Discriminated result for `commitMigrationIfRequested`. Distinguishes the
 * shapes the executor needs to react to:
 *
 * - `committed`: a commit landed. `sha` is `null` only when `git rev-parse
 *   HEAD` failed transiently — by contract the diff is no longer in the
 *   working tree.
 * - `no-changes`: commits were requested but there was nothing to commit.
 * - `failed`: the commit attempt itself errored. The diff remains in the
 *   working tree; the executor uses this signal to track pending migrations
 *   so the next successful commit can annotate its body.
 * - `disabled`: commits are off for this run.
 */
export type CommitResult = {
    status: 'committed';
    sha: string | null;
} | {
    status: 'no-changes';
} | {
    status: 'failed';
    reason: string;
} | {
    status: 'disabled';
};
/**
 * `pendingMigrations` are listed in the commit body so a `git log -p` reader
 * can see which earlier migrations' diffs this commit absorbed (their own
 * commits failed and `git add -A` picked their working-tree state up too).
 *
 * The default `failureGuidance` describes the classic loop's absorb-and-recap
 * behavior; a caller with no later commit or recap to absorb the diff (the
 * standalone single-migration worker) passes its own.
 */
export declare function commitMigrationIfRequested(root: string, migration: {
    name: string;
}, shouldCreateCommits: boolean, commitPrefix: string, installDepsIfChanged: () => Promise<void>, pendingMigrations?: ReadonlyArray<{
    package: string;
    name: string;
}>, failureGuidance?: string): Promise<CommitResult>;
/**
 * Commits any pre-existing working-tree state into a dedicated "checkpoint"
 * commit before the first migration runs. Without this, the first migration's
 * commit would absorb whatever was already pending — most commonly the
 * package.json edit `nx migrate latest` produces and the lockfile churn from
 * the orchestrator's `npm install --ignore-scripts` step — and migration 1's
 * validation would see that mixed in with the generator output. No-op when
 * the working tree is already clean.
 */
export declare function commitCheckpointBeforeMigrations(root: string, commitPrefix: string): void;
/**
 * `agenticHasDiffContext` gates the agent prompt: without per-migration commits
 * to isolate a migration's diff, the prompt embeds a file list instead of
 * pointing at git.
 */
export declare function resolveCreateCommits(args: {
    createCommits: boolean | undefined;
    mode: ResolvedAgentic['kind'] | 'orchestrated';
    isGitRepo: boolean;
    commitPrefixIsCustom?: boolean;
}): {
    effective: boolean;
    agenticHasDiffContext: boolean;
    warning?: string;
    error?: string;
};
/**
 * Asks before a run starts committing on the workspace's default branch, and
 * reports the decision when the answer is no. Returns whether to proceed.
 *
 * Callers gate this on commits being effective and on prompting being
 * possible, so non-interactive runs (CI, `--no-interactive`) never reach here;
 * `confirmCommitsOnDefaultBranch` has no guard of its own and would block on a
 * prompt nobody can answer.
 */
export declare function confirmMigrationCommitsOnDefaultBranch(root: string, whatWouldRun: 'running migrations' | 'running the migration'): Promise<boolean>;
export declare function confirmCommitsOnDefaultBranch(args: {
    currentBranch: string | null;
    defaultBranch: string | null;
}): Promise<boolean>;
