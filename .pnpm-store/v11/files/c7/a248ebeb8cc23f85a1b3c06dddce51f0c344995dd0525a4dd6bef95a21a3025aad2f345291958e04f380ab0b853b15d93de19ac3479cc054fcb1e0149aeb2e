"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHybridMigration = exports.isPromptOnlyMigration = void 0;
exports.recordInitialMigrationMetadata = recordInitialMigrationMetadata;
exports.finishMigrationProcess = finishMigrationProcess;
exports.runSingleMigration = runSingleMigration;
exports.getImplementationPath = getImplementationPath;
exports.modifyMigrationsJsonMetadata = modifyMigrationsJsonMetadata;
exports.addSuccessfulMigration = addSuccessfulMigration;
exports.updateRefForSuccessfulMigration = updateRefForSuccessfulMigration;
exports.addFailedMigration = addFailedMigration;
exports.addSkippedMigration = addSkippedMigration;
exports.addStoppedMigration = addStoppedMigration;
exports.readMigrationsJsonMetadata = readMigrationsJsonMetadata;
exports.undoMigration = undoMigration;
exports.acknowledgeMigrationPrompt = acknowledgeMigrationPrompt;
exports.killMigrationProcess = killMigrationProcess;
exports.stopMigration = stopMigration;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path_1 = require("path");
const git_revision_1 = require("../../utils/git-revision");
const migrate_1 = require("./migrate");
Object.defineProperty(exports, "isHybridMigration", { enumerable: true, get: function () { return migrate_1.isHybridMigration; } });
Object.defineProperty(exports, "isPromptOnlyMigration", { enumerable: true, get: function () { return migrate_1.isPromptOnlyMigration; } });
let currentMigrationProcess = null;
let currentMigrationId = null;
let migrationCancelled = false;
function recordInitialMigrationMetadata(workspacePath, versionToMigrateTo) {
    const migrationsJsonPath = (0, path_1.join)(workspacePath, 'migrations.json');
    const parsedMigrationsJson = JSON.parse((0, fs_1.readFileSync)(migrationsJsonPath, 'utf-8'));
    const gitRef = (0, child_process_1.execSync)('git rev-parse HEAD', {
        cwd: workspacePath,
        encoding: 'utf-8',
        windowsHide: true,
    }).trim();
    const gitSubject = (0, child_process_1.execSync)('git log -1 --pretty=%s', {
        cwd: workspacePath,
        encoding: 'utf-8',
        windowsHide: true,
    }).trim();
    parsedMigrationsJson['nx-console'] = {
        initialGitRef: {
            ref: gitRef,
            subject: gitSubject,
        },
        targetVersion: versionToMigrateTo,
    };
    (0, fs_1.writeFileSync)(migrationsJsonPath, JSON.stringify(parsedMigrationsJson, null, 2));
}
function finishMigrationProcess(workspacePath, squashCommits, commitMessage) {
    const migrationsJsonPath = (0, path_1.join)(workspacePath, 'migrations.json');
    const parsedMigrationsJson = JSON.parse((0, fs_1.readFileSync)(migrationsJsonPath, 'utf-8'));
    const initialGitRef = parsedMigrationsJson['nx-console'].initialGitRef;
    if (squashCommits && initialGitRef) {
        (0, git_revision_1.assertValidGitSha)(initialGitRef.ref);
    }
    if ((0, fs_1.existsSync)(migrationsJsonPath)) {
        (0, fs_1.rmSync)(migrationsJsonPath);
    }
    (0, child_process_1.execSync)('git add .', {
        cwd: workspacePath,
        encoding: 'utf-8',
        windowsHide: true,
    });
    commit(workspacePath, commitMessage);
    if (squashCommits && initialGitRef) {
        (0, child_process_1.execFileSync)('git', ['reset', '--soft', initialGitRef.ref], {
            cwd: workspacePath,
            encoding: 'utf-8',
            windowsHide: true,
        });
        commit(workspacePath, commitMessage);
    }
}
function commit(workspacePath, commitMessage) {
    (0, child_process_1.execSync)('git commit --no-verify -F -', {
        cwd: workspacePath,
        encoding: 'utf-8',
        windowsHide: true,
        input: commitMessage,
    });
}
async function runSingleMigration(workspacePath, migration, configuration) {
    try {
        // Set current migration tracking
        currentMigrationId = migration.id;
        migrationCancelled = false;
        modifyMigrationsJsonMetadata(workspacePath, addRunningMigration(migration.id));
        // Prompt-only migrations have no deterministic implementation to spawn.
        // The state-machine's auto-run hits this branch; the manual Mark-as-
        // Completed path calls `recordPromptOnlySuccess` directly so it stays out
        // of the process-tracking lifecycle.
        if ((0, migrate_1.isPromptOnlyMigration)(migration)) {
            recordPromptOnlySuccess(workspacePath, migration);
            return;
        }
        const gitRefBefore = (0, child_process_1.execSync)('git rev-parse HEAD', {
            cwd: workspacePath,
            encoding: 'utf-8',
            windowsHide: true,
        }).trim();
        // Run migration in a separate process so it can be cancelled
        const runMigrationProcessPath = require.resolve('./run-migration-process.js');
        const migrationProcess = (0, child_process_1.spawn)('node', [
            runMigrationProcessPath,
            workspacePath,
            migration.id,
            migration.package,
            migration.name,
            migration.version,
            configuration.createCommits.toString(),
            configuration.commitPrefix || 'chore: [nx migration] ',
        ], {
            cwd: workspacePath,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        // Track the process for cancellation
        currentMigrationProcess = migrationProcess;
        // Handle process output
        let output = '';
        migrationProcess.stdout.on('data', (data) => {
            output += data.toString();
        });
        migrationProcess.stderr.on('data', (data) => {
            console.error('Migration stderr:', data.toString());
        });
        // Wait for the process to complete
        const exitCode = await new Promise((resolve, reject) => {
            migrationProcess.on('close', (code) => {
                resolve(code);
            });
            migrationProcess.on('error', (error) => {
                reject(error);
            });
        });
        currentMigrationProcess = null;
        if (exitCode !== 0) {
            throw new Error(`Migration process exited with code ${exitCode}`);
        }
        // Parse the result from the migration process (extract the JSON output)
        const jsonStr = output
            .trim()
            .split('\n')
            .find((line) => line.startsWith('{'));
        const result = JSON.parse(jsonStr);
        if (result.type === 'error') {
            throw new Error(result.message);
        }
        const { fileChanges, gitRefAfter, nextSteps, skipAgentic } = result;
        modifyMigrationsJsonMetadata(workspacePath, addSuccessfulMigration(migration.id, fileChanges.map((change) => ({
            path: change.path,
            type: change.type,
        })), gitRefAfter, nextSteps, 
        // Only a hybrid has a prompt phase to waive. A generator-only
        // migration has no prompt affordance in the UI, so recording it there
        // would mark a state the UI never shows.
        skipAgentic === true && (0, migrate_1.isHybridMigration)(migration)));
        if (gitRefBefore !== gitRefAfter) {
            try {
                (0, child_process_1.execSync)('git add migrations.json', {
                    cwd: workspacePath,
                    encoding: 'utf-8',
                    windowsHide: true,
                });
            }
            catch (e) {
                // do nothing, this will fail if it's gitignored
            }
            (0, child_process_1.execSync)('git commit --amend --no-verify --no-edit', {
                cwd: workspacePath,
                encoding: 'utf-8',
                windowsHide: true,
            });
            // The revision changes after the amend, so we need to update it
            const amendedGitRef = (0, child_process_1.execSync)('git rev-parse HEAD', {
                cwd: workspacePath,
                encoding: 'utf-8',
                windowsHide: true,
            }).trim();
            modifyMigrationsJsonMetadata(workspacePath, updateRefForSuccessfulMigration(migration.id, amendedGitRef));
        }
    }
    catch (e) {
        // Check if migration was cancelled/stopped
        if (migrationCancelled && currentMigrationId === migration.id) {
            // Migration was stopped by user, don't add as failed since it's already marked as stopped
            console.log(`Migration ${migration.id} was stopped by user`);
        }
        else {
            // Migration failed normally
            modifyMigrationsJsonMetadata(workspacePath, addFailedMigration(migration.id, e.message));
        }
    }
    finally {
        // Clear the tracking variables
        currentMigrationProcess = null;
        currentMigrationId = null;
        migrationCancelled = false;
        modifyMigrationsJsonMetadata(workspacePath, removeRunningMigration(migration.id));
        try {
            (0, child_process_1.execSync)('git add migrations.json', {
                cwd: workspacePath,
                encoding: 'utf-8',
                windowsHide: true,
            });
        }
        catch (e) {
            // do nothing, this will fail if it's gitignored
        }
    }
}
async function getImplementationPath(workspacePath, migration) {
    // Prompt-only migrations have no implementation — the "source" the user
    // wants to see is the prompt file itself. Resolving via the regular
    // implementation lookup would throw because both `implementation` and
    // `factory` are unset.
    if ((0, migrate_1.isPromptOnlyMigration)(migration)) {
        return (0, path_1.join)(workspacePath, migration.prompt);
    }
    const { collection, collectionPath } = (0, migrate_1.readMigrationCollection)(migration.package, workspacePath);
    const { path } = (0, migrate_1.getImplementationPath)(collection, collectionPath, migration.name);
    return path;
}
function modifyMigrationsJsonMetadata(workspacePath, modify) {
    const migrationsJsonPath = (0, path_1.join)(workspacePath, 'migrations.json');
    const migrationsJson = JSON.parse((0, fs_1.readFileSync)(migrationsJsonPath, 'utf-8'));
    migrationsJson['nx-console'] = modify(migrationsJson['nx-console']);
    (0, fs_1.writeFileSync)(migrationsJsonPath, JSON.stringify(migrationsJson, null, 2));
}
function addSuccessfulMigration(id, fileChanges, ref, nextSteps, skipAgentic = false) {
    return (migrationsJsonMetadata) => {
        const copied = { ...migrationsJsonMetadata };
        if (!copied.completedMigrations) {
            copied.completedMigrations = {};
        }
        // A rerun re-records the same id. Carry an ack forward only off a record
        // that carries no waiver: once a waiving run writes one it is
        // byte-identical to a user's, so a rerun that owes the prompt again re-asks
        // rather than trust it. Waiving sets the ack because nothing is owed.
        const existing = copied.completedMigrations[id];
        const acknowledgedPrompt = skipAgentic ||
            (existing?.type === 'successful' &&
                existing.acknowledgedPrompt &&
                !existing.skipAgentic);
        copied.completedMigrations = {
            ...copied.completedMigrations,
            [id]: {
                type: 'successful',
                name: id,
                changedFiles: fileChanges,
                ref,
                nextSteps,
                ...(acknowledgedPrompt && { acknowledgedPrompt: true }),
                ...(skipAgentic && { skipAgentic: true }),
            },
        };
        return copied;
    };
}
function updateRefForSuccessfulMigration(id, ref) {
    return (migrationsJsonMetadata) => {
        const copied = { ...migrationsJsonMetadata };
        if (!copied.completedMigrations) {
            copied.completedMigrations = {};
        }
        const existing = copied.completedMigrations[id];
        if (existing && existing.type === 'successful') {
            existing.ref = ref;
        }
        else {
            throw new Error(`Attempted to update ref for unsuccessful migration`);
        }
        return copied;
    };
}
function addFailedMigration(id, error) {
    return (migrationsJsonMetadata) => {
        const copied = { ...migrationsJsonMetadata };
        if (!copied.completedMigrations) {
            copied.completedMigrations = {};
        }
        copied.completedMigrations = {
            ...copied.completedMigrations,
            [id]: {
                type: 'failed',
                name: id,
                error,
            },
        };
        return copied;
    };
}
function addSkippedMigration(id) {
    return (migrationsJsonMetadata) => {
        const copied = { ...migrationsJsonMetadata };
        if (!copied.completedMigrations) {
            copied.completedMigrations = {};
        }
        copied.completedMigrations = {
            ...copied.completedMigrations,
            [id]: {
                type: 'skipped',
            },
        };
        return copied;
    };
}
function addStoppedMigration(id, error) {
    return (migrationsJsonMetadata) => {
        const copied = { ...migrationsJsonMetadata };
        if (!copied.completedMigrations) {
            copied.completedMigrations = {};
        }
        copied.completedMigrations = {
            ...copied.completedMigrations,
            [id]: {
                type: 'stopped',
                name: id,
                error,
            },
        };
        return copied;
    };
}
function addRunningMigration(id) {
    return (migrationsJsonMetadata) => {
        migrationsJsonMetadata.runningMigrations = [
            ...(migrationsJsonMetadata.runningMigrations ?? []),
            id,
        ];
        return migrationsJsonMetadata;
    };
}
function removeRunningMigration(id) {
    return (migrationsJsonMetadata) => {
        migrationsJsonMetadata.runningMigrations =
            migrationsJsonMetadata.runningMigrations?.filter((n) => n !== id);
        return migrationsJsonMetadata;
    };
}
function readMigrationsJsonMetadata(workspacePath) {
    const migrationsJsonPath = (0, path_1.join)(workspacePath, 'migrations.json');
    const migrationsJson = JSON.parse((0, fs_1.readFileSync)(migrationsJsonPath, 'utf-8'));
    return migrationsJson['nx-console'];
}
function undoMigration(workspacePath, id) {
    return (migrationsJsonMetadata) => {
        const existing = migrationsJsonMetadata.completedMigrations[id];
        if (existing.type !== 'successful')
            throw new Error(`undoMigration called on unsuccessful migration: ${id}`);
        // No-changes successful entries (prompt-only short-circuit, generators
        // that ran but produced no diff) have no migration commit to roll back;
        // `existing.ref` is the unmodified HEAD at run time, so `ref^` would
        // reset past unrelated history. Only flip the metadata to skipped.
        if (existing.changedFiles.length > 0) {
            (0, git_revision_1.assertValidGitSha)(existing.ref);
            (0, child_process_1.execFileSync)('git', ['reset', '--hard', `${existing.ref}^`], {
                cwd: workspacePath,
                encoding: 'utf-8',
                windowsHide: true,
            });
        }
        migrationsJsonMetadata.completedMigrations[id] = {
            type: 'skipped',
        };
        return migrationsJsonMetadata;
    };
}
/**
 * Records that the user has confirmed completion of a prompt-bearing
 * migration's AI prompt phase. Dispatches by shape so callers (the webview
 * event handler in Nx Console) don't need to know which is which:
 *  - prompt-only: records success directly (no spawn, no process lifecycle).
 *  - hybrid: persists the `acknowledgedPrompt` flag on the existing
 *    successful record from the generator phase.
 */
function acknowledgeMigrationPrompt(workspacePath, migration) {
    if ((0, migrate_1.isPromptOnlyMigration)(migration)) {
        recordPromptOnlySuccess(workspacePath, migration);
        return;
    }
    modifyMigrationsJsonMetadata(workspacePath, (metadata) => {
        const existing = metadata.completedMigrations?.[migration.id];
        if (!existing || existing.type !== 'successful') {
            return metadata;
        }
        metadata.completedMigrations = {
            ...metadata.completedMigrations,
            [migration.id]: { ...existing, acknowledgedPrompt: true },
        };
        return metadata;
    });
}
// Writes a successful record for a prompt-only migration without touching the
// process-lifecycle tracking that `runSingleMigration` manages — safe to call
// from `acknowledgeMigrationPrompt` while another migration may be running.
// The prompt-path reminder is rendered by the UI from `migration.prompt`, so
// no next step is recorded here.
function recordPromptOnlySuccess(workspacePath, migration) {
    const ref = (0, child_process_1.execSync)('git rev-parse HEAD', {
        cwd: workspacePath,
        encoding: 'utf-8',
        windowsHide: true,
    }).trim();
    modifyMigrationsJsonMetadata(workspacePath, addSuccessfulMigration(migration.id, [], ref, []));
}
function killMigrationProcess(migrationId, workspacePath) {
    try {
        if (workspacePath) {
            modifyMigrationsJsonMetadata(workspacePath, stopMigration(migrationId));
        }
        // Check if this is the currently running migration and kill the process
        if (currentMigrationId === migrationId && currentMigrationProcess) {
            currentMigrationProcess.kill('SIGTERM');
            // Some processes may not respond to SIGTERM immediately,
            // so we give it a short timeout before forcefully killing it
            setTimeout(() => {
                if (currentMigrationProcess && !currentMigrationProcess.killed) {
                    currentMigrationProcess.kill('SIGKILL');
                }
            }, 2000);
        }
        return true;
    }
    catch (error) {
        console.error(`Failed to stop migration ${migrationId}:`, error);
        return false;
    }
}
function stopMigration(migrationId) {
    return (migrationsJsonMetadata) => {
        const updated = addStoppedMigration(migrationId, 'Migration was stopped by user')(migrationsJsonMetadata);
        return removeRunningMigration(migrationId)(updated);
    };
}
