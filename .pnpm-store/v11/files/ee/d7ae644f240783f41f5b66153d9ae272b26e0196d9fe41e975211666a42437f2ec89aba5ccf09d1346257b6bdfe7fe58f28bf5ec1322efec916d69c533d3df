import type * as ts from 'typescript';
export type ModuleFormat = 'cjs' | 'esm';
/**
 * Decide module format from a parsed package.json `type` field alone.
 * Returns `null` when the field is unset or holds an unrecognized value -
 * callers can then fall back to other signals (tsconfig, defaults).
 */
export declare function getPackageJsonModuleFormat(packageJson: {
    type?: string;
} | null | undefined): ModuleFormat | null;
/**
 * Decide module format from tsconfig compiler options' `module` setting.
 * Returns `null` when the setting is unset OR when it is `NodeNext` /
 * `Node16` (those defer to the package.json `type` field, so the caller
 * should have already checked package.json).
 */
export declare function getTsConfigModuleFormat(compilerOptions: ts.CompilerOptions | null | undefined): ModuleFormat | null;
