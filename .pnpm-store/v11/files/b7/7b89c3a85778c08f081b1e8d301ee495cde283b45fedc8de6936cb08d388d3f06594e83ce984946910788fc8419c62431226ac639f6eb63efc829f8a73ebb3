import { FileChange } from '../../../generators/tree';
import { AgenticPromptMode } from './prompts/system-prompt';
import { EnabledResolvedAgentic } from './types';
/**
 * Context describing the deterministic (generator) half of a migration, used
 * to seed the agent's prompt with what just ran. Required for hybrid prompt
 * migrations (`buildHybridPromptUserPrompt`) and for generic-validation runs.
 */
export interface AgenticPromptImplContext {
    logs: string;
    changes: FileChange[];
    agentContext: string[];
    hasDiffContext: boolean;
}
export interface AgenticStepResult {
    /** Agent's handoff summary, or a placeholder when the user marked complete. */
    summary: string;
    /**
     * True when the agent didn't write a valid handoff and the user told nx to
     * continue anyway. The caller uses this to swap the outcome label
     * accordingly.
     */
    ambiguous: boolean;
}
/**
 * `runStep` travels in the context rather than being imported by its call
 * sites, so this module loads only where the context is built, behind an
 * agentic-enabled gate.
 */
export interface AgenticRunContext {
    agentic: EnabledResolvedAgentic;
    runDir: string;
    runStep: typeof runAgenticPromptStep;
}
export interface RunAgenticPromptStepInput {
    root: string;
    migration: {
        package: string;
        name: string;
        version: string;
        description?: string;
        prompt?: string;
    };
    /**
     * Path to the migration's documentation file, resolved by the orchestrator -
     * workspace-relative, or absolute when the file resolves outside the
     * workspace. Omitted when the migration declares no `documentation` or it
     * can't be resolved.
     */
    documentationPath?: string;
    agentic: EnabledResolvedAgentic;
    runDir: string;
    installDepsIfChanged: () => Promise<void>;
    implContext?: AgenticPromptImplContext;
    mode?: AgenticPromptMode;
}
/**
 * Spawns the configured AI agent against a migration step, awaits its handoff,
 * and translates the outcome into a structured result the executor can branch
 * on. Throws on failure / abort; returns a result with `ambiguous` set when
 * the agent exited without writing a handoff and the user chose to continue.
 *
 * `installDepsIfChanged` is a callback rather than a `ChangedDepInstaller`
 * instance so this module stays decoupled from the executor's internal state.
 * The structural `migration` type captures only the fields read here, keeping
 * the file free of cross-imports with the orchestrator.
 */
export declare function runAgenticPromptStep(input: RunAgenticPromptStepInput): Promise<AgenticStepResult>;
