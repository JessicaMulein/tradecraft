"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executors = void 0;
exports.default = default_1;
const internal_1 = require("@nx/devkit/internal");
const devkit_1 = require("@nx/devkit");
exports.executors = ['@nx/js:swc', '@nx/js:tsc'];
async function default_1(tree) {
    // update options from project configs
    exports.executors.forEach((executor) => {
        (0, internal_1.forEachExecutorOptions)(tree, executor, (options, project, target, configuration) => {
            if (options.external === undefined &&
                options.externalBuildTargets === undefined) {
                return;
            }
            const projectConfiguration = (0, devkit_1.readProjectConfiguration)(tree, project);
            if (configuration) {
                const config = projectConfiguration.targets[target].configurations[configuration];
                delete config.external;
                delete config.externalBuildTargets;
            }
            else {
                const config = projectConfiguration.targets[target].options;
                delete config.external;
                delete config.externalBuildTargets;
                if (!Object.keys(config).length) {
                    delete projectConfiguration.targets[target].options;
                }
            }
            (0, devkit_1.updateProjectConfiguration)(tree, project, projectConfiguration);
        });
    });
    // update options from nx.json target defaults
    const nxJson = (0, devkit_1.readNxJson)(tree);
    if (!nxJson.targetDefaults) {
        return;
    }
    const cleanEntry = (entry) => {
        if (entry.options) {
            delete entry.options.external;
            delete entry.options.externalBuildTargets;
            if (!Object.keys(entry.options).length) {
                delete entry.options;
            }
        }
        Object.values(entry.configurations ?? {}).forEach((config) => {
            delete config.external;
            delete config.externalBuildTargets;
        });
    };
    const targetDefaults = nxJson.targetDefaults;
    for (const key of Object.keys(targetDefaults)) {
        const value = targetDefaults[key];
        const entries = Array.isArray(value)
            ? value
            : [value];
        const usesExecutor = (entry) => exports.executors.includes(key) ||
            exports.executors.includes(entry.executor) ||
            exports.executors.includes(entry.filter?.executor);
        const kept = entries.filter((entry) => {
            if (usesExecutor(entry)) {
                cleanEntry(entry);
            }
            // Drop entries left with nothing but their `filter`/`executor` locator.
            return Object.keys(entry).some((k) => k !== 'filter' && k !== 'executor');
        });
        if (kept.length === 0) {
            delete targetDefaults[key];
        }
        else if (kept.length === 1 && kept[0].filter === undefined) {
            // A lone unfiltered entry is stored as the plain object form (which
            // omits `filter`).
            const { filter: _filter, ...config } = kept[0];
            targetDefaults[key] = config;
        }
        else {
            targetDefaults[key] = kept;
        }
    }
    if (Object.keys(targetDefaults).length === 0) {
        delete nxJson.targetDefaults;
    }
    (0, devkit_1.updateNxJson)(tree, nxJson);
    await (0, devkit_1.formatFiles)(tree);
}
