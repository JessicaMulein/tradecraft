export declare const supportedAgents: readonly ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'opencode'];
export type Agent = (typeof supportedAgents)[number];
export declare const agentDisplayMap: Record<Agent, string>;
export type AgentConfiguration = {
    name: Agent;
    displayName: string;
    rules: boolean;
    mcp: boolean;
    rulesPath: string;
    mcpPath: string | null;
    outdated: boolean;
    disabled?: boolean;
};
export declare function getAgentConfigurations(agentsToConsider: Agent[], workspaceRoot: string): Promise<{
    nonConfiguredAgents: AgentConfiguration[];
    partiallyConfiguredAgents: AgentConfiguration[];
    fullyConfiguredAgents: AgentConfiguration[];
    disabledAgents: AgentConfiguration[];
}>;
export declare function configureAgents(agents: Agent[], workspaceRoot: string, useLatest?: boolean): Promise<void>;
/**
 * Explains a permission error thrown while writing agent configuration files.
 *
 * The errno alone does not identify the cause. Agent harnesses (e.g. Claude
 * Code) deny writes to their own settings files from sandboxed shell commands,
 * so `nx configure-ai-agents` run through an agent's bash tool fails with EPERM
 * where the same command succeeds in a terminal — but a root-owned
 * `.claude/settings.json` left by an earlier `sudo nx`, or a read-only
 * checkout, produces the same errno with an unrelated remedy. The sandbox
 * explanation is therefore only offered where a sandbox or an agent is
 * actually detected, and the underlying message is kept either way.
 */
export declare function agentConfigWriteBlockedLines(error: unknown): string[];
