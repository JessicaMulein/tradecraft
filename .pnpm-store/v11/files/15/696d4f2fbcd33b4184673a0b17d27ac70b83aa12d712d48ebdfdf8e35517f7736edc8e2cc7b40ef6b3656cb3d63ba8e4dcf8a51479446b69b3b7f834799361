"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_DEFINITIONS = exports.opencodeDefinition = exports.codexDefinition = exports.claudeCodeDefinition = void 0;
exports.getAgentDefinition = getAgentDefinition;
const os_1 = require("os");
const path_1 = require("path");
const types_1 = require("./types");
// --- Claude Code ---------------------------------------------------------
function claudeCodeWellKnownPaths() {
    if (process.platform === 'win32') {
        const home = process.env.USERPROFILE;
        return home ? [(0, path_1.join)(home, '.local', 'bin', 'claude.exe')] : [];
    }
    return [(0, path_1.join)((0, os_1.homedir)(), '.claude', 'local', 'claude')];
}
/**
 * The run directory names Nx will interpolate into a permission rule. A rule
 * is a gitignore pattern, which reads `*?[]\` as syntax, and `--allowedTools`
 * splits its value on commas and spaces, so a name carrying any of those
 * would change what the rule authorizes rather than what it names. Run
 * directory names derive from a migration's own version string, which nothing
 * upstream constrains to this alphabet. The leading character rejects `.`
 * and `..`.
 */
const RULE_SAFE_RUN_DIR_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
/**
 * Pre-authorizes the handoff write. Claude Code's default permission mode
 * asks before a file write it has no allow rule for, so without this every
 * step ends on an approval prompt for Nx's own handoff scratch.
 *
 * The rule reaches one run's handoffs and nothing else. Its own run
 * directory also holds state Nx wrote and reads back, and the sibling
 * directories belong to other runs, including an orchestrated run whose
 * handoffs decide how its steps settle. `Edit` is the only tool name file
 * rules are matched against, and it covers creating the file as well as
 * correcting one already written. Prefix-less patterns resolve against the
 * session cwd, pinned to the workspace root below.
 *
 * Returns null for a name it cannot express, which costs the approval prompt
 * this exists to avoid. That beats widening the rule, and nothing narrower is
 * available: Claude Code has no escape for a literal path.
 */
function claudeCodeHandoffAllowedTools(runDirName) {
    if (!RULE_SAFE_RUN_DIR_NAME.test(runDirName)) {
        return null;
    }
    return `Edit(${types_1.MIGRATE_RUNS_RELATIVE_DIR}/${runDirName}/${types_1.HANDOFFS_DIR_NAME}/**)`;
}
function claudeCodeBuildInteractive(ctx) {
    const allowedTools = claudeCodeHandoffAllowedTools(ctx.runDirName);
    return {
        // `--allowedTools` is variadic (space/comma separated): a positional
        // placed right after its value gets swallowed as another rule. The rules
        // must stay in one comma-joined element with a non-variadic flag
        // (`--system-prompt`) between them and the user prompt.
        args: [
            ...(allowedTools ? ['--allowedTools', allowedTools] : []),
            '--system-prompt',
            ctx.systemContext,
            ctx.userPrompt,
        ],
        cwd: ctx.workspaceRoot,
    };
}
exports.claudeCodeDefinition = {
    id: 'claude-code',
    displayName: 'Claude Code',
    binaryNames: ['claude'],
    wellKnownPaths: claudeCodeWellKnownPaths,
    buildInteractive: claudeCodeBuildInteractive,
};
// --- OpenAI Codex --------------------------------------------------------
function codexWellKnownPaths() {
    return [];
}
// No handoff permission flag: codex's default sandbox already allows writes
// inside the cwd tree without prompting, and a user-hardened read-only config
// is a deliberate choice we don't override.
function codexBuildInteractive(ctx) {
    return {
        args: ['-c', `developer_instructions=${ctx.systemContext}`, ctx.userPrompt],
        cwd: ctx.workspaceRoot,
    };
}
exports.codexDefinition = {
    id: 'codex',
    displayName: 'OpenAI Codex',
    binaryNames: ['codex'],
    wellKnownPaths: codexWellKnownPaths,
    buildInteractive: codexBuildInteractive,
};
// --- OpenCode ------------------------------------------------------------
const OPENCODE_TRANSIENT_AGENT_NAME = 'nx-migrate';
function opencodeWellKnownPaths() {
    if (process.platform === 'win32') {
        return [];
    }
    const candidates = [];
    const home = (0, os_1.homedir)();
    const installDir = process.env.OPENCODE_INSTALL_DIR;
    const xdgBinDir = process.env.XDG_BIN_DIR;
    if (installDir) {
        candidates.push((0, path_1.join)(installDir, 'opencode'));
    }
    if (xdgBinDir) {
        candidates.push((0, path_1.join)(xdgBinDir, 'opencode'));
    }
    candidates.push((0, path_1.join)(home, 'bin', 'opencode'));
    candidates.push((0, path_1.join)(home, '.opencode', 'bin', 'opencode'));
    return candidates;
}
// No handoff permission config: opencode's `edit` permission defaults to
// allow, and injecting one would clobber (not merge with) a user's own
// permission patterns.
function opencodeBuildInteractive(ctx) {
    const config = {
        agent: {
            [OPENCODE_TRANSIENT_AGENT_NAME]: { prompt: ctx.systemContext },
        },
    };
    return {
        args: [
            '--agent',
            OPENCODE_TRANSIENT_AGENT_NAME,
            '--prompt',
            ctx.userPrompt,
        ],
        env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
        cwd: ctx.workspaceRoot,
    };
}
exports.opencodeDefinition = {
    id: 'opencode',
    displayName: 'OpenCode',
    binaryNames: ['opencode'],
    wellKnownPaths: opencodeWellKnownPaths,
    buildInteractive: opencodeBuildInteractive,
};
// --- Registry ------------------------------------------------------------
exports.AGENT_DEFINITIONS = [
    exports.claudeCodeDefinition,
    exports.codexDefinition,
    exports.opencodeDefinition,
];
const byId = new Map(exports.AGENT_DEFINITIONS.map((definition) => [definition.id, definition]));
function getAgentDefinition(id) {
    return byId.get(id);
}
