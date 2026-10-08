import { type AgenticArg } from '../agentic/select';
export interface RunSingleMigrationWorkerInput {
    root: string;
    runMigration: string;
    runId?: string;
    /** The raw `--agentic` value; resolved here against the environment. */
    agentic: AgenticArg;
    validate: boolean | undefined;
    /** The requested value; the effective value is resolved here against the agentic kind. */
    createCommits: boolean | undefined;
    commitPrefix: string;
    interactive: boolean | undefined;
    skipInstall: boolean;
    isVerbose: boolean;
}
export declare function runSingleMigrationWorker(input: RunSingleMigrationWorkerInput): Promise<void>;
