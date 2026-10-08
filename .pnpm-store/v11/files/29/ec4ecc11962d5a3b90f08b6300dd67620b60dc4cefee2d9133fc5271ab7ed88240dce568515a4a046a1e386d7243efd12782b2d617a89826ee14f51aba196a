"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.visitNotIgnoredFiles = visitNotIgnoredFiles;
const devkit_internals_1 = require("nx/src/devkit-internals");
const path_1 = require("path");
const nx_ignore_internals_1 = require("../utils/nx-ignore-internals");
/**
 * Utility to act on all files in a tree that are not ignored by git.
 *
 * Ignore files cascade, so a nested `.gitignore` covers the files under it and a
 * nested negation overrides the root. They are read from the tree, not disk, so
 * one a generator wrote in the same run counts.
 *
 * `node_modules`, `.git` and the nx and yarn caches are never visited, whatever
 * the workspace's ignore files say.
 */
function visitNotIgnoredFiles(tree, dirPath = tree.root, visitor) {
    (0, nx_ignore_internals_1.assertNxSupportsIgnoreCheckers)();
    // Built once for the whole traversal.
    const isIgnored = (0, devkit_internals_1.createGitIgnoreChecker)(tree);
    const start = normalizePathRelativeToRoot(dirPath, tree.root);
    // The caller's own directory is the only one nothing has checked - every
    // deeper one is checked before it is descended into.
    if (start !== '' && isIgnored.isIgnoredDirectory(start)) {
        return;
    }
    visitDirectory(tree, start, visitor, isIgnored);
}
/**
 * Callers must have cleared `dirPath` already - both call sites do.
 *
 * Not descending into an ignored directory keeps the walk from checking every
 * file under one just to drop them all. It also keeps the answers matching git
 * under devkit's nx skew: git refuses to re-include a file inside an excluded
 * directory, and only nx versions from `createAncestorAwareIgnoreChecker`
 * onward enforce that in `isIgnoredFile` itself.
 */
function visitDirectory(tree, dirPath, visitor, isIgnored) {
    for (const child of tree.children(dirPath)) {
        // Joined as POSIX rather than with `path.join`: tree paths are POSIX, and
        // on Windows a backslash-separated path silently matches nothing.
        const fullPath = dirPath ? `${dirPath}/${child}` : child;
        if (tree.isFile(fullPath)) {
            if (!isIgnored.isIgnoredFile(fullPath)) {
                visitor(fullPath);
            }
        }
        else if (!isIgnored.isIgnoredDirectory(fullPath)) {
            visitDirectory(tree, fullPath, visitor, isIgnored);
        }
    }
}
function normalizePathRelativeToRoot(path, root) {
    return (0, path_1.relative)(root, (0, path_1.join)(root, path)).split(path_1.sep).join('/');
}
