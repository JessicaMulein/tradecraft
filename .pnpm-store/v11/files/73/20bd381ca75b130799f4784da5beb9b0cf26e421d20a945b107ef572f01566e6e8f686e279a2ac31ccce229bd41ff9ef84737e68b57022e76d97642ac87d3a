"use strict";
// Semi-private surface for first-party Nx packages.
//
// External plugins should NOT import from here — this entry is curated for
// internal consumers and may change without semver protection. Consider it
// the @nx/js equivalent of `@nx/devkit/internal`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeLinterOption = exports.isValidPackageJsonBuildConfig = exports.addBuildAndWatchDepsTargets = exports.findNpmDependencies = exports.getProjectPackageManagerWorkspaceStateWarningTask = exports.getProjectPackageManagerWorkspaceState = exports.getNpmScope = exports.sortPackageJsonFields = exports.CopyAssetsHandler = exports.addSwcRegisterDependencies = exports.addSwcDependencies = exports.addSwcTestConfig = exports.addSwcConfig = exports.createTmpTsConfig = exports.computeCompilerOptionsPaths = exports.calculateProjectDependencies = exports.calculateProjectBuildableDependencies = exports.compileTypeScript = exports.getNeededCompilerOptionOverrides = exports.isTypescriptVersionAtLeast = exports.getTsConfigModuleResolution = exports.getRangeMinimum = exports.ensureTypescript = exports.createTreeParseConfigHost = exports.getTsConfigBaseOptions = exports.updateTsconfigFiles = exports.shouldConfigureTsSolutionSetup = exports.isUsingTsSolutionSetup = exports.getProjectType = exports.getProjectSourceRoot = exports.getDefinedCustomConditionName = exports.findRuntimeTsConfigName = exports.assertNotUsingTsSolutionSetup = exports.addProjectToTsSolutionWorkspace = exports.TS_SOLUTION_SETUP_TSCONFIG_INPUT = exports.addPnpmDeployOutputCacheInputs = exports.shouldIncludePnpmMajorRuntimeInput = exports.pnpmInstallSettingsInputsForInferredTarget = exports.PNPM_MAJOR_RUNTIME_INPUT = exports.PNPM_INSTALL_SETTINGS_INPUTS = exports.isEsmProject = exports.walkTsconfigExtendsChain = exports.findProjectsNpmDependencies = exports.isBuiltinModuleImport = exports.TargetProjectLocator = exports.requireWithTsconfigFallback = exports.registerTsConfigPaths = exports.registerTsProject = exports.loadTsFile = exports.forceRegisterEsmLoader = void 0;
exports.typesNodeVersion = exports.tsLibVersion = exports.swcNodeVersion = exports.swcHelpersVersion = exports.swcCoreVersion = exports.swcCliVersion = exports.prettierVersion = exports.esbuildVersion = exports.nxVersion = exports.releaseTasks = exports.addReleaseConfigForTsSolution = exports.addReleaseConfigForNonTsSolution = exports.addLocalRegistryScripts = exports.stripGlobToBaseDir = exports.getImportPath = exports.createGlobPatternsForDependencies = exports.addLintingToProject = exports.detectLinters = exports.normalizeUnitTestRunnerOption = void 0;
// Re-exports of nx-source internals.
var internal_1 = require("@nx/devkit/internal");
Object.defineProperty(exports, "forceRegisterEsmLoader", { enumerable: true, get: function () { return internal_1.forceRegisterEsmLoader; } });
Object.defineProperty(exports, "loadTsFile", { enumerable: true, get: function () { return internal_1.loadTsFile; } });
Object.defineProperty(exports, "registerTsProject", { enumerable: true, get: function () { return internal_1.registerTsProject; } });
Object.defineProperty(exports, "registerTsConfigPaths", { enumerable: true, get: function () { return internal_1.registerTsConfigPaths; } });
Object.defineProperty(exports, "requireWithTsconfigFallback", { enumerable: true, get: function () { return internal_1.requireWithTsconfigFallback; } });
var internal_2 = require("@nx/devkit/internal");
Object.defineProperty(exports, "TargetProjectLocator", { enumerable: true, get: function () { return internal_2.TargetProjectLocator; } });
Object.defineProperty(exports, "isBuiltinModuleImport", { enumerable: true, get: function () { return internal_2.isBuiltinModuleImport; } });
var internal_3 = require("@nx/devkit/internal");
Object.defineProperty(exports, "findProjectsNpmDependencies", { enumerable: true, get: function () { return internal_3.findProjectsNpmDependencies; } });
// Raw tsconfig walkers (the other AST utils ship via the public @nx/js entry)
var raw_tsconfig_1 = require("./src/utils/typescript/raw-tsconfig");
Object.defineProperty(exports, "walkTsconfigExtendsChain", { enumerable: true, get: function () { return raw_tsconfig_1.walkTsconfigExtendsChain; } });
// Module-format detection for generators (project package.json `type` field +
// TS solution awareness; mirrors Node's nearest-package.json semantics).
var is_esm_project_1 = require("./src/utils/module-format/is-esm-project");
Object.defineProperty(exports, "isEsmProject", { enumerable: true, get: function () { return is_esm_project_1.isEsmProject; } });
// Inputs for build targets that emit a pruned pnpm deploy output
var pnpm_install_settings_inputs_1 = require("./src/utils/pnpm-install-settings-inputs");
Object.defineProperty(exports, "PNPM_INSTALL_SETTINGS_INPUTS", { enumerable: true, get: function () { return pnpm_install_settings_inputs_1.PNPM_INSTALL_SETTINGS_INPUTS; } });
Object.defineProperty(exports, "PNPM_MAJOR_RUNTIME_INPUT", { enumerable: true, get: function () { return pnpm_install_settings_inputs_1.PNPM_MAJOR_RUNTIME_INPUT; } });
Object.defineProperty(exports, "pnpmInstallSettingsInputsForInferredTarget", { enumerable: true, get: function () { return pnpm_install_settings_inputs_1.pnpmInstallSettingsInputsForInferredTarget; } });
Object.defineProperty(exports, "shouldIncludePnpmMajorRuntimeInput", { enumerable: true, get: function () { return pnpm_install_settings_inputs_1.shouldIncludePnpmMajorRuntimeInput; } });
var pnpm_deploy_output_cache_inputs_1 = require("./src/utils/pnpm-deploy-output-cache-inputs");
Object.defineProperty(exports, "addPnpmDeployOutputCacheInputs", { enumerable: true, get: function () { return pnpm_deploy_output_cache_inputs_1.addPnpmDeployOutputCacheInputs; } });
// TS solution setup detection
var ts_solution_setup_1 = require("./src/utils/typescript/ts-solution-setup");
Object.defineProperty(exports, "TS_SOLUTION_SETUP_TSCONFIG_INPUT", { enumerable: true, get: function () { return ts_solution_setup_1.TS_SOLUTION_SETUP_TSCONFIG_INPUT; } });
Object.defineProperty(exports, "addProjectToTsSolutionWorkspace", { enumerable: true, get: function () { return ts_solution_setup_1.addProjectToTsSolutionWorkspace; } });
Object.defineProperty(exports, "assertNotUsingTsSolutionSetup", { enumerable: true, get: function () { return ts_solution_setup_1.assertNotUsingTsSolutionSetup; } });
Object.defineProperty(exports, "findRuntimeTsConfigName", { enumerable: true, get: function () { return ts_solution_setup_1.findRuntimeTsConfigName; } });
Object.defineProperty(exports, "getDefinedCustomConditionName", { enumerable: true, get: function () { return ts_solution_setup_1.getDefinedCustomConditionName; } });
Object.defineProperty(exports, "getProjectSourceRoot", { enumerable: true, get: function () { return ts_solution_setup_1.getProjectSourceRoot; } });
Object.defineProperty(exports, "getProjectType", { enumerable: true, get: function () { return ts_solution_setup_1.getProjectType; } });
Object.defineProperty(exports, "isUsingTsSolutionSetup", { enumerable: true, get: function () { return ts_solution_setup_1.isUsingTsSolutionSetup; } });
Object.defineProperty(exports, "shouldConfigureTsSolutionSetup", { enumerable: true, get: function () { return ts_solution_setup_1.shouldConfigureTsSolutionSetup; } });
Object.defineProperty(exports, "updateTsconfigFiles", { enumerable: true, get: function () { return ts_solution_setup_1.updateTsconfigFiles; } });
// TypeScript helpers. resolvePathsBaseUrl, extractTsConfigBase,
// tsConfigBaseOptions, addTsLibDependencies, and resolveModuleByImport ship via
// the public @nx/js entry. getTsConfigBaseOptions is public too, but is
// re-exported here so internal consumers can import it from @nx/js/internal.
var create_ts_config_1 = require("./src/utils/typescript/create-ts-config");
Object.defineProperty(exports, "getTsConfigBaseOptions", { enumerable: true, get: function () { return create_ts_config_1.getTsConfigBaseOptions; } });
var ts_config_1 = require("./src/utils/typescript/ts-config");
Object.defineProperty(exports, "createTreeParseConfigHost", { enumerable: true, get: function () { return ts_config_1.createTreeParseConfigHost; } });
var ensure_typescript_1 = require("./src/utils/typescript/ensure-typescript");
Object.defineProperty(exports, "ensureTypescript", { enumerable: true, get: function () { return ensure_typescript_1.ensureTypescript; } });
var is_typescript_version_at_least_1 = require("./src/utils/is-typescript-version-at-least");
Object.defineProperty(exports, "getRangeMinimum", { enumerable: true, get: function () { return is_typescript_version_at_least_1.getRangeMinimum; } });
Object.defineProperty(exports, "getTsConfigModuleResolution", { enumerable: true, get: function () { return is_typescript_version_at_least_1.getTsConfigModuleResolution; } });
Object.defineProperty(exports, "isTypescriptVersionAtLeast", { enumerable: true, get: function () { return is_typescript_version_at_least_1.isTypescriptVersionAtLeast; } });
var configuration_1 = require("./src/utils/typescript/configuration");
Object.defineProperty(exports, "getNeededCompilerOptionOverrides", { enumerable: true, get: function () { return configuration_1.getNeededCompilerOptionOverrides; } });
var compilation_1 = require("./src/utils/typescript/compilation");
Object.defineProperty(exports, "compileTypeScript", { enumerable: true, get: function () { return compilation_1.compileTypeScript; } });
// Build orchestration
var buildable_libs_utils_1 = require("./src/utils/buildable-libs-utils");
Object.defineProperty(exports, "calculateProjectBuildableDependencies", { enumerable: true, get: function () { return buildable_libs_utils_1.calculateProjectBuildableDependencies; } });
Object.defineProperty(exports, "calculateProjectDependencies", { enumerable: true, get: function () { return buildable_libs_utils_1.calculateProjectDependencies; } });
Object.defineProperty(exports, "computeCompilerOptionsPaths", { enumerable: true, get: function () { return buildable_libs_utils_1.computeCompilerOptionsPaths; } });
Object.defineProperty(exports, "createTmpTsConfig", { enumerable: true, get: function () { return buildable_libs_utils_1.createTmpTsConfig; } });
// SWC helpers
var add_swc_config_1 = require("./src/utils/swc/add-swc-config");
Object.defineProperty(exports, "addSwcConfig", { enumerable: true, get: function () { return add_swc_config_1.addSwcConfig; } });
Object.defineProperty(exports, "addSwcTestConfig", { enumerable: true, get: function () { return add_swc_config_1.addSwcTestConfig; } });
var add_swc_dependencies_1 = require("./src/utils/swc/add-swc-dependencies");
Object.defineProperty(exports, "addSwcDependencies", { enumerable: true, get: function () { return add_swc_dependencies_1.addSwcDependencies; } });
Object.defineProperty(exports, "addSwcRegisterDependencies", { enumerable: true, get: function () { return add_swc_dependencies_1.addSwcRegisterDependencies; } });
var copy_assets_handler_1 = require("./src/utils/assets/copy-assets-handler");
Object.defineProperty(exports, "CopyAssetsHandler", { enumerable: true, get: function () { return copy_assets_handler_1.CopyAssetsHandler; } });
// Package-manager / package.json helpers
var sort_fields_1 = require("./src/utils/package-json/sort-fields");
Object.defineProperty(exports, "sortPackageJsonFields", { enumerable: true, get: function () { return sort_fields_1.sortPackageJsonFields; } });
var get_npm_scope_1 = require("./src/utils/package-json/get-npm-scope");
Object.defineProperty(exports, "getNpmScope", { enumerable: true, get: function () { return get_npm_scope_1.getNpmScope; } });
var package_manager_workspaces_1 = require("./src/utils/package-manager-workspaces");
Object.defineProperty(exports, "getProjectPackageManagerWorkspaceState", { enumerable: true, get: function () { return package_manager_workspaces_1.getProjectPackageManagerWorkspaceState; } });
Object.defineProperty(exports, "getProjectPackageManagerWorkspaceStateWarningTask", { enumerable: true, get: function () { return package_manager_workspaces_1.getProjectPackageManagerWorkspaceStateWarningTask; } });
var find_npm_dependencies_1 = require("./src/utils/find-npm-dependencies");
Object.defineProperty(exports, "findNpmDependencies", { enumerable: true, get: function () { return find_npm_dependencies_1.findNpmDependencies; } });
// Plugin helpers
var util_1 = require("./src/plugins/typescript/util");
Object.defineProperty(exports, "addBuildAndWatchDepsTargets", { enumerable: true, get: function () { return util_1.addBuildAndWatchDepsTargets; } });
Object.defineProperty(exports, "isValidPackageJsonBuildConfig", { enumerable: true, get: function () { return util_1.isValidPackageJsonBuildConfig; } });
// Generator helpers
var generator_prompts_1 = require("./src/utils/generator-prompts");
Object.defineProperty(exports, "normalizeLinterOption", { enumerable: true, get: function () { return generator_prompts_1.normalizeLinterOption; } });
Object.defineProperty(exports, "normalizeUnitTestRunnerOption", { enumerable: true, get: function () { return generator_prompts_1.normalizeUnitTestRunnerOption; } });
var linter_1 = require("./src/utils/linter");
Object.defineProperty(exports, "detectLinters", { enumerable: true, get: function () { return linter_1.detectLinters; } });
var add_linting_to_project_1 = require("./src/utils/add-linting-to-project");
Object.defineProperty(exports, "addLintingToProject", { enumerable: true, get: function () { return add_linting_to_project_1.addLintingToProject; } });
var generate_globs_1 = require("./src/utils/generate-globs");
Object.defineProperty(exports, "createGlobPatternsForDependencies", { enumerable: true, get: function () { return generate_globs_1.createGlobPatternsForDependencies; } });
var get_import_path_1 = require("./src/utils/get-import-path");
Object.defineProperty(exports, "getImportPath", { enumerable: true, get: function () { return get_import_path_1.getImportPath; } });
var strip_glob_to_base_dir_1 = require("./src/utils/strip-glob-to-base-dir");
Object.defineProperty(exports, "stripGlobToBaseDir", { enumerable: true, get: function () { return strip_glob_to_base_dir_1.stripGlobToBaseDir; } });
var add_local_registry_scripts_1 = require("./src/utils/add-local-registry-scripts");
Object.defineProperty(exports, "addLocalRegistryScripts", { enumerable: true, get: function () { return add_local_registry_scripts_1.addLocalRegistryScripts; } });
var add_release_config_1 = require("./src/generators/library/utils/add-release-config");
Object.defineProperty(exports, "addReleaseConfigForNonTsSolution", { enumerable: true, get: function () { return add_release_config_1.addReleaseConfigForNonTsSolution; } });
Object.defineProperty(exports, "addReleaseConfigForTsSolution", { enumerable: true, get: function () { return add_release_config_1.addReleaseConfigForTsSolution; } });
Object.defineProperty(exports, "releaseTasks", { enumerable: true, get: function () { return add_release_config_1.releaseTasks; } });
// Version constants
var versions_1 = require("./src/utils/versions");
Object.defineProperty(exports, "nxVersion", { enumerable: true, get: function () { return versions_1.nxVersion; } });
Object.defineProperty(exports, "esbuildVersion", { enumerable: true, get: function () { return versions_1.esbuildVersion; } });
Object.defineProperty(exports, "prettierVersion", { enumerable: true, get: function () { return versions_1.prettierVersion; } });
Object.defineProperty(exports, "swcCliVersion", { enumerable: true, get: function () { return versions_1.swcCliVersion; } });
Object.defineProperty(exports, "swcCoreVersion", { enumerable: true, get: function () { return versions_1.swcCoreVersion; } });
Object.defineProperty(exports, "swcHelpersVersion", { enumerable: true, get: function () { return versions_1.swcHelpersVersion; } });
Object.defineProperty(exports, "swcNodeVersion", { enumerable: true, get: function () { return versions_1.swcNodeVersion; } });
Object.defineProperty(exports, "tsLibVersion", { enumerable: true, get: function () { return versions_1.tsLibVersion; } });
Object.defineProperty(exports, "typesNodeVersion", { enumerable: true, get: function () { return versions_1.typesNodeVersion; } });
