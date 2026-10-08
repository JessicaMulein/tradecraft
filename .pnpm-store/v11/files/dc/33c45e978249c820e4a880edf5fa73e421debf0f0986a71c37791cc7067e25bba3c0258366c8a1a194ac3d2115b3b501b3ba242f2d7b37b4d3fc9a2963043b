import type { Tree } from '../../generators/tree';
/**
 * Adding a member here does NOT reliably break compilation: the repo builds
 * with `strict: false`, so a `switch` that omits one is not an error. The
 * `never` assertions and type-keyed tables that do catch it fail immediately
 * inside `packages/nx`, but the ones in devkit and `@nx/js` read the type from
 * its emitted declarations, so those only fail once it has been rebuilt.
 */
export type FormatterType = 'prettier' | 'oxfmt';
/** Test-only: the warn-once flag is module state and would leak between cases. */
export declare function resetFormatterWarningsForTesting(): void;
export declare function detectFormatter(root: string): FormatterType | null;
export declare function detectFormatterInTree(tree: Tree): FormatterType | null;
