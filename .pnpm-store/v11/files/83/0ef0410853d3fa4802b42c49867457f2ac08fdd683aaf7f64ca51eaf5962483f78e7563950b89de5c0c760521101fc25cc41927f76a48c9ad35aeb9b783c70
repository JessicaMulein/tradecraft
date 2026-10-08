"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertToFlatConfigGenerator = convertToFlatConfigGenerator;
const devkit_1 = require("@nx/devkit");
const eslint_file_1 = require("../utils/eslint-file");
const plugin_1 = require("../utils/plugin");
const path_1 = require("path");
const assert_supported_eslint_version_1 = require("../../utils/assert-supported-eslint-version");
const versions_1 = require("../../utils/versions");
const config_file_1 = require("../../utils/config-file");
const json_converter_1 = require("./converters/json-converter");
const angular_eslint_1 = require("./angular-eslint");
async function convertToFlatConfigGenerator(tree, options) {
    (0, assert_supported_eslint_version_1.assertSupportedEslintVersion)(tree);
    // Already on flat config at the root? There is nothing to convert.
    const hasRootFlatConfig = [
        ...config_file_1.ESLINT_FLAT_CONFIG_FILENAMES,
        ...config_file_1.BASE_ESLINT_CONFIG_FILENAMES,
    ].some((file) => tree.exists(file));
    if (hasRootFlatConfig) {
        return;
    }
    const eslintFile = (0, eslint_file_1.findEslintFile)(tree);
    if (!eslintFile) {
        throw new Error('Could not find root eslint file');
    }
    if (eslintFile.endsWith('.js')) {
        throw new Error('Only json and yaml eslint config files are supported for conversion');
    }
    options.eslintConfigFormat ??= 'mjs';
    const eslintIgnoreFiles = new Set(['.eslintignore']);
    // convert root eslint config to eslint.config.cjs or eslint.base.config.mjs based on eslintConfigFormat
    convertRootToFlatConfig(tree, eslintFile, options.eslintConfigFormat, options.keepExistingVersions);
    // convert project eslint files to eslint.config.cjs
    const projects = (0, devkit_1.getProjects)(tree);
    for (const [project, projectConfig] of projects) {
        convertProjectToFlatConfig(tree, project, projectConfig, (0, devkit_1.readNxJson)(tree), eslintIgnoreFiles, options.eslintConfigFormat, options.keepExistingVersions);
    }
    // delete all .eslintignore files
    for (const ignoreFile of eslintIgnoreFiles) {
        tree.delete(ignoreFile);
    }
    // replace references in nx.json and project.json files
    updateNxJsonConfig(tree, options.eslintConfigFormat);
    updateProjectConfigsInputs(tree, options.eslintConfigFormat);
    // The converter carries angular-eslint's removed eslintrc configs over as
    // FlatCompat shims; on v22 those no longer resolve, so reconcile them to the
    // flat-native config before formatting (no-op below v22).
    await (0, angular_eslint_1.migrateAngularEslintV22FlatConfig)(tree);
    if (!options.skipFormat) {
        await (0, devkit_1.formatFiles)(tree);
    }
    return () => (0, devkit_1.installPackagesTask)(tree);
}
exports.default = convertToFlatConfigGenerator;
function convertRootToFlatConfig(tree, eslintFile, format, keepExistingVersions) {
    if (/\.base\.(js|json|yml|yaml)$/.test(eslintFile)) {
        convertConfigToFlatConfig(tree, '', eslintFile, `eslint.base.config.${format}`, format, undefined, keepExistingVersions);
    }
    // A workspace can ship `.eslintrc.base.json` without a sibling root config, so
    // only convert the non-base root config when it actually exists.
    const rootEslintFile = eslintFile.replace('.base.', '.');
    if (tree.exists(rootEslintFile)) {
        convertConfigToFlatConfig(tree, '', rootEslintFile, `eslint.config.${format}`, format, undefined, keepExistingVersions);
    }
}
const ESLINT_LINT_EXECUTOR = '@nx/eslint:lint';
function isEslintTarget(target) {
    return (target.executor === ESLINT_LINT_EXECUTOR ||
        target.command?.includes('eslint'));
}
function hasMatchingEslintTargetDefault(projectConfig, targetDefaults) {
    if (!projectConfig.targets || !targetDefaults) {
        return false;
    }
    return Object.entries(targetDefaults).some(([targetName, value]) => {
        if (projectConfig.targets[targetName] === undefined) {
            return false;
        }
        if (targetName === ESLINT_LINT_EXECUTOR) {
            return true;
        }
        // A target default value can be a plain config object or an array of
        // filtered entries; match against the filter-less (catch-all) entry.
        const targetConfig = Array.isArray(value)
            ? value.find((e) => e.filter === undefined)
            : value;
        return targetConfig ? isEslintTarget(targetConfig) : false;
    });
}
function convertProjectToFlatConfig(tree, project, projectConfig, nxJson, eslintIgnoreFiles, format, keepExistingVersions) {
    const eslintFile = (0, eslint_file_1.findEslintFile)(tree, projectConfig.root);
    if (!eslintFile) {
        return;
    }
    if (eslintFile === '.eslintrc.js' || eslintFile === '.eslintrc.cjs') {
        devkit_1.logger.warn(`Skipping "${project}": ${eslintFile} is a JavaScript-based ESLint config, which cannot be converted automatically. Convert it to flat config manually.`);
        return;
    }
    if (eslintFile.endsWith('.js')) {
        // Already on a JavaScript-based flat config (eslint.config.js); nothing to convert.
        return;
    }
    // Clean up obsolete target options and detect explicit ESLint targets
    let ignorePath;
    const eslintTargets = projectConfig.targets
        ? Object.keys(projectConfig.targets).filter((t) => isEslintTarget(projectConfig.targets[t]))
        : [];
    for (const target of eslintTargets) {
        if (projectConfig.targets[target].options?.eslintConfig) {
            delete projectConfig.targets[target].options.eslintConfig;
        }
        if (projectConfig.targets[target].options?.ignorePath) {
            ignorePath = projectConfig.targets[target].options.ignorePath;
            delete projectConfig.targets[target].options.ignorePath;
        }
    }
    if (eslintTargets.length > 0) {
        (0, devkit_1.updateProjectConfiguration)(tree, project, projectConfig);
    }
    const hasEslintTargetDefaults = hasMatchingEslintTargetDefault(projectConfig, nxJson.targetDefaults);
    if (eslintTargets.length === 0 &&
        !hasEslintTargetDefaults &&
        !(0, plugin_1.hasEslintPlugin)(tree)) {
        devkit_1.logger.warn(`Skipping "${project}": found ${eslintFile} but no ESLint lint target detected. Convert manually if needed.`);
        return;
    }
    convertConfigToFlatConfig(tree, projectConfig.root, eslintFile, `eslint.config.${format}`, format, ignorePath, keepExistingVersions);
    eslintIgnoreFiles.add(`${projectConfig.root}/.eslintignore`);
    if (ignorePath) {
        eslintIgnoreFiles.add(ignorePath);
    }
}
// Rewrites input entries that reference legacy `.eslintrc[.base].json` / `.eslintignore`
// files to their flat-config counterparts, then dedupes so the rewrite doesn't produce
// duplicates of entries that already pointed at the flat config. Leaves non-string /
// non-fileset inputs (runtime/env/dependentTasksOutputFiles/etc.) untouched.
function rewriteLegacyInputs(inputs, format) {
    const seenStrings = new Set();
    const result = [];
    for (const entry of inputs) {
        if (typeof entry === 'string') {
            const rewritten = (0, json_converter_1.renameLegacyEslintrcFile)(entry, format);
            if (seenStrings.has(rewritten))
                continue;
            seenStrings.add(rewritten);
            result.push(rewritten);
        }
        else if ('fileset' in entry) {
            const rewritten = (0, json_converter_1.renameLegacyEslintrcFile)(entry.fileset, format);
            // Preserve the original reference when nothing changed so downstream identity
            // checks (e.g. `inputsEqual`) don't see a spurious mutation.
            result.push(rewritten === entry.fileset ? entry : { ...entry, fileset: rewritten });
        }
        else {
            result.push(entry);
        }
    }
    return result;
}
// Adds `value` to `inputs` (after rewriting) when the rewritten set doesn't already contain it.
function ensureInputPresent(inputs, value, format) {
    const rewritten = rewriteLegacyInputs(inputs, format);
    if (!rewritten.some((entry) => entry === value)) {
        rewritten.push(value);
    }
    return rewritten;
}
// Updates nx.json: rewrites stale eslintrc/eslintignore references across all targetDefaults
// inputs and namedInputs, and ensures lint targets include the new flat config file as an input
// (and `production` excludes it). Handles both the legacy record shape and the new array shape
// of `targetDefaults`.
function updateNxJsonConfig(tree, format) {
    if (!tree.exists('nx.json')) {
        return;
    }
    (0, devkit_1.updateJson)(tree, 'nx.json', (json) => {
        const rewriteTargetInputs = (target, isLintTarget) => {
            if (!target.inputs)
                return;
            target.inputs = isLintTarget
                ? ensureInputPresent(target.inputs, `{workspaceRoot}/eslint.config.${format}`, format)
                : rewriteLegacyInputs(target.inputs, format);
        };
        if (json.targetDefaults) {
            for (const [name, value] of Object.entries(json.targetDefaults)) {
                const isLintTarget = name === 'lint' || name === ESLINT_LINT_EXECUTOR;
                // A target default value can be a plain config object or an array of
                // filtered entries; rewrite inputs on each entry in the array case.
                if (Array.isArray(value)) {
                    for (const entry of value) {
                        rewriteTargetInputs(entry, isLintTarget);
                    }
                }
                else {
                    rewriteTargetInputs(value, isLintTarget);
                }
            }
        }
        if (json.namedInputs) {
            for (const [name, inputs] of Object.entries(json.namedInputs)) {
                json.namedInputs[name] =
                    name === 'production'
                        ? ensureInputPresent(inputs, `!{projectRoot}/eslint.config.${format}`, format)
                        : rewriteLegacyInputs(inputs, format);
            }
        }
        return json;
    });
}
// Walks every project's `targets.*.inputs` and `namedInputs.*`, rewriting stale references.
function updateProjectConfigsInputs(tree, format) {
    for (const [project, projectConfig] of (0, devkit_1.getProjects)(tree)) {
        let changed = false;
        if (projectConfig.targets) {
            for (const target of Object.values(projectConfig.targets)) {
                if (!target.inputs)
                    continue;
                const rewritten = rewriteLegacyInputs(target.inputs, format);
                if (!inputsEqual(target.inputs, rewritten)) {
                    target.inputs = rewritten;
                    changed = true;
                }
            }
        }
        if (projectConfig.namedInputs) {
            for (const [name, inputs] of Object.entries(projectConfig.namedInputs)) {
                const rewritten = rewriteLegacyInputs(inputs, format);
                if (!inputsEqual(inputs, rewritten)) {
                    projectConfig.namedInputs[name] = rewritten;
                    changed = true;
                }
            }
        }
        if (changed) {
            (0, devkit_1.updateProjectConfiguration)(tree, project, projectConfig);
        }
    }
}
function inputsEqual(a, b) {
    return a.length === b.length && a.every((entry, i) => entry === b[i]);
}
function convertConfigToFlatConfig(tree, root, source, target, format, ignorePath, keepExistingVersions) {
    const ignorePaths = ignorePath
        ? [ignorePath, `${root}/.eslintignore`]
        : [`${root}/.eslintignore`];
    // `.eslintrc` (no extension) is JSON by convention.
    if (source.endsWith('.json') || (0, path_1.basename)(source) === '.eslintrc') {
        const config = (0, devkit_1.readJson)(tree, `${root}/${source}`);
        const conversionResult = (0, json_converter_1.convertEslintJsonToFlatConfig)(tree, root, config, ignorePaths, format);
        return processConvertedConfig(tree, root, source, target, conversionResult, keepExistingVersions);
    }
    if (source.endsWith('.yaml') || source.endsWith('.yml')) {
        const originalContent = tree.read(`${root}/${source}`, 'utf-8');
        const { load } = require('@zkochan/js-yaml');
        const config = load(originalContent, {
            json: true,
            filename: source,
        });
        const conversionResult = (0, json_converter_1.convertEslintJsonToFlatConfig)(tree, root, config, ignorePaths, format);
        return processConvertedConfig(tree, root, source, target, conversionResult, keepExistingVersions);
    }
}
function processConvertedConfig(tree, root, source, target, { content, addESLintRC, addESLintJS, }, keepExistingVersions) {
    // remove original config file
    tree.delete((0, path_1.join)(root, source));
    // save new
    tree.write((0, path_1.join)(root, target), content);
    // Once converted to flat config, the workspace should use the latest ESLint
    // stack. Install the versions directly instead of routing through
    // `versions(tree)`, which keys off the pre-conversion declared ESLint version.
    const devDependencies = {
        eslint: versions_1.eslintVersion,
        'eslint-config-prettier': versions_1.eslintConfigPrettierVersion,
        'typescript-eslint': versions_1.typescriptESLintVersion,
        '@typescript-eslint/eslint-plugin': versions_1.typescriptESLintVersion,
        '@typescript-eslint/parser': versions_1.typescriptESLintVersion,
    };
    if ((0, devkit_1.getDependencyVersionFromPackageJson)(tree, '@typescript-eslint/utils')) {
        devDependencies['@typescript-eslint/utils'] = versions_1.typescriptESLintVersion;
    }
    if ((0, devkit_1.getDependencyVersionFromPackageJson)(tree, '@typescript-eslint/type-utils')) {
        devDependencies['@typescript-eslint/type-utils'] = versions_1.typescriptESLintVersion;
    }
    // add missing packages
    if (addESLintRC) {
        devDependencies['@eslint/eslintrc'] = versions_1.eslintrcVersion;
    }
    if (addESLintJS) {
        devDependencies['@eslint/js'] = versions_1.eslintVersion;
    }
    // The flat/angular presets import the umbrella `angular-eslint` package; add
    // it when the converted config references them so the result resolves.
    if (content.includes('flat/angular')) {
        devDependencies['angular-eslint'] = (0, angular_eslint_1.resolveAngularEslintVersion)(tree);
    }
    // Direct invocation is an opt-in upgrade, so by default existing pins are
    // overwritten to land the workspace on the latest flat-config-ready stack.
    // Migrations pass `keepExistingVersions` so the version bump stays owned by
    // `packageJsonUpdates` and only newly added packages are installed here.
    (0, devkit_1.addDependenciesToPackageJson)(tree, {}, devDependencies, 'package.json', keepExistingVersions);
}
