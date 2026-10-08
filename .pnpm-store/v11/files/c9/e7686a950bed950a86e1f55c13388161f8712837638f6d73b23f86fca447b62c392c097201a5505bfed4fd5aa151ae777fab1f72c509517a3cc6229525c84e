"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addLintingToProject = addLintingToProject;
const devkit_1 = require("@nx/devkit");
const internal_1 = require("@nx/devkit/internal");
const versions_1 = require("./versions");
const linter_1 = require("./linter");
/**
 * Sets a project's linter up, dispatching to whichever linter the workspace
 * asked for. Consumers call this instead of importing `lintProjectGenerator`
 * from `@nx/eslint` directly, so adding a linter does not mean editing every
 * generator. The two arms name different generators on purpose: `@nx/eslint`
 * writes a lint target, while `@nx/oxlint` is inference-only and only
 * configures the project.
 *
 * Scope is deliberately narrow: registering the linter and its project target.
 * Linter-specific config shaping — ESLint framework presets, `extends`, ignore
 * entries — stays at the call site guarded on `linter`, because none of it has
 * a cross-linter equivalent.
 *
 * Both plugins are loaded through `ensurePackage`; a static import would be
 * circular, since both depend on `@nx/js`.
 */
async function addLintingToProject(tree, options) {
    // Callers should resolve this themselves, since their own guards need a
    // concrete value. Resolving again here keeps a caller that forgets from
    // silently getting ESLint in a workspace that uses something else.
    const linter = options.linter ?? (0, linter_1.detectLinters)(tree)[0] ?? 'none';
    if (linter === 'none') {
        return () => { };
    }
    if (linter === 'oxlint') {
        // `ensurePackage` installs by package name, so the subpath is required
        // separately. `nx-ignore-next-line` keeps this out of the import graph, so
        // the dependency stays a devDependency of this package rather than a runtime
        // one. That devDependency is what makes the `js` <-> `@nx/oxlint` cycle,
        // which is deliberate and recorded in `ignoredCircularDependencies` in the
        // root eslint config.
        (0, devkit_1.ensurePackage)('@nx/oxlint', versions_1.nxVersion);
        // `@nx/oxlint` is the only ESM package under `packages/` and its
        // `./generators` subpath has no `require` condition, so a bare `require()`
        // throws ERR_REQUIRE_ESM below Node 20.19 / 22.12.
        //
        // Resolve to an absolute path before importing. `ensurePackage` exposes an
        // on-demand install by adding a temp dir to NODE_PATH, which `require.resolve`
        // honours and the ESM loader does not — so handing `import()` a bare specifier
        // fails with ERR_MODULE_NOT_FOUND on exactly the Node band this indirection
        // exists for. `load-resolved-plugin.ts` calls `handleImport` the same way.
        // nx-ignore-next-line
        const generatorsPath = require.resolve('@nx/oxlint/generators', {
            paths: [devkit_1.workspaceRoot, __dirname],
        });
        const { configurationGenerator } = await (0, internal_1.handleImport)(generatorsPath);
        return configurationGenerator(tree, {
            project: options.project,
            plugins: [
                ...(options.oxlintPlugins ?? []),
                ...oxlintTestPlugins(options.unitTestRunner),
            ],
            skipFormat: true,
            skipPackageJson: options.skipPackageJson,
            keepExistingVersions: options.keepExistingVersions,
            // No `addPlugin`: `@nx/oxlint` is inference-only, so it always registers.
        });
    }
    if (linter === 'eslint') {
        const { lintProjectGenerator } = (0, devkit_1.ensurePackage)('@nx/eslint', versions_1.nxVersion);
        return lintProjectGenerator(tree, {
            linter,
            project: options.project,
            tsConfigPaths: options.tsConfigPaths,
            unitTestRunner: options.unitTestRunner,
            rootProject: options.rootProject,
            enableTypedLinting: options.enableTypedLinting,
            addExplicitTargets: options.addExplicitTargets,
            addPackageJsonDependencyChecks: options.addPackageJsonDependencyChecks,
            skipFormat: true,
            skipPackageJson: options.skipPackageJson,
            keepExistingVersions: options.keepExistingVersions,
            addPlugin: options.addPlugin,
        });
    }
    // Spelling ESLint out as its own branch rather than letting it be the
    // fallthrough: a new `LinterType` member then fails to compile here instead of
    // silently getting an ESLint setup.
    const unhandled = linter;
    throw new Error(`Unsupported linter: ${unhandled}`);
}
/**
 * Which Oxlint plugins a test runner needs is the runner package's knowledge,
 * so it is read from there rather than hardcoded here — this only maps the
 * runner name to its package. Matched loosely because runners arrive with
 * suffixes, e.g. Angular's `vitest-analog`. Both packages are already installed
 * by the time the runner's own generator runs; `ensurePackage` keeps them out
 * of the import graph, since both depend on `@nx/js`.
 */
function oxlintTestPlugins(unitTestRunner) {
    const pkg = unitTestRunner?.includes('vitest')
        ? '@nx/vitest'
        : unitTestRunner?.includes('jest')
            ? '@nx/jest'
            : undefined;
    if (!pkg) {
        return [];
    }
    // `ensurePackage` installs by package name, so the `internal` subpath is
    // required separately. Plain `require` holds only while both runners are CJS;
    // `@nx/oxlint` is ESM, which is why the arm above needs `handleImport`.
    (0, devkit_1.ensurePackage)(pkg, versions_1.nxVersion);
    const { oxlintPlugins } = require(`${pkg}/internal`);
    return oxlintPlugins ?? [];
}
