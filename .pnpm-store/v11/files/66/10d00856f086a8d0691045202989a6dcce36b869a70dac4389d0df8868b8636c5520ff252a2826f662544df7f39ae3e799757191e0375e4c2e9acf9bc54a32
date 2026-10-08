"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAnalyticsPreferenceSet = ensureAnalyticsPreferenceSet;
exports.promptForAnalyticsPreference = promptForAnalyticsPreference;
const fs_1 = require("fs");
const prompt_helpers_1 = require("./prompt-helpers");
const path_1 = require("path");
const output_1 = require("./output");
const is_ci_1 = require("./is-ci");
const nx_json_1 = require("../config/nx-json");
const fileutils_1 = require("./fileutils");
const write_formatted_json_file_1 = require("./write-formatted-json-file");
const workspace_root_1 = require("./workspace-root");
/**
 * Prompts for analytics preference if not already set in nx.json, persists the
 * answer so later commands don't re-ask, and returns it for telemetry. Returns
 * 'unset' when not prompted (CI / non-interactive / no nx.json). `nx init`
 * passes its own root + interactive flag; the default call (bin/nx.ts) derives
 * interactive from the TTY.
 */
async function ensureAnalyticsPreferenceSet(root = workspace_root_1.workspaceRoot, interactive = !!(process.stdin.isTTY && process.stdout.isTTY)) {
    if (!interactive || (0, is_ci_1.isCI)()) {
        return 'unset';
    }
    // Only prompt inside a workspace that has nx.json — avoid creating
    // nx.json in arbitrary directories (e.g. when running cloud commands
    // outside a workspace).
    if (!(0, fs_1.existsSync)((0, path_1.join)(root, 'nx.json'))) {
        return 'unset';
    }
    const nxJson = (0, nx_json_1.readNxJson)(root);
    // Already chosen (true = enabled, false = disabled) — report it.
    if (typeof nxJson?.analytics === 'boolean') {
        return nxJson.analytics ? 'yes' : 'no';
    }
    const enabled = await promptForAnalyticsPreference();
    await saveAnalyticsPreference(root, enabled);
    return enabled ? 'yes' : 'no';
}
async function promptForAnalyticsPreference() {
    try {
        output_1.output.log({
            title: 'Help improve Nx by sharing usage data',
            bodyLines: [
                'Nx collects usage analytics to help improve the developer experience.',
                'No project-specific information is collected.',
                'Learn more: https://cloud.nx.app/privacy',
            ],
        });
        return await (0, prompt_helpers_1.confirmationPrompt)({
            message: 'Share usage data with the Nx team?',
            // Cancelling is a decline, not a failure.
            onCancel: () => false,
        });
    }
    catch {
        return false;
    }
}
async function saveAnalyticsPreference(root, enabled) {
    try {
        const nxJsonPath = (0, path_1.join)(root, 'nx.json');
        const nxJson = (0, fileutils_1.readJsonFile)(nxJsonPath);
        nxJson.analytics = enabled;
        await (0, write_formatted_json_file_1.writeFormattedJsonFile)(nxJsonPath, nxJson);
        if (enabled) {
            output_1.output.success({ title: 'Thank you for helping improve Nx!' });
        }
        else {
            output_1.output.log({
                title: 'Analytics disabled.',
                bodyLines: [
                    'You can change this anytime by setting "analytics" in nx.json.',
                ],
            });
        }
    }
    catch {
        // Silently fail - don't block user's command
    }
}
