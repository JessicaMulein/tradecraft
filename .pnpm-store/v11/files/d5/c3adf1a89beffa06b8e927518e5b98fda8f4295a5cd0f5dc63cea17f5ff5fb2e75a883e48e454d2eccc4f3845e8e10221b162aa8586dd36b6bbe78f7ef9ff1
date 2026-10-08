export interface PromptMigrationContext {
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
}
/**
 * Builds the first user-facing message for a prompt-migration step.
 *
 * Keeps the framing short — the heavy lifting (handoff contract, scope rules)
 * already lives in the system prompt; this message just identifies the
 * migration and points at the instructions file.
 *
 * XML tags wrap path values and the migration metadata so the agent does
 * not misread them as headers or prose.
 */
export declare function buildPromptMigrationUserPrompt(ctx: PromptMigrationContext): string;
