"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nestedWorktreeRoots = nestedWorktreeRoots;
exports.isInside = isInside;
exports.analyzeWorktreeConflicts = analyzeWorktreeConflicts;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const GITDIR_PREFIX = 'gitdir:';
function readRecordedPath(file, base) {
    let contents;
    try {
        contents = (0, node_fs_1.readFileSync)(file, 'utf-8').trim();
    }
    catch {
        return null;
    }
    const raw = contents.startsWith(GITDIR_PREFIX)
        ? contents.slice(GITDIR_PREFIX.length).trim()
        : contents;
    return raw ? (0, node_path_1.resolve)(base, raw) : null;
}
function isDirectory(path) {
    try {
        return (0, node_fs_1.statSync)(path).isDirectory();
    }
    catch {
        return false;
    }
}
/**
 * The nearest directory at or above `from` holding a `.git`, or null when
 * there is no repository above it.
 *
 * The workspace root and the repository root are often the same directory, but
 * a workspace nested in a larger repo is ordinary - and its worktrees are
 * registered against the repository, not against the workspace.
 */
function findGitRoot(from) {
    let current = (0, node_path_1.resolve)(from);
    while (!(0, node_fs_1.existsSync)((0, node_path_1.join)(current, '.git'))) {
        const parent = (0, node_path_1.dirname)(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
    return current;
}
/**
 * `<git-dir>/worktrees`, where git registers every linked worktree of the
 * repository `workspaceRoot` belongs to - found by walking up, since the
 * workspace need not be the repository root. Null when there is no `.git`, or
 * when it is a gitfile that names nothing. The registry itself is not checked -
 * reading it is what tells us whether anything is registered.
 */
function worktreeRegistry(workspaceRoot) {
    const gitRoot = findGitRoot(workspaceRoot);
    if (!gitRoot) {
        return null;
    }
    const dotGit = (0, node_path_1.join)(gitRoot, '.git');
    let gitDir;
    try {
        gitDir = (0, node_fs_1.statSync)(dotGit).isDirectory()
            ? dotGit
            : readRecordedPath(dotGit, gitRoot);
    }
    catch {
        return null;
    }
    if (!gitDir) {
        return null;
    }
    // Running from inside a linked worktree lands on
    // `<main>/.git/worktrees/<name>`, whose `commondir` names the real git dir.
    // Ignored unless it names a directory that exists. That is a sanity check
    // on a path out of a file we did not write, not a bound on where it may
    // point - it can still name any directory on the machine.
    const commonDir = readRecordedPath((0, node_path_1.join)(gitDir, 'commondir'), gitDir);
    return (0, node_path_1.join)(commonDir && isDirectory(commonDir) ? commonDir : gitDir, 'worktrees');
}
/**
 * Roots of the git linked worktrees that live inside `workspaceRoot`,
 * relative to it and separator-normalized.
 *
 * Reads git's own registry rather than probing the workspace, so it costs one
 * `readdir` plus a small file per worktree. Worktrees outside the workspace
 * are dropped - nothing walks them. Submodules use the same gitfile mechanism
 * but register under `<git-dir>/modules`, so they never appear here.
 */
function nestedWorktreeRoots(workspaceRoot) {
    const registry = worktreeRegistry(workspaceRoot);
    if (!registry) {
        return [];
    }
    let entries;
    try {
        entries = (0, node_fs_1.readdirSync)(registry);
    }
    catch {
        return [];
    }
    const roots = [];
    for (const entry of entries) {
        // Points at the worktree's own `.git` gitfile, so its parent is the root.
        const gitfile = readRecordedPath((0, node_path_1.join)(registry, entry, 'gitdir'), (0, node_path_1.join)(registry, entry));
        if (!gitfile || !(0, node_fs_1.existsSync)(gitfile)) {
            continue;
        }
        const root = (0, node_path_1.relative)(workspaceRoot, (0, node_path_1.dirname)(gitfile));
        // Neither the workspace itself nor anything outside it is a nested
        // worktree Nx would walk into. Compared by whole segments, because `..` is
        // a traversal and `..hidden` is an ordinary directory name; and by
        // absoluteness, because `relative` across Windows drives returns its
        // second argument, which is outside by definition and carries no `..`.
        if (!root || (0, node_path_1.isAbsolute)(root) || root.split(node_path_1.sep)[0] === '..') {
            continue;
        }
        roots.push(root.split(node_path_1.sep).join('/'));
    }
    return roots;
}
/**
 * Whether `path` sits inside `root`, comparing whole path segments so that
 * `wt-other` is not read as living inside `wt`.
 */
function isInside(path, root) {
    return path === root || path.startsWith(`${root}/`);
}
/**
 * What to tell someone whose duplicate project names come from git worktrees
 * nested in the workspace, or null when none of them do.
 */
function analyzeWorktreeConflicts(workspaceRoot, conflicts) {
    const worktrees = nestedWorktreeRoots(workspaceRoot);
    if (!worktrees.length) {
        return null;
    }
    const offending = [];
    let explainsAllConflicts = true;
    for (const roots of conflicts.values()) {
        const fromWorktrees = worktrees.filter((worktree) => roots.some((root) => isInside(root, worktree)));
        // What would still be defined twice once the worktrees are out of the way.
        const remaining = roots.filter((root) => !worktrees.some((worktree) => isInside(root, worktree)));
        // Worth naming whenever a worktree is involved, even if ignoring it
        // doesn't settle the whole conflict.
        for (const worktree of fromWorktrees) {
            if (!offending.includes(worktree)) {
                offending.push(worktree);
            }
        }
        if (!fromWorktrees.length || remaining.length > 1) {
            explainsAllConflicts = false;
        }
    }
    if (!offending.length) {
        return null;
    }
    return {
        ignoreTargets: ignoreTargetsFor(workspaceRoot, offending, worktrees),
        explainsAllConflicts,
    };
}
/**
 * The worktree roots themselves, or the one directory holding them.
 *
 * Collapsing to the directory is only worth anything when it saves lines, and
 * only safe when it holds nothing else. With a single worktree it saves
 * nothing and risks everything: a lone worktree in `apps/` would have us name
 * `apps/`, which holds only that worktree today and is where the reader will
 * put projects tomorrow.
 */
function ignoreTargetsFor(workspaceRoot, offending, worktrees) {
    if (offending.length < 2) {
        return offending.map(anchored);
    }
    const parent = commonParent(offending);
    return (parent && holdsOnlyWorktrees(workspaceRoot, parent, worktrees)
        ? [parent]
        : offending).map(anchored);
}
/**
 * A gitignore pattern rooted at the workspace rather than matched anywhere.
 *
 * Without the leading slash a single-segment path like `wt1` is a name, not a
 * location - it would ignore every `wt1` at any depth. Applied to all of them
 * so the emitted line reads the same way wherever it came from.
 */
function anchored(root) {
    return `/${root}`;
}
/**
 * The directory every one of `roots` sits directly inside, or null when they
 * don't share one - including when it would be the workspace root, which is
 * never something to ignore.
 */
function commonParent(roots) {
    const parents = new Set(roots.map((root) => root.split('/').slice(0, -1).join('/')));
    const [parent] = parents;
    return parents.size === 1 && parent ? parent : null;
}
function holdsOnlyWorktrees(workspaceRoot, directory, worktrees) {
    let entries;
    try {
        entries = (0, node_fs_1.readdirSync)((0, node_path_1.join)(workspaceRoot, directory));
    }
    catch {
        return false;
    }
    return (entries.length > 0 &&
        entries.every((entry) => worktrees.includes(`${directory}/${entry}`)));
}
