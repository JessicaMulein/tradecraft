"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAgentic = resolveAgentic;
exports.resolveShouldRunValidation = resolveShouldRunValidation;
const fs_1 = require("fs");
const jsonc_parser_1 = require("jsonc-parser");
const path_1 = require("path");
const output_1 = require("../../../utils/output");
const workspace_root_1 = require("../../../utils/workspace-root");
const migrate_analytics_1 = require("../migrate-analytics");
const safe_prompt_1 = require("../safe-prompt");
const detect_installed_1 = require("./detect-installed");
const inception_1 = require("./inception");
const definitions_1 = require("./definitions");
const INSTALL_SUPPORTED_AGENTS_HINT = [
    'Install one of the supported agents and re-run the migration:',
    ...definitions_1.AGENT_DEFINITIONS.map((def) => `  - ${def.displayName}`),
];
/**
 * Callers resolve this once per run-phase invocation and reuse the result for
 * every migration it covers.
 */
async function resolveAgentic(input) {
    if ((0, inception_1.isInsideAgent)()) {
        output_1.output.log({
            title: input.agentic === true || typeof input.agentic === 'string'
                ? 'Agentic flow skipped: nx detected this run is invoked from inside an AI agent — the outer agent drives the migration. The explicit --agentic flag is ignored in this context.'
                : 'Agentic flow skipped: nx detected this run is invoked from inside an AI agent.',
        });
        return { kind: 'inside-agent' };
    }
    const isInteractive = !!process.stdin.isTTY &&
        !!process.stdout.isTTY &&
        input.interactive !== false;
    // Skip detection for the one case where the result is unused: explicit
    // `--agentic=false`. For every other path (explicit enable, explicit id, or
    // undefined-with-prompt) we either need the detection result to pick/verify
    // an agent or to decide whether the up-front prompt is even worth asking.
    if (input.agentic === false) {
        return { kind: 'disabled' };
    }
    const detected = await (0, detect_installed_1.detectInstalledAgents)(definitions_1.AGENT_DEFINITIONS);
    const { enabled, explicitId, persist } = await resolveFlag(input, isInteractive, detected);
    if (!enabled) {
        if (persist === false) {
            persistAgenticChoice(false);
        }
        return { kind: 'disabled' };
    }
    const selected = await selectAgent(detected, explicitId, isInteractive);
    if (persist === true) {
        persistAgenticChoice(true);
    }
    else if (persist === 'pin') {
        persistAgenticChoice(selected.id);
    }
    return { kind: 'enabled', selectedAgent: selected };
}
/**
 * No warning when `--validate` is passed with the agentic flow off: validation
 * requires an active agent session by definition.
 */
