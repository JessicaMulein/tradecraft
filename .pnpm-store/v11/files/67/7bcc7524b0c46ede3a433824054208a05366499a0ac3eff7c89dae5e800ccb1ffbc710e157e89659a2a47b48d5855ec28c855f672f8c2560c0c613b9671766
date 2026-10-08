import type { FileChange } from '../../../../generators/tree';
export declare function renderFileEntry(change: FileChange): string;
export declare function renderListItem(entry: string): string;
export declare function renderKeyMultilineValue(key: string, value: string): string[];
export declare function stripAnsi(text: string): string;
export declare function filterNonEmptyStrings(entries: unknown[]): string[];
export declare function escapeXmlBody(value: string): string;
export declare function renderGitInspectInstruction(): string;
export declare function renderGeneratorOutputBlock(logs: string): string[];
export interface MigrationBlockContext {
    package: string;
    name: string;
    version: string;
    description?: string;
}
export declare function renderMigrationBlock(ctx: MigrationBlockContext): string[];
export declare function renderHandoffPathFooter(handoffFileAbsolutePath: string): string[];
export declare function renderAdvisoryContext(note: string, entries: string[]): string[];
export declare function renderMigrationDocumentationBlock(documentationPath: string | undefined): string[];
