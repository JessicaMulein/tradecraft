import type { FileChange } from '../../../../generators/tree';
export interface HybridPromptMigrationContext {
    package: string;
    name: string;
    version: string;
    description?: string;
    /** Workspace-relative path to the prompt `.md` file. */
    promptPath: string;
    /** Absolute path the agent must write its handoff file to. */
    handoffFileAbsolutePath: string;
    /**
     * Path to the migration's documentation file, if any - workspace-relative,
     * or absolute when it resolves outside the workspace.
     */
    documentationPath?: string;
    /** Context captured from the deterministic generator phase. */
    impl?: {
        /** Raw output from the generator (devkit logger + console). */
        logs?: string;
        /**
         * Files the generator changed. Rendered inside `<files_changed>` as a
         * `[TYPE] path` list — only when `hasDiffContext` is false; when true the
         * agent is instead pointed at `git status` / `git diff`.
         */
        changes?: FileChange[];
        /** Strings the generator author put in `agentContext`. */
        agentContext?: string[];
        /**
         * True when per-migration commits are in effect (git repo + commits
         * enabled). The prompt then points the agent at git for the file list;
         * when false (no git or commits disabled), `changes` is embedded.
         */
        hasDiffContext?: boolean;
    };
}
/**
 * Builds the user prompt for a hybrid migration's prompt phase (`implementation`
 * + `prompt`). The deterministic generator has already run; sections of the
 * prompt summarize what it did so the agent can complete the paired step with
 * awareness of the generator's output.
 *
 * Structure: XML tags carry section boundaries; markdown (fenced blocks,
 * bullet lists) sits inside tags for inline structure. This is the
 * multi-section case where both Anthropic and OpenAI guidance most clearly
 * favors XML for unambiguous parsing. Each impl section is omitted when its
 * source is empty so the prompt stays minimal when the generator made no
 * meaningful contribution.
 */
export declare function buildHybridPromptUserPrompt(ctx: HybridPromptMigrationContext): string;
