"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEN_MEGABYTES = exports.LockFileChange = exports.DeletedFileChange = exports.WholeFileChange = void 0;
exports.isWholeFileChange = isWholeFileChange;
exports.isDeletedFileChange = isDeletedFileChange;
exports.isLockFileChange = isLockFileChange;
exports.calculateFileChanges = calculateFileChanges;
exports.defaultFileRead = defaultFileRead;
exports.readPackageJson = readPackageJson;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const fileutils_1 = require("../utils/fileutils");
const git_revision_1 = require("../utils/git-revision");
const ignore_1 = require("../utils/ignore");
const json_diff_1 = require("../utils/json-diff");
const workspace_root_1 = require("../utils/workspace-root");
class WholeFileChange {
    constructor() {
        this.type = 'WholeFileChange';
    }
}
exports.WholeFileChange = WholeFileChange;
class DeletedFileChange {
    constructor() {
        this.type = 'WholeFileDeleted';
    }
}
exports.DeletedFileChange = DeletedFileChange;
class LockFileChange {
    constructor(baseContent, headContent) {
        this.baseContent = baseContent;
        this.headContent = headContent;
        this.type = 'LockFileChange';
    }
}
exports.LockFileChange = LockFileChange;
function isWholeFileChange(change) {
    return change.type === 'WholeFileChange';
}
function isDeletedFileChange(change) {
    return change.type === 'WholeFileDeleted';
}
function isLockFileChange(change) {
    return change.type === 'LockFileChange';
}
const TEXT_LOCK_FILES = new Set([
    'yarn.lock',
    'package-lock.json',
    'pnpm-lock.yaml',
    'pnpm-lock.yml',
    'bun.lock',
]);
const BINARY_LOCK_FILES = new Set(['bun.lockb']);
function calculateFileChanges(files, nxArgs, readFileAtRevision = defaultReadFileAtRevision, ignore = (0, ignore_1.getIgnoreObject)()) {
    files = files.filter((f) => !ignore.ignores(f));
    return files.map((f) => {
        const ext = (0, path_1.extname)(f);
        const basename = f.split('/').pop() ?? f;
        return {
            file: f,
            getChanges: () => {
                if (!(0, fs_1.existsSync)((0, path_1.join)(workspace_root_1.workspaceRoot, f))) {
                    return [new DeletedFileChange()];
                }
                if (!nxArgs) {
                    return [new WholeFileChange()];
                }
                if (nxArgs.files && nxArgs.files.includes(f)) {
                    return [new WholeFileChange()];
                }
                if (TEXT_LOCK_FILES.has(basename) || BINARY_LOCK_FILES.has(basename)) {
                    try {
                        const atBase = readLockFileAtRevision(f, basename, nxArgs.base, readFileAtRevision);
                        const atHead = readLockFileAtRevision(f, basename, nxArgs.head, readFileAtRevision);
                        return [new LockFileChange(atBase, atHead)];
                    }
                    catch {
                        return [new WholeFileChange()];
                    }
                }
                switch (ext) {
                    case '.json':
                        try {
                            const atBase = readFileAtRevision(f, nxArgs.base);
                            const atHead = readFileAtRevision(f, nxArgs.head);
                            return (0, json_diff_1.jsonDiff)(JSON.parse(atBase), JSON.parse(atHead));
                        }
                        catch (e) {
                            return [new WholeFileChange()];
                        }
                    case '.yml':
                    case '.yaml':
                        const { load } = require('@zkochan/js-yaml');
                        try {
                            const atBase = readFileAtRevision(f, nxArgs.base);
                            const atHead = readFileAtRevision(f, nxArgs.head);
                            return (0, json_diff_1.jsonDiff)(load(atBase), load(atHead));
                        }
                        catch (e) {
                            return [new WholeFileChange()];
                        }
                    default:
                        return [new WholeFileChange()];
                }
            },
        };
    });
}
function readLockFileAtRevision(file, lockFileName, revision, readFileAtRevision) {
    if (lockFileName === 'bun.lockb' &&
        readFileAtRevision === defaultReadFileAtRevision) {
        return defaultReadBunLockFileAtRevision(file, revision);
    }
    return readFileAtRevision(file, revision);
}
exports.TEN_MEGABYTES = 1024 * 10000;
function defaultReadFileAtRevision(file, revision) {
    if (revision) {
        (0, git_revision_1.assertValidGitRevision)(revision);
    }
    try {
        const filePathInGitRepository = getFilePathInGitRepository(file);
        return !revision
            ? (0, fs_1.readFileSync)(file, 'utf-8')
            : (0, child_process_1.execFileSync)('git', ['show', `${revision}:${filePathInGitRepository}`], {
                maxBuffer: exports.TEN_MEGABYTES,
                stdio: ['pipe', 'pipe', 'ignore'],
                windowsHide: true,
            })
                .toString()
                .trim();
    }
    catch {
        return '';
    }
}
function defaultReadBunLockFileAtRevision(file, revision) {
    if (!revision) {
        return (0, child_process_1.execFileSync)('bun', [(0, path_1.join)(workspace_root_1.workspaceRoot, file)], {
            encoding: 'utf-8',
            maxBuffer: exports.TEN_MEGABYTES,
            windowsHide: true,
        }).trim();
    }
    (0, git_revision_1.assertValidGitRevision)(revision);
    const filePathInGitRepository = getFilePathInGitRepository(file);
    const tempDirectory = (0, fs_1.mkdtempSync)((0, path_1.join)((0, os_1.tmpdir)(), 'nx-bun-lock-'));
    const tempLockfilePath = (0, path_1.join)(tempDirectory, 'bun.lockb');
    try {
        const lockFileContents = (0, child_process_1.execFileSync)('git', ['show', `${revision}:${filePathInGitRepository}`], {
            maxBuffer: exports.TEN_MEGABYTES,
            stdio: ['pipe', 'pipe', 'ignore'],
            windowsHide: true,
        });
        (0, fs_1.writeFileSync)(tempLockfilePath, lockFileContents);
        return (0, child_process_1.execFileSync)('bun', [tempLockfilePath], {
            encoding: 'utf-8',
            maxBuffer: exports.TEN_MEGABYTES,
            windowsHide: true,
        }).trim();
    }
    finally {
        (0, fs_1.rmSync)(tempDirectory, { force: true, recursive: true });
    }
}
function getFilePathInGitRepository(file) {
    const fileFullPath = `${workspace_root_1.workspaceRoot}${path_1.sep}${file}`;
    const gitRepositoryPath = (0, child_process_1.execSync)('git rev-parse --show-toplevel', {
        windowsHide: true,
    })
        .toString()
        .trim();
    return (0, path_1.relative)(gitRepositoryPath, fileFullPath).split(path_1.sep).join('/');
}
function defaultFileRead(filePath) {
    return (0, fs_1.readFileSync)((0, path_1.join)(workspace_root_1.workspaceRoot, filePath), 'utf-8');
}
function readPackageJson(root = workspace_root_1.workspaceRoot) {
    try {
        return (0, fileutils_1.readJsonFile)(`${root}/package.json`);
    }
    catch {
        return {}; // if package.json doesn't exist
    }
}
