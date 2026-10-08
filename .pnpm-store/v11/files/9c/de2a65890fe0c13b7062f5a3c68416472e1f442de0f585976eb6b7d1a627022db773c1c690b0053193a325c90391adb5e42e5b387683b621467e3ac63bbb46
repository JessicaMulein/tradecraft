import { MigrationsJson } from '../../config/misc-interfaces';
export declare const AI_MIGRATIONS_DIR: string;
export declare function promptContentKey(packageName: string, promptRelPath: string): string;
export declare function validateMigrationEntries(packageName: string, packageVersion: string, migrations: MigrationsJson): void;
/**
 * Thrown when the markdown prompt file referenced by a migration cannot be
 * resolved.
 */
export declare class PromptResolutionError extends Error {
    readonly promptPath: string;
    readonly migrationsDir: string;
    constructor(promptPath: string, migrationsDir: string, options?: {
        cause?: unknown;
    });
}
/**
 * Resolves a migration prompt file path to an absolute path. Prompt paths are
 * plain markdown files referenced relative to the directory containing the
 * `migrations.json` - unlike schemas, they are not resolved through package
 * exports or `require.resolve`. The path must stay within the migrations
 * directory and point at an existing file.
 */
export declare function resolvePrompt(promptPath: string, migrationsDir: string): string;
export declare function extractPromptFilesFromTarball(packageName: string, packageVersion: string, migrations: MigrationsJson, migrationsFilePath: string, fullTarballPath: string, destDir: string): Promise<Record<string, string> | undefined>;
export declare function readPromptFilesFromInstall(packageName: string, packageVersion: string, migrations: MigrationsJson, migrationsFilePath: string): Promise<Record<string, string> | undefined>;
export declare function writePromptMigrationFiles(root: string, migrations: {
    package: string;
    name: string;
    version: string;
    prompt?: string;
}[], promptContents: Record<string, string>, targetVersion: string): string[];
