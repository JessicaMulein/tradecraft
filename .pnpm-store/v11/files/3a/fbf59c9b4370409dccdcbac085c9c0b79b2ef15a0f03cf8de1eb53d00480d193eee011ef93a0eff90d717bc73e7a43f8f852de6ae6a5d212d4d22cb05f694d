import { type StepAction } from './state-machine';
import { type PlannedMigration } from '../migration-shape';
export interface RunOrchestratorInitInput {
    root: string;
    migrationsJson: {
        migrations?: PlannedMigration[];
        [k: string]: unknown;
    };
    createCommits: boolean;
    commitPrefix: string;
    skipInstall: boolean;
    installedNxVersion: string;
}
export interface RunOrchestratorReconcileInput {
    root: string;
    runId: string;
    stepAction?: StepAction;
}
export declare function runOrchestratorInit(input: RunOrchestratorInitInput): Promise<void>;
export declare function runOrchestratorReconcile(input: RunOrchestratorReconcileInput): Promise<void>;
