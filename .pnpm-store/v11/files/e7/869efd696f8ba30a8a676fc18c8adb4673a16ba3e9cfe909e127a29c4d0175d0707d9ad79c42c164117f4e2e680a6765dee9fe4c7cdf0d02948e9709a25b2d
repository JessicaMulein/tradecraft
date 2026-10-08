export type AgenticPromptMode = 'author' | 'generic-validation';
export interface SystemPromptContext {
    workspaceRoot: string;
    handoffFileAbsolutePath: string;
    /**
     * Package manager used by the workspace (`npm`, `pnpm`, `yarn`, `bun`).
     * Surfaced to the agent so it doesn't fall back to its own default — e.g.
     * codex would otherwise reach for `pnpm` even in npm workspaces.
     */
    packageManager: string;
    /**
     * Concrete command the agent should use to invoke nx in this workspace —
     * e.g. `npx nx`, `pnpm exec nx`, `./nx` (encapsulated install). Passed in
     * explicitly because the right form depends on both the package manager
     * (`npm nx …` doesn't work) and whether the workspace has a root
     * `package.json` (encapsulated installs use `./nx` / `.\nx.bat`).
     */
    nxInvocation: string;
    /**
     * Which scope rules to emit:
     * - `author`: the agent is running an author-provided prompt (prompt-only or
     *   hybrid migration). Constraints favor strict no-mutation outside what the
     *   prompt asks for.
     * - `generic-validation`: the agent is running framework-owned validation of
     *   a generator's output. Constraints allow scoped task execution and minor
     *   in-scope fixes.
     *
     * Defaults to `author` so existing call sites remain unchanged.
     */
    mode?: AgenticPromptMode;
}
/**
 * Builds the agent-agnostic system prompt used for all prompt-migration steps.
 *
 * The handoff-file contract is part of the system prompt rather than the user
 * prompt because it must hold across the whole session — the agent should write
 * the handoff file whether the very first turn succeeded or the user redirected
 * mid-conversation.
 *
 * Structure: XML tags wrap each section so the agent can unambiguously
 * separate role, paths, the handoff contract, and the scope rules. Both
 * Anthropic and OpenAI prompt-engineering guidance recommends XML for
 * multi-section prompts; the conventions used here are snake_case tag names
 * with markdown allowed for inline content.
 */
export declare function buildSystemPrompt(ctx: SystemPromptContext): string;
