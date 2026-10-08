"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = update;
const devkit_1 = require("@nx/devkit");
const config_file_1 = require("../../utils/config-file");
const generator_1 = require("../../generators/convert-to-flat-config/generator");
const angular_eslint_1 = require("../../generators/convert-to-flat-config/angular-eslint");
// Output formatters ESLint removed in v9. Built-in names only; community
// formatter packages (referenced by their package name) keep working.
const REMOVED_FORMATTERS = new Set([
    'compact',
    'codeframe',
    'unix',
    'visualstudio',
    'table',
    'checkstyle',
    'jslint-xml',
    'junit',
    'tap',
]);
// Executor options the flat-config lint executor rejects outright (it throws when
// any is present). The generator folds project-level `ignorePath` into the flat
// config `ignores`, so that one is reported only when inherited from targetDefaults.
const FLAT_CONFIG_UNSUPPORTED_OPTIONS = [
    'ignorePath',
    'resolvePluginsRelativeTo',
    'reportUnusedDisableDirectives',
];
const ROOT_ESLINTRC_CANDIDATES = [
    '.eslintrc.base.json',
    '.eslintrc',
    '.eslintrc.json',
    '.eslintrc.yaml',
    '.eslintrc.yml',
];
const ESLINT_LINT_EXECUTOR = '@nx/eslint:lint';
/**
 * Hybrid migration paired with `convert-to-flat-config.md`. The deterministic
 * half reuses the `@nx/eslint:convert-to-flat-config` generator to convert
 * JSON/YAML eslintrc configs to flat config (the version bump is owned by
 * `packageJsonUpdates`, so it runs with `keepExistingVersions`). It then returns
 * `agentContext` describing the work the generator could not do deterministically
 * (JavaScript-based configs, removed output formatters, the passing-state
 * baseline) so the paired prompt's agent can finish the job and keep the
 * workspace lint-passing.
 */
