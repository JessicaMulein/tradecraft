"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromptResolutionError = exports.AI_MIGRATIONS_DIR = void 0;
exports.promptContentKey = promptContentKey;
exports.validateMigrationEntries = validateMigrationEntries;
exports.resolvePrompt = resolvePrompt;
exports.extractPromptFilesFromTarball = extractPromptFilesFromTarball;
exports.readPromptFilesFromInstall = readPromptFilesFromInstall;
exports.writePromptMigrationFiles = writePromptMigrationFiles;
const fs_1 = require("fs");
const path_1 = require("path");
const tar_1 = require("../../utils/tar");
const path_2 = require("../../utils/path");
exports.AI_MIGRATIONS_DIR = (0, path_2.joinPathFragments)('tools', 'ai-migrations');
function promptContentKey(packageName, promptRelPath) {
    return `${packageName}::${promptRelPath}`;
}
function* iterateMigrationEntries(migrations) {
    const merged = { ...migrations.schematics, ...migrations.generators };
    yield* Object.entries(merged);
}
function validateMigrationEntries(packageName, packageVersion, migrations) {
    for (const [migrationName, entry] of iterateMigrationEntries(migrations)) {
        if (!entry.implementation && !entry.factory && !entry.prompt) {
            throw new Error(`Invalid migration "${migrationName}" in package "${packageName}@${packageVersion}": migration entries must have at least one of "implementation", "factory", or "prompt".`);
        }
    }
}
async function resolvePromptFiles(packageName, packageVersion, migrations, migrationsDir, resolveContent) {
    const resolvedPromptFiles = {};
    for (const [migrationName, entry] of iterateMigrationEntries(migrations)) {
        if (!entry.prompt || resolvedPromptFiles[entry.prompt] !== undefined) {
            continue;
        }
        assertPromptPathWithinMigrationsDir(migrationsDir, entry.prompt, packageName, packageVersion);
        try {
            resolvedPromptFiles[entry.prompt] = await resolveContent(entry.prompt);
        }
        catch (e) {
            throw new Error(`Could not find prompt file "${entry.prompt}" for migration "${migrationName}" in package "${packageName}@${packageVersion}".`, { cause: e });
        }
    }
    return Object.keys(resolvedPromptFiles).length > 0
        ? resolvedPromptFiles
        : undefined;
}
function assertPromptPathWithinMigrationsDir(migrationsDir, promptRelPath, packageName, packageVersion) {
    if (!(0, path_2.isContainedRelativePath)(promptRelPath)) {
        throw new Error(`Invalid prompt path "${promptRelPath}" in package "${packageName}@${packageVersion}": prompt paths must be relative and resolve within the package's migrations directory.`);
    }
}
/**
 * Thrown when the markdown prompt file referenced by a migration cannot be
 * resolved.
 */
class PromptResolutionError extends Error {
    constructor(promptPath, migrationsDir, options) {
        super(`Could not resolve prompt "${promptPath}" from "${migrationsDir}".`, options);
        this.promptPath = promptPath;
        this.migrationsDir = migrationsDir;
        this.name = 'PromptResolutionError';
    }
}
exports.PromptResolutionError = PromptResolutionError;
/**
 * Resolves a migration prompt file path to an absolute path. Prompt paths are
 * plain markdown files referenced relative to the directory containing the
 * `migrations.json` - unlike schemas, they are not resolved through package
 * exports or `require.resolve`. The path must stay within the migrations
 * directory and point at an existing file.
 */
function resolvePrompt(promptPath, migrationsDir) {
    if (!(0, path_2.isContainedRelativePath)(promptPath)) {
        throw new PromptResolutionError(promptPath, migrationsDir);
    }
    const resolvedPath = (0, path_1.join)(migrationsDir, promptPath);
    if (!(0, fs_1.existsSync)(resolvedPath)) {
        throw new PromptResolutionError(promptPath, migrationsDir);
    }
    return resolvedPath;
}
function extractPromptFilesFromTarball(packageName, packageVersion, migrations, migrationsFilePath, fullTarballPath, destDir) {
    const migrationsDir = (0, path_1.dirname)(migrationsFilePath);
    return resolvePromptFiles(packageName, packageVersion, migrations, migrationsDir, async (promptRelPath) => {
        const promptInTarball = (0, path_2.joinPathFragments)('package', migrationsDir, promptRelPath);
        const promptDest = (0, path_1.join)(destDir, migrationsDir, promptRelPath);
        await (0, tar_1.extractFileFromTarball)(fullTarballPath, promptInTarball, promptDest);
        return (0, fs_1.readFileSync)(promptDest, 'utf-8');
    });
}
function readPromptFilesFromInstall(packageName, packageVersion, migrations, migrationsFilePath) {
    const migrationsDir = (0, path_1.dirname)(migrationsFilePath);
    return resolvePromptFiles(packageName, packageVersion, migrations, migrationsDir, (promptRelPath) => (0, fs_1.readFileSync)((0, path_1.join)(migrationsDir, promptRelPath), 'utf-8'));
}
function writePromptMigrationFiles(root, migrations, promptContents, targetVersion) {
    const sourceToChosen = new Map();
    const result = [];
    for (const migration of migrations) {
        if (!migration.prompt)
            continue;
        const sourceKey = promptContentKey(migration.package, migration.prompt);
        const content = promptContents[sourceKey];
        if (content === undefined)
            continue;
        const cached = sourceToChosen.get(sourceKey);
        if (cached !== undefined) {
            migration.prompt = cached;
            continue;
        }
        const baseName = path_1.posix.basename(migration.prompt);
        const ext = path_1.posix.extname(baseName);
        const stem = ext ? baseName.slice(0, -ext.length) : baseName;
        const destDir = (0, path_2.joinPathFragments)(exports.AI_MIGRATIONS_DIR, migration.package, targetVersion);
        let chosenPath;
        for (let n = 0;; n++) {
            const candidate = (0, path_2.joinPathFragments)(destDir, n === 0 ? baseName : `${stem}-${n}${ext}`);
            const absCandidate = (0, path_1.join)(root, candidate);
            if (!(0, fs_1.existsSync)(absCandidate)) {
                (0, fs_1.mkdirSync)((0, path_1.dirname)(absCandidate), { recursive: true });
                (0, fs_1.writeFileSync)(absCandidate, content);
                result.push(candidate);
                chosenPath = candidate;
                break;
            }
            if ((0, fs_1.readFileSync)(absCandidate, 'utf-8') === content) {
                chosenPath = candidate;
                break;
            }
        }
        sourceToChosen.set(sourceKey, chosenPath);
        migration.prompt = chosenPath;
    }
    return result;
}
