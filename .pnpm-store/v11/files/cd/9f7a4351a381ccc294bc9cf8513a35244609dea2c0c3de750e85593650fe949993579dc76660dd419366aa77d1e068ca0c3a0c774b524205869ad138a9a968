import type { MigrationDetailsWithId } from '../../config/misc-interfaces';
import type { FileChange } from '../../generators/tree';
import { isHybridMigration, isPromptOnlyMigration } from './migrate';
export { isPromptOnlyMigration, isHybridMigration };
export type MigrationsJsonMetadata = {
    completedMigrations?: Record<string, SuccessfulMigration | FailedMigration | SkippedMigration | StoppedMigration>;
    runningMigrations?: string[];
    initialGitRef?: {
        ref: string;
        subject: string;
    };
    confirmedPackageUpdates?: boolean;
    targetVersion?: string;
};
export type SuccessfulMigration = {
    type: 'successful';
    name: string;
    changedFiles: Omit<FileChange, 'content'>[];
    ref: string;
    nextSteps?: string[];
    acknowledgedPrompt?: boolean;
    skipAgentic?: boolean;
};
export type FailedMigration = {
    type: 'failed';
    name: string;
    error: string;
};
export type SkippedMigration = {
    type: 'skipped';
};
export type StoppedMigration = {
    type: 'stopped';
    name: string;
    error: string;
};
export declare function recordInitialMigrationMetadata(workspacePath: string, versionToMigrateTo: string): void;
export declare function finishMigrationProcess(workspacePath: string, squashCommits: boolean, commitMessage: string): void;
export declare function runSingleMigration(workspacePath: string, migration: MigrationDetailsWithId, configuration: {
    createCommits: boolean;
    commitPrefix?: string;
}): Promise<void>;
export declare function getImplementationPath(workspacePath: string, migration: MigrationDetailsWithId): Promise<string>;
export declare function modifyMigrationsJsonMetadata(workspacePath: string, modify: (migrationsJsonMetadata: MigrationsJsonMetadata) => MigrationsJsonMetadata): void;
export declare function addSuccessfulMigration(id: string, fileChanges: Omit<FileChange, 'content'>[], ref: string, nextSteps: string[], skipAgentic?: boolean): (migrationsJsonMetadata: MigrationsJsonMetadata) => MigrationsJsonMetadata;
export declare function updateRefForSuccessfulMigration(id: string, ref: string): (migrationsJsonMetadata: MigrationsJsonMetadata) => MigrationsJsonMetadata;
export declare function addFailedMigration(id: string, error: string): (migrationsJsonMetadata: MigrationsJsonMetadata) => {
    completedMigrations?: Record<string, SuccessfulMigration | FailedMigration | SkippedMigration | StoppedMigration>;
    runningMigrations?: string[];
    initialGitRef?: {
        ref: string;
        subject: string;
    };
    confirmedPackageUpdates?: boolean;
    targetVersion?: string;
};
export declare function addSkippedMigration(id: string): (migrationsJsonMetadata: MigrationsJsonMetadata) => {
    completedMigrations?: Record<string, SuccessfulMigration | FailedMigration | SkippedMigration | StoppedMigration>;
    runningMigrations?: string[];
    initialGitRef?: {
        ref: string;
        subject: string;
    };
    confirmedPackageUpdates?: boolean;
    targetVersion?: string;
};
export declare function addStoppedMigration(id: string, error: string): (migrationsJsonMetadata: MigrationsJsonMetadata) => {
    completedMigrations?: Record<string, SuccessfulMigration | FailedMigration | SkippedMigration | StoppedMigration>;
    runningMigrations?: string[];
    initialGitRef?: {
        ref: string;
        subject: string;
    };
    confirmedPackageUpdates?: boolean;
    targetVersion?: string;
};
export declare function readMigrationsJsonMetadata(workspacePath: string): MigrationsJsonMetadata;
export declare function undoMigration(workspacePath: string, id: string): (migrationsJsonMetadata: MigrationsJsonMetadata) => MigrationsJsonMetadata;
/**
 * Records that the user has confirmed completion of a prompt-bearing
 * migration's AI prompt phase. Dispatches by shape so callers (the webview
 * event handler in Nx Console) don't need to know which is which:
 *  - prompt-only: records success directly (no spawn, no process lifecycle).
 *  - hybrid: persists the `acknowledgedPrompt` flag on the existing
 *    successful record from the generator phase.
 */
export declare function acknowledgeMigrationPrompt(workspacePath: string, migration: MigrationDetailsWithId): void;
export declare function killMigrationProcess(migrationId: string, workspacePath?: string): boolean;
export declare function stopMigration(migrationId: string): (migrationsJsonMetadata: MigrationsJsonMetadata) => MigrationsJsonMetadata;
