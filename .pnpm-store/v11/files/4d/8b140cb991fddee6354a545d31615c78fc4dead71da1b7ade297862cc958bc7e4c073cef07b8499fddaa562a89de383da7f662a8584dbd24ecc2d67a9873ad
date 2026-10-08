export declare const CURRENT_RUN_STATE_FORMAT_VERSION = 1;
export declare const RUN_STATE_FILE_NAME = "run.json";
/**
 * The charset a migration id must stay inside to be interpolated into a
 * dispensed command. The outer agent executes those verbatim, so hostile ids
 * are refused rather than quoted per-platform (POSIX quoting is no defense in
 * cmd.exe). Enforced twice: on the incoming plan at init, so a bad id never
 * starts a run, and here on read, so a run whose persisted ids were tampered
 * with fails closed as corrupt instead of being dispensed.
 */
export declare const SHELL_SAFE_VALUE: RegExp;
declare const MIGRATE_RUN_STATUSES: readonly ['active', 'completed'];
export type MigrateRunStatus = (typeof MIGRATE_RUN_STATUSES)[number];
export interface MigrateRunRound {
    index: number;
    planHash: string;
    planSnapshot: string;
}
declare const MIGRATE_STEP_STATUSES: readonly ['pending', 'dispensed', 'running', 'awaiting-prompt-outcome', 'succeeded', 'failed', 'skipped', 'died'];
export type MigrateStepStatus = (typeof MIGRATE_STEP_STATUSES)[number];
declare const PROMPT_OUTCOME_STATUSES: readonly ['completed', 'skipped', 'failed'];
export type PromptOutcomeStatus = (typeof PROMPT_OUTCOME_STATUSES)[number];
export interface MigrateStepOutcome {
    fileChanges?: string[];
    gitRefAfter?: string;
    nextSteps?: string[];
    summary?: string;
}
export interface MigrateStepPromptOutcome {
    status: PromptOutcomeStatus;
    summary?: string;
}
export interface MigrateStep {
    id: string;
    roundIndex: number;
    migrationId: string;
    status: MigrateStepStatus;
    attempt: number;
    dispenseCount: number;
    hasGenerator?: boolean;
    pid?: number;
    startedAt?: string;
    finishedAt?: string;
    gitRefBefore?: string;
    treeCleanAtDispense?: boolean;
    depsHashAtDispense?: string;
    outcome?: MigrateStepOutcome;
    promptOutcome?: MigrateStepPromptOutcome;
    generatorCompleted?: boolean;
    installFailed?: boolean;
}
declare const MIGRATE_COMMIT_KINDS: readonly ['checkpoint', 'landed', 'failed'];
export type MigrateCommitKind = (typeof MIGRATE_COMMIT_KINDS)[number];
export interface MigrateCommitLedgerEntry {
    sha?: string;
    kind: MigrateCommitKind;
    stepIds: string[];
}
export interface MigrateRunAnalytics {
    startEmitted: boolean;
    completeEmitted: boolean;
}
export interface MigrateRunState {
    formatVersion: number;
    runId: string;
    createdAt: string;
    nxVersion: string;
    status: MigrateRunStatus;
    createCommits: boolean;
    commitPrefix: string;
    skipInstall?: boolean;
    rounds: MigrateRunRound[];
    steps: MigrateStep[];
    commits: MigrateCommitLedgerEntry[];
    checkpointFailed?: boolean;
    analytics: MigrateRunAnalytics;
}
export declare function migrateRunsDir(root: string): string;
export declare function runDir(root: string, runId: string): string;
/** See `HANDOFFS_DIR_NAME` for why the subtree exists. */
export declare function runHandoffsDir(runDirPath: string): string;
/**
 * Thrown when a run.json declares a `formatVersion` newer than this Nx
 * understands. Callers must not treat such a run as absent: an older Nx
 * ignoring a newer active run would start a competing run on top of it.
 *
 * Adding a member to any persisted closed set (run status, step status,
 * prompt-outcome status, commit kind) needs a
 * `CURRENT_RUN_STATE_FORMAT_VERSION` bump: without it, an older Nx reading
 * the new value would reject the run as corrupt (the closed-set validation
 * fails) instead of refusing with this error's ask for a newer Nx.
 */
export declare class NewerRunStateFormatError extends Error {
    constructor(message: string);
}
/**
 * Reads and validates `run.json` from a run directory.
 *
 * A `formatVersion` newer than {@link CURRENT_RUN_STATE_FORMAT_VERSION} means
 * the run was created by a newer Nx than the one currently running, so the
 * shape may not be interpretable here; this throws rather than attempting a
 * best-effort read. An older `formatVersion` is returned as-is: only v1
 * exists today, so there is nothing to migrate yet.
 */
export declare function readRunState(runDirPath: string): MigrateRunState;
/**
 * Writes `run.json` atomically: serializes to a temp file in the same
 * directory, then renames over the real path. A crash mid-write can only
 * ever leave the stale temp file behind, never a half-written run.json.
 *
 * Rename gives per-write atomicity only. Serializing the read-modify-write
 * sequences that concurrent nx migrate processes run is state-lock.ts's job.
 */
export declare function writeRunState(runDirPath: string, state: MigrateRunState): void;
export declare function hasRunState(runDirPath: string): boolean;
export interface UninterpretableRunDir {
    dirName: string;
    reason: string;
}
/**
 * Scans for the newest active run. A dir that holds a run.json but could be an
 * active run this caller cannot use is returned as `uninterpretable` instead
 * of being silently skipped: treating it as absent would let a run-starting
 * caller create a competing run that re-applies migrations the first run
 * already applied. That covers unreadable or corrupt content, where whether
 * the run is active cannot be determined, and an active run in a dir whose
 * name fails {@link RUN_ID_SAFE}, which cannot be resumed either.
 *
 * A dir that reads cleanly as a finished run is skipped whatever its name is:
 * it competes with nothing, and reporting it would block every future run
 * with no way for retention to ever clear it.
 *
 * Throws {@link NewerRunStateFormatError} when any run dir holds a
 * newer-format run.json: whether that run is active can't be determined
 * here, and its remediation (a newer Nx) differs from the uninterpretable
 * one (fix or remove).
 */
export declare function findActiveRun(root: string): {
    active: {
        runId: string;
        state: MigrateRunState;
    } | null;
    uninterpretable: UninterpretableRunDir[];
};
/**
 * Creates a new run directory and writes its initial state, then prunes old
 * completed runs so `.nx/migrate-runs` doesn't grow unbounded: only the
 * newest {@link MAX_RETAINED_COMPLETED_RUNS} completed runs are kept. Active
 * runs, the run just created, and legacy per-version runner dirs (no
 * run.json) are never pruned.
 *
 * Retention is best effort. A dir it cannot interpret or cannot remove is
 * left in place: the run's state is already written by then, so failing here
 * would abort a run that exists, and every retry would abort the same way.
 */
export declare function createRun(root: string, state: MigrateRunState): void;
export {};
