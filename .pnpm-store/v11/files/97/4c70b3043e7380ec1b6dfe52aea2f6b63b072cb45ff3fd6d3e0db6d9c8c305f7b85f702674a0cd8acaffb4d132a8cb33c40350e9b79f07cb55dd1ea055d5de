"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NX_ALLOWLIST_ROOTS = exports.nxMcpTomlHeader = exports.analyticsDomain = exports.getAgentRulesWrapped = exports.rulesRegex = exports.nxRulesMarkerCommentEnd = exports.nxRulesMarkerCommentDescription = exports.nxRulesMarkerCommentStart = void 0;
exports.agentsMdPath = agentsMdPath;
exports.geminiMdPath = geminiMdPath;
exports.parseGeminiSettings = parseGeminiSettings;
exports.geminiSettingsPath = geminiSettingsPath;
exports.claudeMdPath = claudeMdPath;
exports.claudeMcpJsonPath = claudeMcpJsonPath;
exports.opencodeMcpPath = opencodeMcpPath;
exports.codexConfigTomlPath = codexConfigTomlPath;
exports.getNxMcpTomlConfig = getNxMcpTomlConfig;
const path_1 = require("path");
const semver_1 = require("semver");
const fileutils_1 = require("../utils/fileutils");
const nx_tmp_dir_1 = require("../utils/nx-tmp-dir");
const get_agent_rules_1 = require("./set-up-ai-agents/get-agent-rules");
function agentsMdPath(root) {
    return (0, path_1.join)(root, 'AGENTS.md');
}
function geminiMdPath(root) {
    return (0, path_1.join)(root, 'GEMINI.md');
}
function parseGeminiSettings(root) {
    const settingsPath = geminiSettingsPath(root);
    try {
        return (0, fileutils_1.readJsonFile)(settingsPath);
    }
    catch {
        return undefined;
    }
}
function geminiSettingsPath(root) {
    return (0, path_1.join)(root, '.gemini', 'settings.json');
}
function claudeMdPath(root) {
    return (0, path_1.join)(root, 'CLAUDE.md');
}
function claudeMcpJsonPath(root) {
    return (0, path_1.join)(root, '.mcp.json');
}
function opencodeMcpPath(root) {
    return (0, path_1.join)(root, 'opencode.json');
}
function codexConfigTomlPath(root) {
    return (0, path_1.join)(root, '.codex', 'config.toml');
}
exports.nxRulesMarkerCommentStart = `<!-- nx configuration start-->`;
exports.nxRulesMarkerCommentDescription = `<!-- Leave the start & end comments to automatically receive updates. -->`;
exports.nxRulesMarkerCommentEnd = `<!-- nx configuration end-->`;
exports.rulesRegex = new RegExp(`${exports.nxRulesMarkerCommentStart}[\\s\\S]*?${exports.nxRulesMarkerCommentEnd}`, 'm');
const getAgentRulesWrapped = (options) => {
    const { writeNxCloudRules, useH1 = true } = options;
    const agentRulesString = (0, get_agent_rules_1.getAgentRules)({ nxCloud: writeNxCloudRules, useH1 });
    return `${exports.nxRulesMarkerCommentStart}\n${exports.nxRulesMarkerCommentDescription}\n\n${agentRulesString}\n\n${exports.nxRulesMarkerCommentEnd}`;
};
exports.getAgentRulesWrapped = getAgentRulesWrapped;
/**
 * Hostname Nx analytics events are sent to (GA4 Measurement Protocol).
 * Must stay in sync with GA_ENDPOINT in packages/nx/src/native/telemetry/constants.rs.
 */
exports.analyticsDomain = 'www.google-analytics.com';
exports.nxMcpTomlHeader = `[mcp_servers."nx-mcp"]`;
/**
 * Get the MCP TOML configuration based on the Nx version.
 * For Nx 22+, uses 'nx mcp'
 * For Nx < 22, uses 'nx-mcp'
 */
function getNxMcpTomlConfig(nxVersion) {
    const majorVersion = (0, semver_1.major)(nxVersion);
    const args = majorVersion >= 22 ? '["nx", "mcp"]' : '["nx-mcp"]';
    return `${exports.nxMcpTomlHeader}
type = "stdio"
command = "npx"
args = ${args}
`;
}
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
exports.NX_ALLOWLIST_ROOTS = [nx_tmp_dir_1.NX_TMP_DIR_POSIX, '~/.nx'];