async function update(tree) {
    // Gather pre-conversion context: the generator deletes the eslintrc files it
    // converts, so anything derived from them must be captured first.
    const userExplicitRules = collectUserRuleIds(tree);
    const skippedJsConfigs = findJsProjectConfigs(tree);
    const removedFormatterTargets = findRemovedFormatterTargets(tree);
    const unsupportedOptionTargets = findUnsupportedFlatConfigOptionTargets(tree);
    const rootState = detectRootConfigState(tree);
    if (rootState === 'convertible') {
        // The generator reconciles angular-eslint v22's removed configs as part of
        // conversion, so the converted flat configs load without agent repair.
        await (0, generator_1.convertToFlatConfigGenerator)(tree, {
            keepExistingVersions: true,
            skipFormat: true,
        });
    }
    // Reconcile angular-eslint v22's removed eslintrc configs in any flat config.
    // Runs for every root state: project-level flat configs can exist even when the
    // root is JavaScript-based (so the generator never ran), already flat, or
    // absent. No-op for the converted root above (idempotent).
    await (0, angular_eslint_1.migrateAngularEslintV22FlatConfig)(tree);
    await (0, devkit_1.formatFiles)(tree);
    if (rootState === 'none') {
        // Nothing to migrate beyond the angular-eslint reconciliation above.
        return;
    }
    const agentContext = [
        passingBaselineInstruction(userExplicitRules),
    ];
    const nextSteps = [];
    if (rootState === 'js') {
        agentContext.push('The root ESLint config is JavaScript-based (.eslintrc.js or .eslintrc.cjs) and was not converted automatically. ' +
            'Convert the whole workspace to flat config by hand: produce an eslint.config.mjs at the root and one per project, ' +
            'preserving the existing rules, plugins, parser options and overrides.');
        nextSteps.push('The root ESLint config is JavaScript-based and must be converted to flat config manually (root and every project).');
    }
    if (skippedJsConfigs.length > 0) {
        agentContext.push(`These project ESLint configs are JavaScript-based and were not converted automatically: ${skippedJsConfigs.join(', ')}. Convert each one to a flat config (eslint.config.mjs) manually, mirroring the conversion applied to the JSON/YAML configs.`);
        nextSteps.push(`Convert these JavaScript-based ESLint configs to flat config manually: ${skippedJsConfigs.join(', ')}.`);
    }
    if (removedFormatterTargets.length > 0) {
        agentContext.push(`These lint targets use an ESLint output formatter that was removed in v9: ${removedFormatterTargets.join('; ')}. Switch each to a built-in formatter (stylish, html, json, json-with-metadata) or install the matching community package (for example eslint-formatter-junit) and reference it by its package name.`);
        nextSteps.push(`Update lint targets that use a removed ESLint formatter: ${removedFormatterTargets.join('; ')}.`);
    }
    if (unsupportedOptionTargets.length > 0) {
        agentContext.push(`These lint targets set an ESLint option that flat config no longer supports, so the flat-config executor will throw: ${unsupportedOptionTargets.join('; ')}. Remove each option from its target or nx.json targetDefaults and migrate the behavior into the flat config where it applies: fold ignorePath patterns into the ignores block, set reportUnusedDisableDirectives via linterOptions. resolvePluginsRelativeTo has no flat-config equivalent. The workspace must still lint cleanly afterward.`);
        nextSteps.push(`Remove ESLint executor options that flat config no longer supports: ${unsupportedOptionTargets.join('; ')}.`);
    }
    if (rootState === 'convertible' && generatedConfigsUseFlatCompat(tree)) {
        agentContext.push('One or more generated flat configs use the FlatCompat shim from the @eslint/eslintrc package for third-party "extends" or complex overrides. ' +
            'Convert each FlatCompat usage to flat-native config when it is low-risk (for example typescript-eslint flat configs, or plugins that ship flat presets); otherwise keep the shim. ' +
            'The workspace must still lint cleanly afterward.');
    }
    return { agentContext, nextSteps };
}
function detectRootConfigState(tree) {
    const hasFlatConfig = [
        ...config_file_1.ESLINT_FLAT_CONFIG_FILENAMES,
        ...config_file_1.BASE_ESLINT_CONFIG_FILENAMES,
    ].some((file) => tree.exists(file));
    if (hasFlatConfig) {
        return 'flat';
    }
    if (tree.exists('.eslintrc.js') || tree.exists('.eslintrc.cjs')) {
        return 'js';
    }
    if (ROOT_ESLINTRC_CANDIDATES.some((file) => tree.exists(file))) {
        return 'convertible';
    }
    return 'none';
}
// Collects every rule ID the user explicitly configured across all eslintrc
// layers (root, base and per-project), so the agent can tell user-chosen rules
// apart from preset defaults when restoring the passing baseline. JavaScript
// configs are unreadable here and are surfaced separately.
function collectUserRuleIds(tree) {
    const ruleIds = new Set();
    const roots = ['', ...[...(0, devkit_1.getProjects)(tree).values()].map((p) => p.root)];
    for (const root of roots) {
        for (const filename of ROOT_ESLINTRC_CANDIDATES) {
            const path = root ? `${root}/${filename}` : filename;
            if (!tree.exists(path)) {
                continue;
            }
            const config = readEslintrcConfig(tree, path);
            if (!config) {
                continue;
            }
            for (const id of Object.keys(config.rules ?? {})) {
                ruleIds.add(id);
            }
            for (const override of config.overrides ?? []) {
                for (const id of Object.keys(override?.rules ?? {})) {
                    ruleIds.add(id);
                }
            }
        }
    }
    return [...ruleIds].sort();
}
function findJsProjectConfigs(tree) {
    const configs = [];
    for (const [, projectConfig] of (0, devkit_1.getProjects)(tree)) {
        for (const filename of ['.eslintrc.js', '.eslintrc.cjs']) {
            const path = `${projectConfig.root}/${filename}`;
            if (tree.exists(path)) {
                configs.push(path);
            }
        }
    }
    return configs;
}
function findRemovedFormatterTargets(tree) {
    const targets = [];
    // Emits one entry per option set (default + each configuration) whose `format`
    // names a formatter ESLint removed in v9.
    const collectRemovedFormatters = (baseLabel, optionSets) => {
        for (const [configuration, options] of optionSets) {
            const format = options?.format;
            if (typeof format === 'string' && REMOVED_FORMATTERS.has(format)) {
                const label = configuration
                    ? `${baseLabel}:${configuration}`
                    : baseLabel;
                targets.push(`${label} (format: "${format}")`);
            }
        }
    };
    for (const [project, projectConfig] of (0, devkit_1.getProjects)(tree)) {
        for (const [targetName, target] of Object.entries(projectConfig.targets ?? {})) {
            // Scan both the default options and every configuration, since a removed
            // formatter is often only set on a CI-specific configuration.
            const optionSets = [
                [null, target.options],
                ...Object.entries(target.configurations ?? {}),
            ];
            collectRemovedFormatters(`${project}:${targetName}`, optionSets);
        }
    }
    // Lint options are commonly centralized in nx.json targetDefaults; a removed
    // formatter set there is inherited by every lint target and would be missed by
    // the per-project scan above (getProjects does not merge targetDefaults).
    const targetDefaults = (0, devkit_1.readNxJson)(tree)?.targetDefaults ?? {};
    for (const [name, target] of Object.entries(targetDefaults)) {
        if (name !== 'lint' && name !== ESLINT_LINT_EXECUTOR) {
            continue;
        }
        if (Array.isArray(target)) {
            // This migration predates the filtered array value form; values are plain objects here.
            continue;
        }
        const optionSets = [[null, target.options], ...Object.entries(target.configurations ?? {})];
        collectRemovedFormatters(`targetDefaults["${name}"]`, optionSets);
    }
    return targets;
}
// Finds lint executor options that flat config rejects and that survive the
// conversion, so they can be surfaced for manual cleanup. The flat-config executor
// throws on these, so an inherited one fails every affected lint target.
function findUnsupportedFlatConfigOptionTargets(tree) {
    const entries = [];
    const collect = (baseLabel, optionSets, candidates) => {
        for (const [configuration, options] of optionSets) {
            for (const option of candidates) {
                const value = options?.[option];
                // reportUnusedDisableDirectives only throws when truthy; the others throw
                // whenever they are set, matching resolveAndInstantiateESLint.
                const present = option === 'reportUnusedDisableDirectives'
                    ? !!value
                    : value !== undefined;
                if (present) {
                    const label = configuration
                        ? `${baseLabel}:${configuration}`
                        : baseLabel;
                    entries.push(`${label} (${option})`);
                }
            }
        }
    };
    // Project lint targets keep the options the generator does not strip; it already
    // removes `eslintConfig` and `ignorePath`, so exclude ignorePath here.
    const projectCandidates = FLAT_CONFIG_UNSUPPORTED_OPTIONS.filter((option) => option !== 'ignorePath');
    for (const [project, projectConfig] of (0, devkit_1.getProjects)(tree)) {
        for (const [targetName, target] of Object.entries(projectConfig.targets ?? {})) {
            if (target.executor !== ESLINT_LINT_EXECUTOR) {
                continue;
            }
            const optionSets = [
                [null, target.options],
                ...Object.entries(target.configurations ?? {}),
            ];
            collect(`${project}:${targetName}`, optionSets, projectCandidates);
        }
    }
    // targetDefaults inherit into every lint target, including `ignorePath`, which
    // the generator only cleans up at the project level.
    const targetDefaults = (0, devkit_1.readNxJson)(tree)?.targetDefaults ?? {};
    for (const [name, target] of Object.entries(targetDefaults)) {
        if (name !== 'lint' && name !== ESLINT_LINT_EXECUTOR) {
            continue;
        }
        if (Array.isArray(target)) {
            // This migration predates the filtered array value form; values are plain objects here.
            continue;
        }
        const optionSets = [[null, target.options], ...Object.entries(target.configurations ?? {})];
        collect(`targetDefaults["${name}"]`, optionSets, FLAT_CONFIG_UNSUPPORTED_OPTIONS);
    }
    return entries;
}
// Scans the generated flat configs for the FlatCompat shim so the advisory only
// fires when there is real compat output to assess.
function generatedConfigsUseFlatCompat(tree) {
    const roots = ['', ...[...(0, devkit_1.getProjects)(tree).values()].map((p) => p.root)];
    for (const root of roots) {
        for (const filename of [
            ...config_file_1.ESLINT_FLAT_CONFIG_FILENAMES,
            ...config_file_1.BASE_ESLINT_CONFIG_FILENAMES,
        ]) {
            const path = root ? `${root}/${filename}` : filename;
            if (!tree.exists(path)) {
                continue;
            }
            if ((tree.read(path, 'utf-8') ?? '').includes('FlatCompat')) {
                return true;
            }
        }
    }
    return false;
}
function readEslintrcConfig(tree, path) {
    if (path.endsWith('.yaml') || path.endsWith('.yml')) {
        const content = tree.read(path, 'utf-8');
        if (!content) {
            return null;
        }
        const { load } = require('@zkochan/js-yaml');
        return load(content, { json: true, filename: path });
    }
    try {
        return (0, devkit_1.readJson)(tree, path);
    }
    catch {
        return null;
    }
}
function passingBaselineInstruction(userExplicitRules) {
    const ruleList = userExplicitRules.length > 0
        ? `The user explicitly configured these rules before the migration: ${userExplicitRules.join(', ')}.`
        : 'The user did not explicitly configure any rules before the migration.';
    return (`Passing-state requirement: after migrating, run the workspace lint and keep it passing. ${ruleList} ` +
        'For any rule that now reports errors but is not in that list, disable it in the flat config with a short explanatory comment. ' +
        'Those errors come from changed preset defaults (the ESLint v9 "eslint:recommended" set and the typescript-eslint v8 recommended sets), not from the user. ' +
        'Never disable or weaken a rule the user explicitly configured, and never edit source files to satisfy a newly enabled rule.');
}
