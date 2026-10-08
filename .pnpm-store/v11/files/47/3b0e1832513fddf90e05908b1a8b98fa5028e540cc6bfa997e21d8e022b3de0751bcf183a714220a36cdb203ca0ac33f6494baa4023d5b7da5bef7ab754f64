"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const format_changed_files_1 = require("../../generators/internal-utils/format-changed-files");
const project_configuration_1 = require("../../generators/utils/project-configuration");
const nx_json_1 = require("../../generators/utils/nx-json");
const path_1 = require("path");
const utils_1 = require("../../tasks-runner/utils");
const json_1 = require("../../generators/utils/json");
const target_defaults_1 = require("../utils/target-defaults");
async function default_1(tree) {
    // If the workspace doesn't have a nx.json, don't make any changes
    if (!tree.exists('nx.json')) {
        return;
    }
    const nxJson = (0, nx_json_1.readNxJson)(tree);
    for (const [projectName, project] of (0, project_configuration_1.getProjects)(tree)) {
        for (const [_, target] of Object.entries(project.targets ?? {})) {
            if (!target.outputs) {
                continue;
            }
            target.outputs = (0, utils_1.transformLegacyOutputs)(project.root, target.outputs);
        }
        try {
            (0, project_configuration_1.updateProjectConfiguration)(tree, projectName, project);
        }
        catch {
            if (tree.exists((0, path_1.join)(project.root, 'package.json'))) {
                (0, json_1.updateJson)(tree, (0, path_1.join)(project.root, 'package.json'), (json) => {
                    for (const target of Object.values(json.nx?.targets ?? {})) {
                        if (target.outputs) {
                            target.outputs = (0, utils_1.transformLegacyOutputs)(project.root, target.outputs);
                        }
                    }
                    return json;
                });
            }
        }
    }
    if (nxJson.targetDefaults) {
        // `targetDefaultConfigs` yields the live config block(s) of both value
        // forms (plain object and filtered array), so legacy outputs get prefixed
        // regardless of shape; any `filter` on an array entry is left untouched.
        for (const value of Object.values(nxJson.targetDefaults)) {
            for (const config of (0, target_defaults_1.targetDefaultConfigs)(value)) {
                if (config.outputs) {
                    config.outputs = (0, utils_1.transformLegacyOutputs)('{projectRoot}', config.outputs);
                }
            }
        }
        (0, nx_json_1.updateNxJson)(tree, nxJson);
    }
    await (0, format_changed_files_1.formatChangedFiles)(tree);
}
