import { Tree } from '@nx/devkit';
import { ESLint } from 'eslint';
export declare function renameLegacyEslintrcFile(path: string, format: 'mjs' | 'cjs'): string;
/**
 * Converts an ESLint JSON config to a flat config.
 * Deletes the original file along with .eslintignore if it exists.
 */
export declare function convertEslintJsonToFlatConfig(tree: Tree, root: string, config: ESLint.ConfigData, ignorePaths: string[], format: 'cjs' | 'mjs'): {
    content: string;
    addESLintRC: boolean;
    addESLintJS: boolean;
};
