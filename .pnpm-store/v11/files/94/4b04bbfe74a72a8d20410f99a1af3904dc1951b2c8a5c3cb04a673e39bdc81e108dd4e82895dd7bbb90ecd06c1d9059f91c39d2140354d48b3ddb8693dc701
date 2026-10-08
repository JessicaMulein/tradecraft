import { GeneratorCallback, Tree } from '@nx/devkit';
import { type LinterType } from './linter';
export interface AddLintingToProjectOptions {
    /** Required, but `undefined` still reaches here — see the normalization below. */
    linter: LinterType | undefined;
    project: string;
    skipPackageJson?: boolean;
    keepExistingVersions?: boolean;
    addPlugin?: boolean;
    /** ESLint-only. Ignored by other linters. */
    tsConfigPaths?: string[];
    unitTestRunner?: string;
    /** ESLint-only. Ignored by other linters. */
    rootProject?: boolean;
    /** ESLint-only. Ignored by other linters. */
    enableTypedLinting?: boolean;
    /** ESLint-only. Oxlint is inference-only, so it writes no explicit target. */
    addExplicitTargets?: boolean;
    /**
     * ESLint-only. The `@nx/dependency-checks` rule lints `package.json`, which
     * Oxlint cannot read.
     */
    addPackageJsonDependencyChecks?: boolean;
    /**
     * Oxlint plugins to enable for this project, e.g. `['react', 'jsx-a11y']`.
     * Ignored by other linters, which express framework presets differently.
     */
    oxlintPlugins?: string[];
}
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
export declare function addLintingToProject(tree: Tree, options: AddLintingToProjectOptions): Promise<GeneratorCallback>;
