import type { CommitResult } from '../migrate-commits';
import type { MigrateCommitLedgerEntry, MigrateRunState, MigrateStepOutcome, MigrateStepPromptOutcome } from './run-state';
import type { StepAction } from '../step-actions';
export type { StepAction };
export type StepEvent = {
    type: 'dispense';
    stepId: string;
} | {
    type: 'start';
    stepId: string;
    pid: number;
    startedAt: string;
} | {
    type: 'succeed';
    stepId: string;
    finishedAt: string;
    outcome?: MigrateStepOutcome;
} | {
    type: 'fail';
    stepId: string;
    finishedAt: string;
    outcome?: MigrateStepOutcome;
} | {
    type: 'awaitPromptOutcome';
    stepId: string;
    finishedAt: string;
} | {
    type: 'foldPromptOutcome';
    stepId: string;
    attempt: number;
    promptOutcome: MigrateStepPromptOutcome;
} | {
    type: 'markGeneratorCompleted';
    stepId: string;
} | {
    type: 'markDied';
    stepId: string;
    attempt: number;
} | {
    type: 'stepAction';
    stepId: string;
    action: StepAction;
    attempt: number;
};
export type ApplyStepEventResult = {
    kind: 'ok';
    state: MigrateRunState;
} | {
    kind: 'error';
    reason: string;
};
export declare function applyStepEvent(state: MigrateRunState, event: StepEvent): ApplyStepEventResult;
/**
 * Records that the run could not install the dependency changes a step left
 * behind. Not a {@link StepEvent}: it annotates a step instead of moving it,
 * and every status can carry it, since the orchestrator marks a step it has
 * just settled while the worker marks one it is about to fail.
 */
export declare function markInstallFailed(state: MigrateRunState, stepId: string): MigrateRunState;
export declare function uncoveredFailedStepIds(state: MigrateRunState): string[];
/**
 * A step has commit debt when a 'failed' ledger entry names it and no later
 * 'landed' entry also names it (checkpoint entries neither create nor cover
 * debt). There is no per-step commit object; debt is always derived from the
 * ledger.
 */
export declare function hasPendingCommitDebt(state: MigrateRunState): boolean;
export declare function coveringLandedEntries(state: MigrateRunState, stepId: string): MigrateCommitLedgerEntry[];
export declare function latestRound(state: MigrateRunState): MigrateRunState['rounds'][number] | undefined;
export declare function splitMigrationId(id: string): {
    package: string;
    name: string;
};
export declare function stepsToPendingMigrations(state: MigrateRunState, stepIds: string[]): {
    package: string;
    name: string;
}[];
/**
 * Classifies a commit attempt into the ledger entry to record, or null when
 * there is nothing to record ('no-changes' / 'disabled'). A landed entry
 * covers the absorbed steps too: the commit's `git add -A` captured their
 * diffs. A failed entry records only this step's debt.
 */
export declare function commitResultToLedgerEntry(result: CommitResult, stepId: string, absorbedStepIds: string[]): MigrateCommitLedgerEntry | null;
