import type { FileChange } from '../../../../generators/tree';
export interface GenericValidationPromptContext {
    package: string;
    name: string;
    version: string;
    description?: string;
    /** Absolute path the agent must write its handoff file to. */
    handoffFileAbsolutePath: string;
    /**
     * Path to the migration's documentation file, if any - workspace-relative,
     * or absolute when it resolves outside the workspace.
     */
    documentationPath?: string;
    /** Context captured from the deterministic generator phase. */
    impl: {
        /** Raw output from the generator (devkit logger + console). */
        logs?: string;
        /**
         * Files the generator changed. Rendered inside `<files_changed>` as a
         * `[TYPE] path` list — only when `hasDiffContext` is false; when true the
         * agent is instead instructed to inspect via git.
         */
        changes: FileChange[];
        /** Strings the generator author put in `agentContext`. */
        agentContext?: string[];
        /**
         * True when per-migration commits are in effect (git repo + commits
         * enabled). The prompt instructs the agent to use `git status`/`git diff`
         * for the file list. When false (no git, or commits disabled), the
         * `<files_changed>` block is embedded with `changes` instead.
         */
        hasDiffContext: boolean;
    };
}
/**
 * Cap on the number of file entries rendered verbatim inside `<files_changed>`
 * when the embedded-list path is used (no per-migration commits / no git).
 * Excess entries collapse into a `… and N more files.` line.
 */
export declare const GENERIC_VALIDATION_FILE_LIST_CAP = 50;
/**
 * Builds the user prompt for the framework-owned generic-validation agent step
 * that runs after a generator-only migration produces changes (when `--validate`
 * is enabled and `--agentic` resolves to an enabled agent).
 *
 * Differences from `buildHybridPromptUserPrompt`:
 * - No `<instructions_file>` block — the framework owns the instructions, and
 *   they live inline in `<validation_instructions>` below.
 * - No `<precedence>` block — there's no external instructions file to defer
 *   to.
 * - File-list cap: when the diff exceeds `GENERIC_VALIDATION_FILE_LIST_CAP`,
 *   the first N entries render verbatim and the remainder collapses into a
 *   `… and N more files.` count line.
 * - The lead sentence frames the agent as a validator, not an applier.
 */
export declare function buildGenericValidationUserPrompt(ctx: GenericValidationPromptContext): string;
