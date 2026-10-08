"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initEsLint = initEsLint;
exports.lintInitGenerator = lintInitGenerator;
const internal_1 = require("@nx/devkit/internal");
const devkit_1 = require("@nx/devkit");
const assert_supported_eslint_version_1 = require("../../utils/assert-supported-eslint-version");
const versions_1 = require("../../utils/versions");
const eslint_file_1 = require("../utils/eslint-file");
const plugin_1 = require("../../plugins/plugin");
const plugin_2 = require("../utils/plugin");
const path_1 = require("path");
function updateProductionFileset(tree, format = 'mjs') {
    const nxJson = (0, devkit_1.readNxJson)(tree);
    const productionFileSet = nxJson.namedInputs?.production;
    if (productionFileSet) {
        productionFileSet.push('!{projectRoot}/.eslintrc.json');
        productionFileSet.push(`!{projectRoot}/eslint.config.${format}`);
        // Dedupe and set
        nxJson.namedInputs.production = Array.from(new Set(productionFileSet));
    }
    (0, devkit_1.updateNxJson)(tree, nxJson);
}
function addTargetDefaults(tree, format) {
    const nxJson = (0, devkit_1.readNxJson)(tree) ?? {};
    // `@nx/eslint:lint` is an executor identifier — match defaults keyed on
    // the executor, not on a target named that string.
    const existing = (0, internal_1.findTargetDefault)(nxJson.targetDefaults, {
        executor: '@nx/eslint:lint',
    });
    const patch = {};
    if (existing?.cache === undefined)
        patch.cache = true;
    if (existing?.inputs === undefined) {
        patch.inputs = [
            'default',
            '^default',
            `{workspaceRoot}/.eslintrc.json`,
            `{workspaceRoot}/.eslintignore`,
            `{workspaceRoot}/eslint.config.${format}`,
            '{workspaceRoot}/tools/eslint-rules/**/*',
        ];
    }
    if (Object.keys(patch).length > 0) {
        (0, internal_1.upsertTargetDefault)(tree, nxJson, {
            executor: '@nx/eslint:lint',
            ...patch,
        });
        (0, devkit_1.updateNxJson)(tree, nxJson);
    }
}
function updateVsCodeRecommendedExtensions(host) {
    if (!host.exists('.vscode/extensions.json')) {
        return;
    }
    (0, devkit_1.updateJson)(host, '.vscode/extensions.json', (json) => {
        json.recommendations = json.recommendations || [];
        const extension = 'dbaeumer.vscode-eslint';
        if (!json.recommendations.includes(extension)) {
            json.recommendations.push(extension);
        }
        return json;
    });
}
async function initEsLint(tree, options) {
    (0, assert_supported_eslint_version_1.assertSupportedEslintVersion)(tree);
    const nxJson = (0, devkit_1.readNxJson)(tree);
    const addPluginDefault = process.env.NX_ADD_PLUGINS !== 'false' &&
        nxJson.useInferencePlugins !== false;
    options.addPlugin ??= addPluginDefault;
    options.eslintConfigFormat ??= 'mjs';
    const hasPlugin = (0, plugin_2.hasEslintPlugin)(tree);
    const rootEslintFile = (0, eslint_file_1.findEslintFile)(tree);
    if (rootEslintFile) {
        const fileExtension = (0, path_1.extname)(rootEslintFile);
        if (fileExtension === '.mjs' || fileExtension === '.cjs') {
            options.eslintConfigFormat = fileExtension.slice(1);
        }
        else {
            options.eslintConfigFormat = (0, eslint_file_1.determineEslintConfigFormat)(tree.read(rootEslintFile, 'utf-8'));
        }
    }
    const graph = await (0, devkit_1.createProjectGraphAsync)();
    const lintTargetNames = [
        'lint',
        'eslint:lint',
        'eslint-lint',
        '_lint',
        '_eslint:lint',
        '_eslint-lint',
    ];
    if (rootEslintFile && options.addPlugin && !hasPlugin) {
        await (0, internal_1.addPlugin)(tree, graph, '@nx/eslint/plugin', plugin_1.createNodes, {
            targetName: lintTargetNames,
        }, options.updatePackageScripts);
        return () => { };
    }
    if (rootEslintFile) {
        return () => { };
    }
    updateProductionFileset(tree, options.eslintConfigFormat);
    updateVsCodeRecommendedExtensions(tree);
    if (options.addPlugin) {
        await (0, internal_1.addPlugin)(tree, graph, '@nx/eslint/plugin', plugin_1.createNodes, {
            targetName: lintTargetNames,
        }, options.updatePackageScripts);
    }
    else {
        addTargetDefaults(tree, options.eslintConfigFormat);
    }
    const tasks = [];
    if (!options.skipPackageJson) {
        const { eslintVersion } = (0, versions_1.versions)(tree);
        tasks.push((0, devkit_1.removeDependenciesFromPackageJson)(tree, ['@nx/eslint'], []));
        tasks.push((0, devkit_1.addDependenciesToPackageJson)(tree, {}, {
            '@nx/eslint': versions_1.nxVersion,
            eslint: eslintVersion,
        }, undefined, options.keepExistingVersions ?? true));
    }
    return (0, devkit_1.runTasksInSerial)(...tasks);
}
async function lintInitGenerator(tree, options) {
    return await initEsLint(tree, { addPlugin: false, ...options });
}