function resolveShouldRunValidation(args) {
    return args.validate !== false && args.agenticKind === 'enabled';
}
async function resolveFlag(input, isInteractive, detected) {
    if (input.agentic === true) {
        if (!isInteractive) {
            warnAgenticInteractiveOnly();
            return { enabled: false };
        }
        return { enabled: true };
    }
    if (typeof input.agentic === 'string') {
        if (!isInteractive) {
            warnAgenticInteractiveOnly();
            return { enabled: false };
        }
        return { enabled: true, explicitId: input.agentic };
    }
    // undefined — fire the up-front prompt only when we have a TTY, something
    // agentic-eligible is queued, and at least one agent is installed. Without
    // an installed agent the user can't say "Yes" meaningfully — asking would
    // walk them into a dead end.
    if (!isInteractive) {
        return { enabled: false };
    }
    if (!input.migrations.some((m) => !!m.prompt)) {
        return { enabled: false };
    }
    if (detected.length === 0) {
        return { enabled: false };
    }
    return firePromptForAgentic(input.migrations, detected);
}
function requireInteractiveOrAbort(isInteractive) {
    if (isInteractive)
        return;
    output_1.output.error({
        title: 'The agentic flow is interactive-only in this release.',
        bodyLines: [
            'Re-run in an interactive terminal, or pass `--agentic=false` to skip the agentic flow.',
        ],
    });
    throw new Error('Agentic flow requires an interactive terminal.');
}
function warnAgenticInteractiveOnly() {
    output_1.output.warn({
        title: 'Skipping the agentic flow: it is interactive-only in this release and this run is non-interactive.',
        bodyLines: [
            'Continuing the migration without the agentic flow. Re-run in an interactive terminal to use it.',
        ],
    });
}
async function firePromptForAgentic(migrations, detected) {
    // The apply hint assumes at least one prompt-bearing migration is queued. If
    // we later extend the prompt to fire for generator-only runs (validation-
    // only), the hint needs to branch.
    const promptCount = migrations.filter((m) => !!m.prompt).length;
    const applyHint = `Apply ${promptCount} prompt migration${promptCount === 1 ? '' : 's'} and validate generator output with an AI agent`;
    const skipHint = `Skip prompts and run generators without AI validation`;
    const rememberHint = `Saved to nx.json so Nx won't ask again`;
    // The pin-vs-flexible distinction only matters when more than one agent is
    // installed. With a single agent, "always" simply persists `true` and the
    // pin option is dropped.
    const multipleAgents = detected.length > 1;
    const pinChoice = multipleAgents
        ? [
            {
                value: 'yes-pin',
                label: 'Yes, always with the same agent',
                hint: rememberHint,
            },
        ]
        : [];
    const choices = [
        {
            value: 'yes-once',
            label: 'Yes, just this time',
            hint: applyHint,
        },
        {
            value: 'yes-flex',
            label: multipleAgents
                ? "Yes, always (I'll pick the agent each run)"
                : 'Yes, always',
            hint: rememberHint,
        },
        ...pinChoice,
        { value: 'no-once', label: 'No, just this time', hint: skipHint },
        { value: 'no-never', label: 'No, never', hint: rememberHint },
    ];
    // Blank line keeps the prompt from gluing to the previous `npm install`
    // output or any earlier orchestrator line.
    console.log();
    // Each choice's hint renders beside it, so the description no longer needs a
    // footer that tracks the cursor.
    const choice = await (0, safe_prompt_1.migrateChoice)({
        message: 'Enable the agentic flow?',
        choices,
    });
    (0, migrate_analytics_1.reportMigratePrompt)('agentic', choice);
    switch (choice) {
        case 'yes-once':
            return { enabled: true };
        case 'yes-flex':
            return { enabled: true, persist: true };
        case 'yes-pin':
            return { enabled: true, persist: 'pin' };
        case 'no-never':
            return { enabled: false, persist: false };
        case 'no-once':
        default:
            return { enabled: false };
    }
}
// Persists the user's agentic choice to `nx.json` so the up-front prompt is
// skipped on future runs. Edits the raw file in place via jsonc-parser, so it
// touches only the `migrate.agentic` key and preserves comments, formatting,
// and any `extends` preset (the prompt fires mid-migration, so a silent
// reformat would be surprising). Never throws - a failed write only costs the
// user the prompt again next time.
function persistAgenticChoice(value) {
    const nxJsonPath = (0, path_1.join)(workspace_root_1.workspaceRoot, 'nx.json');
    if (!(0, fs_1.existsSync)(nxJsonPath)) {
        output_1.output.warn({
            title: `Could not save your agentic choice: no nx.json found at the workspace root.`,
        });
        return;
    }
    try {
        const content = (0, fs_1.readFileSync)(nxJsonPath, 'utf-8');
        const edits = (0, jsonc_parser_1.modify)(content, ['migrate', 'agentic'], value, {
            formattingOptions: { insertSpaces: true, tabSize: 2 },
        });
        (0, fs_1.writeFileSync)(nxJsonPath, (0, jsonc_parser_1.applyEdits)(content, edits));
        output_1.output.log({
            title: `Saved your choice to nx.json (migrate.agentic = ${JSON.stringify(value)}). Nx won't ask again.`,
        });
    }
    catch (e) {
        output_1.output.warn({
            title: `Could not save your agentic choice to nx.json: ${e instanceof Error ? e.message : String(e)}`,
        });
    }
}
async function selectAgent(detected, explicitId, isInteractive) {
    if (explicitId) {
        const match = detected.find((d) => d.id === explicitId);
        if (match) {
            return match;
        }
        // The requested agent isn't installed. Rather than aborting the migration,
        // warn and fall through to resolve from the agents that ARE installed
        // (pick when 2+, auto-select the only one, error only when none exist).
        if (detected.length > 0) {
            output_1.output.warn({
                title: `The requested agent "${explicitId}" is not installed; using the installed agent(s) instead.`,
                bodyLines: [
                    'Currently installed agents:',
                    ...detected.map((d) => `  - ${d.displayName} (${d.id})`),
                ],
            });
        }
    }
    if (detected.length === 0) {
        output_1.output.error({
            title: 'Agentic flow was enabled, but no supported AI agent is installed on this machine.',
            bodyLines: INSTALL_SUPPORTED_AGENTS_HINT,
        });
        throw new Error('No installed AI agent available.');
    }
    if (detected.length === 1) {
        const only = detected[0];
        output_1.output.log({
            title: `Using ${only.displayName} for the agentic flow.`,
        });
        return only;
    }
    // 2+ detected. The picker only fires interactively. We've already required
    // a TTY before resolving an enabled state, so this is defense-in-depth.
    requireInteractiveOrAbort(isInteractive);
    // Blank line keeps the prompt from gluing to the preceding output.
    console.log();
    const id = await (0, safe_prompt_1.migrateChoice)({
        message: 'Multiple AI agents detected. Which one should Nx use?',
        choices: detected.map((d) => ({ value: d.id, label: d.displayName })),
    });
    (0, migrate_analytics_1.reportMigratePrompt)('agent_select', id);
    return detected.find((d) => d.id === id);
}
