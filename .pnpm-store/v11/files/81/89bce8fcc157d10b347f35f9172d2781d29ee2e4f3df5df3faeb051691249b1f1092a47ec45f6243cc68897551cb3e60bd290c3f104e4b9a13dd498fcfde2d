"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNxJsonFile = createNxJsonFile;
exports.upsertTargetDefaultEntry = upsertTargetDefaultEntry;
exports.createNxJsonFromTurboJson = createNxJsonFromTurboJson;
exports.addDepsToPackageJson = addDepsToPackageJson;
exports.updateGitIgnore = updateGitIgnore;
exports.runInstall = runInstall;
exports.toErrorString = toErrorString;
exports.readErrorStderr = readErrorStderr;
exports.extractErrorName = extractErrorName;
exports.initCloud = initCloud;
exports.setNeverConnectToCloud = setNeverConnectToCloud;
exports.addVsCodeRecommendedExtensions = addVsCodeRecommendedExtensions;
exports.markRootPackageJsonAsNxProjectLegacy = markRootPackageJsonAsNxProjectLegacy;
exports.markPackageJsonAsNxProject = markPackageJsonAsNxProject;
exports.printFinalMessage = printFinalMessage;
exports.isMonorepo = isMonorepo;
const child_process_1 = require("child_process");
const path_1 = require("path");
const semver_1 = require("semver");
const fileutils_1 = require("../../../utils/fileutils");
const output_1 = require("../../../utils/output");
const package_manager_1 = require("../../../utils/package-manager");
const acknowledge_build_scripts_1 = require("../../../utils/acknowledge-build-scripts");
const path_2 = require("../../../utils/path");
const versions_1 = require("../../../utils/versions");
const fs_1 = require("fs");
const format_1 = require("./format");
const connect_to_nx_cloud_1 = require("../../../nx-cloud/generators/connect-to-nx-cloud/connect-to-nx-cloud");
const connect_to_nx_cloud_2 = require("../../nx-cloud/connect/connect-to-nx-cloud");
const deduce_default_base_1 = require("./deduce-default-base");
function createNxJsonFile(repoRoot, topologicalTargets, cacheableOperations, scriptOutputs) {
    const nxJsonPath = (0, path_2.joinPathFragments)(repoRoot, 'nx.json');
    let nxJson = {};
    try {
        nxJson = (0, fileutils_1.readJsonFile)(nxJsonPath);
    }
    catch { }
    nxJson.$schema = './node_modules/nx/schemas/nx-schema.json';
    const targetDefaults = { ...(nxJson.targetDefaults ?? {}) };
    if (topologicalTargets.length > 0) {
        for (const scriptName of topologicalTargets) {
            upsertTargetDefaultEntry(targetDefaults, scriptName, {
                dependsOn: [`^${scriptName}`],
            });
        }
    }
    for (const [scriptName, output] of Object.entries(scriptOutputs)) {
        if (!output) {
            continue;
        }
        upsertTargetDefaultEntry(targetDefaults, scriptName, {
            outputs: [`{projectRoot}/${output}`],
        });
    }
    for (const target of cacheableOperations) {
        const existing = readUnfilteredTargetDefault(targetDefaults, target);
        if (existing.cache === undefined) {
            upsertTargetDefaultEntry(targetDefaults, target, { cache: true });
        }
    }
    if (Object.keys(targetDefaults).length === 0) {
        delete nxJson.targetDefaults;
    }
    else {
        nxJson.targetDefaults = targetDefaults;
    }
    const defaultBase = (0, deduce_default_base_1.deduceDefaultBase)();
    // Do not add defaultBase if it is inferred to be the Nx default value of main
    if (defaultBase !== 'main') {
        nxJson.defaultBase ??= defaultBase;
    }
    (0, fileutils_1.writeJsonFile)(nxJsonPath, nxJson);
    (0, format_1.recordInitWrite)(nxJsonPath);
}
/**
 * Locate-by-target upsert against an in-memory `targetDefaults` map. Merges
 * `patch`'s config into the unfiltered (catch-all) default for `target`,
 * promoting through the array form when one already exists. Used by `nx init`
 * code paths that operate on raw JSON before a Tree exists — generators
 * should use `upsertTargetDefault` from devkit instead.
 */
