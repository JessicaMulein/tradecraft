import type { GeneratorCallback, Tree } from '@nx/devkit';
type FormatterSetup = {
    setUp: (tree: Tree, options: {
        skipPackageJson?: boolean;
    }) => GeneratorCallback;
    version: string;
};
/**
 * The setup for a formatter name that came from a schema, or `undefined` for
 * `'none'` and anything unrecognised.
 *
 * `hasOwnProperty` rather than `in`, which would answer `true` for inherited
 * members like `'constructor'` and hand back an `Object.prototype` function.
 */
export declare function getFormatterSetup(formatter: string | undefined): FormatterSetup | undefined;
/**
 * Writes the chosen formatter's config and queues its install.
 *
 * For callers that only need the formatter configured - a preset that creates
 * an empty workspace, say - rather than the whole of `@nx/js:init`. Does
 * nothing for `'none'` or an unrecognised value.
 */
export declare function setUpFormatter(tree: Tree, formatter: string | undefined, options?: {
    skipPackageJson?: boolean;
}): GeneratorCallback;
export {};
