import type { Tree } from '../../generators/tree';
/**
 * Config filenames prettier discovers. Exported because generator setup must
 * agree with detection - a format missing from one side gets a second,
 * redundant config written next to it.
 * https://prettier.io/docs/configuration
 */
export declare const prettierConfigFiles: string[];
export declare function isUsingPrettier(root: string): boolean;
export declare function isUsingPrettierInTree(tree: Tree): boolean;
/**
 * Keeps only the files prettier can format. oxfmt needs no equivalent - it
 * silently skips file types it does not handle.
 */
export declare function filterToPrettierSupportedFiles(files: string[]): Promise<string[]>;
export declare function writeWithPrettier(patterns: string[], cwd?: string): void;
export declare function checkWithPrettier(patterns: string[]): Promise<string[]>;
export declare function getPrettierPath(): string;
/**
 * Quote a pattern for prettier's shell-based exec calls; oxfmt uses execFile
 * and takes raw paths.
 *
 * Exported so `nx format` can size its chunks against the quoted length -
 * patterns are chunked before they get here, and quoting grows each one.
 */
export declare function quoteForShell(pattern: string): string;