function upsertTargetDefaultEntry(targetDefaults, target, patch) {
    // Drop locator fields — the key is `target` and `nx init` only writes
    // unfiltered defaults.
    const { target: _t, executor: _e, projects: _p, plugin: _pl, ...config } = patch;
    const existing = targetDefaults[target];
    if (Array.isArray(existing)) {
        const idx = existing.findIndex((e) => e.filter === undefined);
        if (idx >= 0) {
            const { filter, ...rest } = existing[idx];
            existing[idx] = { ...rest, ...config };
        }
        else {
            existing.push({ ...config });
        }
    }
    else {
        targetDefaults[target] = { ...(existing ?? {}), ...config };
    }
}
/**
 * Read the unfiltered (catch-all) config for `target` from a `targetDefaults`
 * map — the object value, or the filter-less entry of an array value.
 */
function readUnfilteredTargetDefault(targetDefaults, target) {
    const existing = targetDefaults[target];
    if (existing === undefined)
        return {};
    if (!Array.isArray(existing))
        return existing;
    return existing.find((e) => e.filter === undefined) ?? {};
}
function createNxJsonFromTurboJson(turboJson) {
    const nxJson = {
        $schema: './node_modules/nx/schemas/nx-schema.json',
    };
    // Handle global dependencies
    if (turboJson.globalDependencies?.length > 0) {
        nxJson.namedInputs = {
            sharedGlobals: turboJson.globalDependencies.map((dep) => `{workspaceRoot}/${dep}`),
            default: ['{projectRoot}/**/*', 'sharedGlobals'],
        };
    }
    // Handle global env vars
    if (turboJson.globalEnv?.length > 0) {
        nxJson.namedInputs = nxJson.namedInputs || {};
        nxJson.namedInputs.sharedGlobals = nxJson.namedInputs.sharedGlobals || [];
        nxJson.namedInputs.sharedGlobals.push(...turboJson.globalEnv.map((env) => ({ env })));
        nxJson.namedInputs.default = nxJson.namedInputs.default || [];
        if (!nxJson.namedInputs.default.includes('{projectRoot}/**/*')) {
            nxJson.namedInputs.default.push('{projectRoot}/**/*');
        }
        if (!nxJson.namedInputs.default.includes('sharedGlobals')) {
            nxJson.namedInputs.default.push('sharedGlobals');
        }
    }
    // Handle task configurations
    if (turboJson.tasks) {
        const targetDefaults = {};
        for (const [taskName, taskConfig] of Object.entries(turboJson.tasks)) {
            // Skip project-specific tasks (containing #)
            if (taskName.includes('#'))
                continue;
            const config = taskConfig;
            const entry = { target: taskName };
            // Handle dependsOn
            if (config.dependsOn?.length > 0) {
                entry.dependsOn = config.dependsOn;
            }
            // Handle inputs
            if (config.inputs?.length > 0) {
                entry.inputs = config.inputs
                    .map((input) => {
                    if (input === '$TURBO_DEFAULT$') {
                        return '{projectRoot}/**/*';
                    }
                    // Don't add projectRoot if it's already there or if it's an env var
                    if (input.startsWith('{projectRoot}/') ||
                        input.startsWith('{env.') ||
                        input.startsWith('$'))
                        return input;
                    return `{projectRoot}/${input}`;
                })
                    .map((input) => {
                    // Don't add projectRoot if it's already there or if it's an env var
                    if (input.startsWith('{projectRoot}/') ||
                        input.startsWith('{env.') ||
                        input.startsWith('$'))
                        return input;
                    return `{projectRoot}/${input}`;
                });
            }
            // Handle outputs
            if (config.outputs?.length > 0) {
                entry.outputs = config.outputs.map((output) => {
                    // Don't add projectRoot if it's already there
                    if (output.startsWith('{projectRoot}/'))
                        return output;
                    // Handle negated patterns by adding projectRoot after the !
                    if (output.startsWith('!')) {
                        return `!{projectRoot}/${output.slice(1)}`;
                    }
                    return `{projectRoot}/${output}`;
                });
            }
            // Handle cache setting - true by default in Turbo
            entry.cache = config.cache !== false;
            // Each turbo task maps to a unique key, written as the plain object
            // (unfiltered) value form.
            const { target, ...taskDefault } = entry;
            targetDefaults[target] = taskDefault;
        }
        if (Object.keys(targetDefaults).length > 0) {
            nxJson.targetDefaults = targetDefaults;
        }
    }
    const defaultBase = (0, deduce_default_base_1.deduceDefaultBase)();
    // Do not add defaultBase if it is inferred to be the Nx default value of main
    if (defaultBase !== 'main') {
        nxJson.defaultBase ??= defaultBase;
    }
    return nxJson;
}
function addDepsToPackageJson(repoRoot, packageManager, additionalPackages) {
    const path = (0, path_2.joinPathFragments)(repoRoot, `package.json`);
    const json = (0, fileutils_1.readJsonFile)(path);
    if (!json.devDependencies)
        json.devDependencies = {};
    json.devDependencies['nx'] = versions_1.nxVersion;
    if (additionalPackages) {
        for (const p of additionalPackages) {
            json.devDependencies[p] = versions_1.nxVersion;
        }
    }
    (0, fileutils_1.writeJsonFile)(path, json);
    (0, format_1.recordInitWrite)(path);
    // nx has a postinstall script, which pnpm 11+ refuses to install
    // unacknowledged.
    (0, acknowledge_build_scripts_1.acknowledgeBuildScripts)(repoRoot, packageManager, { nx: true });
}
function updateGitIgnore(root) {
    const ignorePath = (0, path_1.join)(root, '.gitignore');
    try {
        let contents = (0, fs_1.readFileSync)(ignorePath, 'utf-8');
        const lines = contents.split('\n');
        let sepIncluded = false;
        if (!contents.includes('.nx/cache')) {
            if (!sepIncluded) {
                lines.push('\n');
                sepIncluded = true;
            }
            lines.push('.nx/cache');
        }
        if (!contents.includes('.nx/workspace-data')) {
            if (!sepIncluded) {
                lines.push('\n');
                sepIncluded = true;
            }
            lines.push('.nx/workspace-data');
        }
        if (!contents.includes('.nx/migrate-runs')) {
            if (!sepIncluded) {
                lines.push('\n');
                sepIncluded = true;
            }
            lines.push('.nx/migrate-runs');
        }
        (0, fs_1.writeFileSync)(ignorePath, lines.join('\n'), 'utf-8');
    }
    catch { }
}
function runInstall(repoRoot, packageManager = (0, package_manager_1.detectPackageManager)(repoRoot), pmc = (0, package_manager_1.getPackageManagerCommand)(packageManager)) {
    let command = pmc.install;
    // Plugins added during init can pull build-script deps whose allowBuilds
    // entries are only recorded by their init generators after this install;
    // warn and skip for this one install, like pnpm 10 did.
    if (packageManager === 'pnpm') {
        try {
            if ((0, semver_1.gte)((0, package_manager_1.getPackageManagerVersion)('pnpm', repoRoot), '11.0.0')) {
                command += ' --config.strictDepBuilds=false';
            }
        }
        catch {
            // The version cannot be probed; run the install unmodified.
        }
    }
    try {
        (0, child_process_1.execSync)(command, {
            stdio: ['ignore', 'ignore', 'pipe'],
            encoding: 'utf8',
            cwd: repoRoot,
            windowsHide: true,
        });
    }
    catch (e) {
        if (e?.stderr)
            process.stderr.write(e.stderr);
        throw e;
    }
}
/**
 * Coerce any thrown value into a non-empty telemetry string. The naive
 * `error.message || String(error)` yields "" for bare `new Error()`.
 */
