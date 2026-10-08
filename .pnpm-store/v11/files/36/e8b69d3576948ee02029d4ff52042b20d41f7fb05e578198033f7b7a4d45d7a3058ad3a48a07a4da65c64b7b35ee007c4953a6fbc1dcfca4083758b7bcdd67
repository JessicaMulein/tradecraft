import { AgentRulesOptions } from './set-up-ai-agents/get-agent-rules';
export type { AgentRulesOptions };
export declare function agentsMdPath(root: string): string;
export declare function geminiMdPath(root: string): string;
export declare function parseGeminiSettings(root: string): any | undefined;
export declare function geminiSettingsPath(root: string): string;
export declare function claudeMdPath(root: string): string;
export declare function claudeMcpJsonPath(root: string): string;
export declare function opencodeMcpPath(root: string): string;
export declare function codexConfigTomlPath(root: string): string;
export declare const nxRulesMarkerCommentStart = "<!-- nx configuration start-->";
export declare const nxRulesMarkerCommentDescription = "<!-- Leave the start & end comments to automatically receive updates. -->";
export declare const nxRulesMarkerCommentEnd = "<!-- nx configuration end-->";
export declare const rulesRegex: RegExp;
export interface AgentRulesWrappedOptions {
    writeNxCloudRules: boolean;
    useH1?: boolean;
}
export declare const getAgentRulesWrapped: (options: AgentRulesWrappedOptions) => string;
/**
 * Hostname Nx analytics events are sent to (GA4 Measurement Protocol).
 * Must stay in sync with GA_ENDPOINT in packages/nx/src/native/telemetry/constants.rs.
 */
export declare const analyticsDomain = "www.google-analytics.com";
export declare const nxMcpTomlHeader = "[mcp_servers.\"nx-mcp\"]";
/**
 * Get the MCP TOML configuration based on the Nx version.
 * For Nx 22+, uses 'nx mcp'
 * For Nx < 22, uses 'nx-mcp'
 */
export declare function getNxMcpTomlConfig(nxVersion: string): string;
/**
 * The Nx runtime roots as they belong in a *committed* sandbox allowlist.
 *
 * `~/.nx` is the literal tilde rather than an expanded `NX_HOME_TMP_DIR`: the
 * sandbox expands it per user, which is the property that makes the entry worth
 * committing at all. An absolute home would pin the file to whoever ran the
 * generator.
 *
 * Both are listed because socket resolution walks a chain — `/tmp/.nx` first,
 * `~/.nx` when a peer already owns the shared container. Allowing only the first
 * leaves every user on a machine where someone else got there first silently
 * uncovered. Windows resolves `NX_TMP_DIR` to a machine-specific `%TMP%` and has
 * no sandbox to configure, so the POSIX root is the one that belongs here.
 */
export declare const NX_ALLOWLIST_ROOTS: readonly ["/tmp/.nx", '~/.nx'];
