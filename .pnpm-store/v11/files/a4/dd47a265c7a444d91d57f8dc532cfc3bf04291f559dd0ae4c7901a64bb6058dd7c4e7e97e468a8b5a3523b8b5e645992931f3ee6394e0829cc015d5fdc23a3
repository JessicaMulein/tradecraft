import { type GeneratorCallback, type Tree } from '@nx/devkit';
import type { Linter } from 'eslint';
export declare function findEslintFile(tree: Tree, projectRoot?: string): string | null;
export declare function isEslintConfigSupported(tree: Tree, projectRoot?: string): boolean;
export declare function updateRelativePathsInConfig(tree: Tree, sourcePath: string, destinationPath: string): void;
export declare function determineEslintConfigFormat(content: string): 'mjs' | 'cjs';
/**
 * Honors both `enableTypedLinting` and the deprecated `setParserOptionsProject`
 * (slated for removal in Nx v24); either one truthy enables typed linting. A
 * generator whose `enableTypedLinting` schema default is `false` must still
 * honor a user who set the deprecated flag.
 */
export declare function isTypedLintingEnabled(options: {
    enableTypedLinting?: boolean;
    setParserOptionsProject?: boolean;
}): boolean;
/**
 * What a config says about typed linting.
 *
 * Only keys inside a `parserOptions` object count, so an unrelated `project`
 * (e.g. `settings['import/resolver'].typescript.project`) is not a false match.
 * A local array the config spreads in is read too, since ESLint merges those
 * entries in as if they were inline.
 */
export declare function inspectTypedLinting(content: string): TypedLintingReport;
/**
 * What a config configures for typed linting, read from its `parserOptions`
 * (a local array it spreads in included, since ESLint merges those entries).
 */
export interface TypedLintingReport {
    /**
     * Typed-linting parser options are set at all, an explicit
     * `projectService: false` opt-out included, since overwriting that would
     * undo a deliberate choice.
     */
    own: boolean;
    /**
     * The project service is on, which covers every file the config applies to
     * whichever tsconfig each one belongs to.
     */
    projectService: boolean;
    /** A `project` typescript-eslint builds a program from is set. */
    project: boolean;
    /**
     * A local `parserOptions` is present but set through an expression we can't
     * read statically (a call, an imported reference, a dynamic key), so whether
     * it configures typed linting is unknown. Distinct from a config that merely
     * spreads in another file (no local `parserOptions`), which stays safe to
     * append to.
     */
    uncertain: boolean;
}
/**
 * Adds a typed-linting block (`parserOptions.projectService` + `tsconfigRootDir`)
 * to a project's flat ESLint config. No-op for legacy `.eslintrc` configs, whose
 * JSON format cannot express the `__dirname` that `tsconfigRootDir` needs.
 *
 * Use after operations that strip existing overrides (e.g.
 * `replaceOverridesInLintConfig`) to re-establish typed linting.
 */
export declare function addTypedLintingToFlatConfig(tree: Tree, root: string): void;
export declare function addOverrideToLintConfig(tree: Tree, root: string, override: Partial<Linter.ConfigOverride<Linter.RulesRecord>>, options?: {
    insertAtTheEnd?: boolean;
    checkBaseConfig?: boolean;
}): void;
export declare function updateOverrideInLintConfig(tree: Tree, rootOrFile: string, lookup: (override: Linter.ConfigOverride<Linter.RulesRecord>) => boolean, update: (override: Linter.ConfigOverride<Linter.RulesRecord>) => Linter.ConfigOverride<Linter.RulesRecord>): void;
export declare function lintConfigHasOverride(tree: Tree, rootOrFile: string, lookup: (override: Linter.ConfigOverride<Linter.RulesRecord>) => boolean, checkBaseConfig?: boolean): boolean;
export declare function replaceOverridesInLintConfig(tree: Tree, root: string, overrides: Linter.ConfigOverride<Linter.RulesRecord>[]): void;
export declare function addExtendsToLintConfig(tree: Tree, root: string, plugin: string | {
    name: string;
    needCompatFixup: boolean;
} | Array<string | {
    name: string;
    needCompatFixup: boolean;
}>, insertAtTheEnd?: boolean): GeneratorCallback;
export declare function addPredefinedConfigToFlatLintConfig(tree: Tree, root: string, predefinedConfigName: string, options?: {
    moduleName?: string;
    moduleImportPath?: string;
    spread?: boolean;
    insertAtTheEnd?: boolean;
    checkBaseConfig?: boolean;
}): void;
export declare function addPluginsToLintConfig(tree: Tree, root: string, plugin: string | string[]): void;
export declare function addIgnoresToLintConfig(tree: Tree, root: string, ignorePatterns: string[]): void;
export declare function getPluginImport(pluginName: string): string;