function toErrorString(error) {
    if (error == null)
        return 'Unknown error';
    if (error instanceof Error) {
        if (error.message)
            return error.message;
        if (error.name && error.name !== 'Error')
            return error.name;
        // Drop `stack` — large and contains absolute paths (PII).
        const keys = Object.getOwnPropertyNames(error).filter((k) => k !== 'stack');
        const serialized = safeJsonStringify(error, keys);
        if (serialized && serialized !== '{}')
            return serialized;
        return error.name || 'Error';
    }
    if (typeof error === 'object') {
        const serialized = safeJsonStringify(error);
        if (serialized && serialized !== '{}')
            return serialized;
        return Object.prototype.toString.call(error);
    }
    return String(error);
}
function readErrorStderr(error) {
    const raw = error?.stderr;
    if (typeof raw === 'string')
        return raw;
    if (raw && typeof raw.toString === 'function') {
        return raw.toString('utf8');
    }
    return '';
}
function extractErrorName(error, stderr) {
    const nodeCode = error?.code;
    if (typeof nodeCode === 'string')
        return nodeCode;
    const m = stderr.match(/\b(E[A-Z0-9_]{2,}|ERR_[A-Z0-9_]+)\b/);
    if (m)
        return m[1];
    if (error instanceof Error)
        return error.name;
    return typeof error;
}
function safeJsonStringify(value, replacer) {
    try {
        return JSON.stringify(value, replacer);
    }
    catch {
        return '';
    }
}
async function initCloud(installationSource) {
    const token = await (0, connect_to_nx_cloud_2.connectWorkspaceToCloud)({
        installationSource,
    });
    await (0, connect_to_nx_cloud_1.printSuccessMessage)(token, installationSource);
}
function setNeverConnectToCloud(repoRoot) {
    const nxJsonPath = (0, path_1.join)(repoRoot, 'nx.json');
    const nxJson = (0, fileutils_1.readJsonFile)(nxJsonPath);
    nxJson.neverConnectToCloud = true;
    (0, fileutils_1.writeJsonFile)(nxJsonPath, nxJson);
    (0, format_1.recordInitWrite)(nxJsonPath);
}
function addVsCodeRecommendedExtensions(repoRoot, extensions) {
    const vsCodeExtensionsPath = (0, path_1.join)(repoRoot, '.vscode/extensions.json');
    if ((0, fileutils_1.fileExists)(vsCodeExtensionsPath)) {
        const vsCodeExtensionsJson = (0, fileutils_1.readJsonFile)(vsCodeExtensionsPath);
        vsCodeExtensionsJson.recommendations ??= [];
        extensions.forEach((extension) => {
            if (!vsCodeExtensionsJson.recommendations.includes(extension)) {
                vsCodeExtensionsJson.recommendations.push(extension);
            }
        });
        (0, fileutils_1.writeJsonFile)(vsCodeExtensionsPath, vsCodeExtensionsJson);
        (0, format_1.recordInitWrite)(vsCodeExtensionsPath);
    }
    else {
        (0, fileutils_1.writeJsonFile)(vsCodeExtensionsPath, { recommendations: extensions });
        (0, format_1.recordInitWrite)(vsCodeExtensionsPath);
    }
}
function markRootPackageJsonAsNxProjectLegacy(repoRoot, cacheableScripts, pmc) {
    const json = (0, fileutils_1.readJsonFile)((0, path_2.joinPathFragments)(repoRoot, `package.json`));
    json.nx = {};
    for (let script of cacheableScripts) {
        const scriptDefinition = json.scripts[script];
        if (!scriptDefinition) {
            continue;
        }
        if (scriptDefinition.includes('&&') || scriptDefinition.includes('||')) {
            let backingScriptName = `_${script}`;
            json.scripts[backingScriptName] = scriptDefinition;
            json.scripts[script] = `nx exec -- ${pmc.run(backingScriptName, '')}`;
        }
        else {
            json.scripts[script] = `nx exec -- ${json.scripts[script]}`;
        }
    }
    (0, fileutils_1.writeJsonFile)(`package.json`, json);
    (0, format_1.recordInitWrite)('package.json');
}
function markPackageJsonAsNxProject(packageJsonPath) {
    const json = (0, fileutils_1.readJsonFile)(packageJsonPath);
    if (!json.scripts) {
        return;
    }
    json.nx = {};
    (0, fileutils_1.writeJsonFile)(packageJsonPath, json);
    (0, format_1.recordInitWrite)(packageJsonPath);
}
function printFinalMessage({ learnMoreLink, appendLines, }) {
    output_1.output.success({
        title: '🎉 Done!',
        bodyLines: [
            `- Learn more about what to do next at ${learnMoreLink ?? 'https://nx.dev/getting-started/adding-to-existing'}`,
            ...(appendLines ?? []),
        ].filter(Boolean),
    });
}
function isMonorepo(packageJson) {
    if (!!packageJson.workspaces)
        return true;
    try {
        const content = (0, fs_1.readFileSync)('pnpm-workspace.yaml', 'utf-8');
        const { load } = require('@zkochan/js-yaml');
        const { packages } = load(content) ?? {};
        if (packages) {
            return true;
        }
    }
    catch { }
    if ((0, fs_1.existsSync)('lerna.json'))
        return true;
    return false;
}
