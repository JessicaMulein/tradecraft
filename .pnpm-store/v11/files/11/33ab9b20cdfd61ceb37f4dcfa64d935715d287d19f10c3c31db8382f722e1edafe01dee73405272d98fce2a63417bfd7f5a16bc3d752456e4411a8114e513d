import type { TSESLint } from '@typescript-eslint/utils';
import type { AST } from 'jsonc-eslint-parser';
import { ProjectConfiguration } from '@nx/devkit';
export type Options = [
    {
        generatorsJson?: string;
        executorsJson?: string;
        migrationsJson?: string;
        packageJson?: string;
        allowedVersionStrings: string[];
        tsConfig?: string;
    }
];
export type MessageIds = 'missingRequiredSchema' | 'invalidSchemaPath' | 'missingImplementation' | 'invalidImplementationPath' | 'invalidImplementationModule' | 'unableToReadImplementationExports' | 'invalidPromptPath' | 'invalidVersion' | 'missingVersion' | 'noGeneratorsOrSchematicsFound' | 'noExecutorsOrBuildersFound' | 'valueShouldBeObject' | 'duplicateKey';
export declare const RULE_NAME = "nx-plugin-checks";
declare const _default: TSESLint.RuleModule<MessageIds, Options, unknown, TSESLint.RuleListener> & {
    name: string;
};
export default _default;
export declare function checkCollectionFileNode(baseNode: AST.JSONObjectExpression, mode: 'migration' | 'generator' | 'executor', context: TSESLint.RuleContext<MessageIds, Options>, projects: Record<string, ProjectConfiguration>): void;
export declare function checkCollectionNode(baseNode: AST.JSONObjectExpression, mode: 'migration' | 'generator' | 'executor', context: TSESLint.RuleContext<MessageIds, Options>, projects: Record<string, ProjectConfiguration>): void;
export declare function validateEntry(baseNode: AST.JSONObjectExpression, key: string, mode: 'migration' | 'generator' | 'executor', context: TSESLint.RuleContext<MessageIds, Options>, projects: Record<string, ProjectConfiguration>): void;
export declare function validateImplementationNode(implementationNode: AST.JSONProperty, key: string, context: TSESLint.RuleContext<MessageIds, Options>, projects: Record<string, ProjectConfiguration>): void;
export declare function validatePromptNode(promptNode: AST.JSONProperty, key: string, context: TSESLint.RuleContext<MessageIds, Options>): void;
export declare function validatePackageGroup(baseNode: AST.JSONObjectExpression, context: TSESLint.RuleContext<MessageIds, Options>): void;
/**
 * A duplicate key anywhere in these manifests silently drops data:
 * JSON parsers keep only the last occurrence, so a duplicated generator,
 * executor, or migration entry key discards the earlier definition with no
 * error at runtime.
 */
export declare function validateNoDuplicateKeys(node: AST.JSONObjectExpression | AST.JSONArrayExpression, context: TSESLint.RuleContext<MessageIds, Options>): void;
export declare function validateVersionJsonExpression(node: AST.JSONExpression, context: TSESLint.RuleContext<MessageIds, Options>): string | boolean;
export declare function checkIfIdentifierIsFunction(filePath: string, identifier: string): boolean;
