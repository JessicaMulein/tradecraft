"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKSPACE_PLUGIN_DIR = exports.WORKSPACE_RULES_PROJECT_NAME = void 0;
exports.lintWorkspaceRulesProjectGenerator = lintWorkspaceRulesProjectGenerator;
const devkit_1 = require("@nx/devkit");
const js_1 = require("@nx/js");
const internal_1 = require("@nx/js/internal");
const path_1 = require("path");
const assert_supported_eslint_version_1 = require("../../utils/assert-supported-eslint-version");
const versions_1 = require("../../utils/versions");
const workspace_lint_rules_1 = require("../../utils/workspace-lint-rules");
exports.WORKSPACE_RULES_PROJECT_NAME = 'eslint-rules';
exports.WORKSPACE_PLUGIN_DIR = 'tools/eslint-rules';
async function lintWorkspaceRulesProjectGenerator(tree, options = {}) {
    (0, assert_supported_eslint_version_1.assertSupportedEslintVersion)(tree);
    const { configurationGenerator } = (0, devkit_1.ensurePackage)('@nx/jest', versions_1.nxVersion);
    const tasks = [];
    // Noop if the workspace rules project already exists
    try {
        (0, devkit_1.readProjectConfiguration)(tree, exports.WORKSPACE_RULES_PROJECT_NAME);
        return;
    }
    catch { }
    // Create the project, the test target is added below by the jest generator
    (0, devkit_1.addProjectConfiguration)(tree, exports.WORKSPACE_RULES_PROJECT_NAME, {
        root: exports.WORKSPACE_PLUGIN_DIR,
        sourceRoot: exports.WORKSPACE_PLUGIN_DIR,
        targets: {},
    });
    // Generate the required files
    (0, devkit_1.generateFiles)(tree, (0, path_1.join)(__dirname, 'files'), workspace_lint_rules_1.workspaceLintPluginDir, {
        tmpl: '',
        offsetFromRoot: (0, devkit_1.offsetFromRoot)(exports.WORKSPACE_PLUGIN_DIR),
        rootTsConfigPath: (0, js_1.getRelativePathToRootTsConfig)(tree, exports.WORKSPACE_PLUGIN_DIR),
    });
    /**
     * Ensure that when workspace rules are updated they cause all projects to be affected for now.
     * TODO: Explore writing a ProjectGraph plugin to make this more surgical.
     */
    const nxJson = (0, devkit_1.readNxJson)(tree);
    const lintEntry = findLintTargetDefault(nxJson.targetDefaults);
    if (lintEntry?.inputs) {
        lintEntry.inputs.push(`{workspaceRoot}/${exports.WORKSPACE_PLUGIN_DIR}/**/*`);
        (0, devkit_1.updateNxJson)(tree, nxJson);
    }
    // Add jest to the project and return installation task
    tasks.push(await configurationGenerator(tree, {
        ...options,
        project: exports.WORKSPACE_RULES_PROJECT_NAME,
        supportTsx: false,
        skipSerializers: true,
        setupFile: 'none',
        compiler: (0, internal_1.isUsingTsSolutionSetup)(tree) ? 'swc' : 'tsc',
        skipFormat: true,
        testEnvironment: 'node',
    }));
    (0, devkit_1.updateJson)(tree, (0, path_1.join)(workspace_lint_rules_1.workspaceLintPluginDir, 'tsconfig.spec.json'), (json) => {
        delete json.compilerOptions?.module;
        delete json.compilerOptions?.moduleResolution;
        // Inherits `module: node16` from the project's base `tsconfig.json`,
        // which requires `isolatedModules: true` to reliably honor packages'
        // `exports` maps (e.g. `@typescript-eslint/rule-tester`).
        json.compilerOptions = {
            ...json.compilerOptions,
            isolatedModules: true,
        };
        if (json.include) {
            json.include = json.include.map((v) => {
                if (v.startsWith('src/**')) {
                    return v.replace('src/', '');
                }
                return v;
            });
        }
        if (json.exclude) {
            json.exclude = json.exclude.map((v) => {
                if (v.startsWith('src/**')) {
                    return v.replace('src/', '');
                }
                return v;
            });
        }
        return json;
    });
    // Add swc dependencies
    tasks.push((0, internal_1.addSwcRegisterDependencies)(tree));
    const { typescriptESLintVersion } = (0, versions_1.versions)(tree);
    tasks.push((0, devkit_1.addDependenciesToPackageJson)(tree, {}, {
        '@typescript-eslint/utils': typescriptESLintVersion,
    }, undefined, true));
    if (!options.skipFormat) {
        await (0, devkit_1.formatFiles)(tree);
    }
    return (0, devkit_1.runTasksInSerial)(...tasks);
}
function findLintTargetDefault(td) {
    const value = td?.['lint'];
    if (value === undefined)
        return undefined;
    // A target default value can be a plain config object or an array of
    // filtered entries; use the filter-less (catch-all) entry.
    if (Array.isArray(value)) {
        const found = value.find((e) => e.filter === undefined);
        if (!found)
            return undefined;
        const { filter: _filter, ...rest } = found;
        return rest;
    }
    return value;
}
