/**
 * Both the agentic runner and the orchestrator write per-run scratch under
 * `.nx/migrate-runs/<run-id>/`: handoff files in both cases, plus the durable
 * run state and its plan snapshots for the orchestrator. The v23 migration
 * `23-0-0-add-migrate-runs-to-git-ignore` adds `.nx/migrate-runs` to
 * `.gitignore`; in its declared slot (typically late) earlier per-migration
 * commits would absorb the scratch into the user-visible diff.
 *
 * Two paths cover the leak, with no overlap:
 *
 *   1. HOIST: `sortMigrations`, which `executeMigrations` applies, sorts the
 *      v23 migration to position 0 when it is in the queue, so it runs first
 *      through the normal runner with its own log line and commit. A
 *      single-migration worker run needs no hoisting: the requested migration
 *      is the entire queue.
 *
 *   2. INLINE FALLBACK, this function. When the migration is NOT in the queue
 *      AND the highest target version is < v23 (intra-pre-v23 `--agentic`
 *      run) it will never run, so apply its body inline against an `FsTree`
 *      and commit it as a standalone preflight commit (or leave it in the
 *      working tree under `--no-create-commits`).
 *
 * Not in the queue AND target >= v23 means the user is already past v23. They
 * had the entry historically; if it is gone, that is a conscious removal we
 * respect.
 */
export declare function applyAgenticHandoffGitignoreFallback({ migrations, installedNxVersion, effectiveCreateCommits, commitPrefix, root, applyWhenPlanned, commitStandalone, }: {
    migrations: ReadonlyArray<{
        package: string;
        name: string;
    }>;
    /**
     * The version of `nx` currently installed in the workspace. After
     * `nx migrate latest` runs (the step before `--run-migrations`), this is
     * the target nx version. We use it as the v23 cutoff instead of walking
     * the migration list: any third-party plugin migration with a `23.x`
     * version is irrelevant to whether `nx` itself crossed v23.
     */
    installedNxVersion: string;
    effectiveCreateCommits: boolean;
    commitPrefix: string;
    root: string;
    /**
     * Apply the entry even when the hoisted migration is in the plan. The
     * classic loop can defer to that migration because its run scratch appears
     * only after migration 1 has run; the orchestrator creates its run dir at
     * init, before any migration, so it needs the entry immediately. A planned
     * migration also means the missing entry is not a conscious removal, so the
     * v23 cutoff does not apply.
     */
    applyWhenPlanned?: boolean;
    /**
     * Commit the applied entry as its own preflight commit (the default). The
     * orchestrator suppresses this: it applies the fallback before its init
     * checkpoint so the checkpoint's `git add -A` cannot sweep in older
     * scratch, and in that ordering a standalone commit here would carry the
     * user's pre-existing changes along with the entry. The checkpoint that
     * follows captures both instead.
     */
    commitStandalone?: boolean;
}): Promise<void>;
