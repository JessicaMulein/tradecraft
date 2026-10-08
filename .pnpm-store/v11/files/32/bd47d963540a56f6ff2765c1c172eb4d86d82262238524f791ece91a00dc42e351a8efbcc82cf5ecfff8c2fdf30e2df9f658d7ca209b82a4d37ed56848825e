"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const project_configuration_1 = require("../../generators/utils/project-configuration");
const format_changed_files_1 = require("../../generators/internal-utils/format-changed-files");
const target_defaults_1 = require("../utils/target-defaults");
async function default_1(tree) {
    updateDependsOnAndInputsInsideNxJson(tree);
    const projectsConfigurations = (0, project_configuration_1.getProjects)(tree);
    for (const [projectName, projectConfiguration] of projectsConfigurations) {
        let projectChanged = false;
        for (const targetConfiguration of Object.values(projectConfiguration.targets ?? {})) {
            // Don't use `||=` — it would short-circuit the rewrite once one target
            // has already changed, leaving later targets untouched.
            if (rewriteTokensInBlock(targetConfiguration)) {
                projectChanged = true;
            }
        }
        if (projectChanged) {
            (0, project_configuration_1.updateProjectConfiguration)(tree, projectName, projectConfiguration);
        }
    }
    await (0, format_changed_files_1.formatChangedFiles)(tree);
}
function updateDependsOnAndInputsInsideNxJson(tree) {
    const nxJson = (0, project_configuration_1.readNxJson)(tree);
    let nxJsonChanged = false;
    for (const defaults of Object.values(nxJson?.targetDefaults ?? {})) {
        // `nx repair` can't assume migration order, so a default may already be in
        // the filtered array shape; rewrite every config block of either form.
        for (const block of (0, target_defaults_1.targetDefaultConfigs)(defaults)) {
            // Don't use `||=` — it would short-circuit the rewrite once one block
            // has already changed, leaving later blocks untouched.
            if (rewriteTokensInBlock(block)) {
                nxJsonChanged = true;
            }
        }
    }
    if (nxJsonChanged) {
        (0, project_configuration_1.updateNxJson)(tree, nxJson);
    }
}
// Rewrite the legacy `projects: 'self' | 'dependencies'` tokens on a single
// dependsOn/inputs-carrying config block. Returns whether anything changed.
function rewriteTokensInBlock(block) {
    let changed = false;
    for (const dependency of block.dependsOn ?? []) {
        if (typeof dependency !== 'string') {
            if (dependency.projects === 'self' || dependency.projects === '{self}') {
                delete dependency.projects;
                changed = true;
            }
            else if (dependency.projects === 'dependencies' ||
                dependency.projects === '{dependencies}') {
                delete dependency.projects;
                dependency.dependencies = true;
                changed = true;
            }
        }
    }
    for (let i = 0; i < (block.inputs?.length ?? 0); i++) {
        const input = block.inputs[i];
        if (typeof input !== 'string') {
            if ('projects' in input &&
                (input.projects === 'self' || input.projects === '{self}')) {
                delete input.projects;
                changed = true;
            }
            else if ('projects' in input &&
                (input.projects === 'dependencies' ||
                    input.projects === '{dependencies}')) {
                delete input.projects;
                block.inputs[i] = {
                    ...input,
                    dependencies: true,
                };
                changed = true;
            }
        }
    }
    return changed;
}
