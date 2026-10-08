"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OXFMT_IGNORE_OPTIONS = void 0;
exports.getIgnoreObject = getIgnoreObject;
exports.createIgnoreChainResolver = createIgnoreChainResolver;
exports.isIgnoredByChain = isIgnoredByChain;
exports.createAncestorAwareIgnoreChecker = createAncestorAwareIgnoreChecker;
exports.isAlwaysIgnored = isAlwaysIgnored;
exports.createGitIgnoreChecker = createGitIgnoreChecker;
exports.createPrettierIgnoreChecker = createPrettierIgnoreChecker;
exports.createOxfmtIgnoreChecker = createOxfmtIgnoreChecker;
exports.posixDirname = posixDirname;
exports.addEntryToGitIgnore = addEntryToGitIgnore;
const ignore = require("ignore");
const index_1 = require("../native/index");
const fileutils_1 = require("./fileutils");
const workspace_root_1 = require("./workspace-root");
function getIgnoreObject(root = workspace_root_1.workspaceRoot) {
    const ig = ignore();
    ig.add((0, fileutils_1.readFileIfExisting)(`${root}/.gitignore`));
    ig.add((0, fileutils_1.readFileIfExisting)(`${root}/.nxignore`));
    return ig;
}
/**
 * Resolves the ignore files that apply to a directory: its own and every one
 * above it, up to the workspace root.
 *
 * Ignore files cascade - a `.gitignore` covers its own directory and below, and
 * its patterns are relative to *itself*, not to the workspace root. Reading only
 * the root file, which is what `getIgnoreObject` does, silently misses every
 * nested one.
 *
 * A directory's answer is its own files plus its parent's, so every directory on
 * the way up is memoized rather than only the one asked for: sibling leaves
 * share the whole trunk, and a later walk stops at the first directory already
 * known.
 *
 * `read` decides where the files come from - `tree.read` for a generator, disk
 * for a caller with no tree - and returns an empty string or null when there is
 * no such file. Paths handed to it are workspace-relative POSIX.
 *
 * `merge` decides how the files *within one directory* relate, and the two
 * consumers genuinely need different rules:
 *
 * - `false` is prettier's: one matcher per file, any of them excluding wins, and
 *   a negation counts only if none excluded. `createIsIgnoredFunction` builds an
 *   ignorer per `--ignore-path` and ORs them, so a `!x` in `.prettierignore`
 *   cannot re-include an `x` that `.gitignore` excluded.
 * - `true` is git's and the native walker's: all files in one matcher, so
 *   `.nxignore`'s `!x` removes `.gitignore`'s exclusion of `x` outright. It has
 *   to be a merge rather than a precedence check between separate matchers,
 *   because a lone `!x` in its own matcher reports an opinion on `x/` but *none*
 *   on `x/a.ts` (measured), so the exclusion would still reach the children.
 *   The merge only removes the exclusion within that one directory - a negation
 *   in a nested file still loses to an ancestor's exclusion.
 *
 * When `merge` is true, `filenames` order matters: they go into one matcher in
 * order and the last matching pattern decides, so list them lowest-authority
 * first.
 */
function createIgnoreChainResolver(read, filenames, merge) {
    const cache = new Map();
    const resolve = (dir) => {
        const cached = cache.get(dir);
        if (cached) {
            return cached;
        }
        const contents = filenames
            .map((name) => read(dir ? `${dir}/${name}` : name))
            .filter((c) => !!c);
        const matchers = merge
            ? contents.length > 0
                ? [contents.reduce((m, c) => m.add(c), ignore())]
                : []
            : contents.map((c) => ignore().add(c));
        const inherited = dir === '' ? [] : resolve(posixDirname(dir));
        const chain = matchers.length > 0 ? [{ dir, matchers }, ...inherited] : inherited;
        cache.set(dir, chain);
        return chain;
    };
    return resolve;
}
/**
 * True when the file is ignored, resolving the chain nearest file first.
 *
 * Each matcher is tested against the path relative to its own directory, which
 * is what makes a nested pattern like `/build` mean that directory's `build`
 * rather than the workspace's.
 *
 * Nearest directory with an *opinion* wins, not the first match: a nested
 * `!keep.log` must override the root's `*.log`, which is git's rule for files.
 * A nested negation of a *directory* does not reach its children - see the
 * `merge` note on `createIgnoreChainResolver`.
 *
 * How the files of one directory relate is decided when the chain is built - see
 * that same note. Here they are simply the entry's matchers: any one excluding
 * wins, and a negation counts only if none excluded.
 *
 * Two preconditions, neither enforced here:
 *
 * - `filePath` is workspace-relative POSIX and must sit under every `dir` in the
 *   chain, which holds when the chain came from that file's own directory.
 * - No ancestor directory of `filePath` may itself be ignored. git refuses to
 *   re-include a file inside an excluded directory, and this does not implement
 *   that rule: asked directly about `dist/keep.ts` with a root `dist/` and a
 *   nested `dist/.gitignore` holding `!keep.ts`, it answers "not ignored" where
 *   git says ignored (measured). A pruning walk like `visitNotIgnoredFiles`
 *   satisfies it by never asking about anything under `dist/`; a per-file
 *   caller cannot, so it goes through `createAncestorAwareIgnoreChecker`,
 *   which checks the ancestors before asking the chain.
 */
function isIgnoredByChain(chain, filePath) {
    for (const { dir, matchers } of chain) {
        const relative = dir === '' ? filePath : filePath.slice(dir.length + 1);
        let unignored = false;
        for (const matcher of matchers) {
            const result = matcher.test(relative);
            if (result.ignored) {
                return true;
            }
            unignored ||= result.unignored;
        }
        if (unignored) {
            return false;
        }
    }
    return false;
}
/**
 * The chain's answers plus git's excluded-ancestor rule: nothing inside an
 * ignored directory can be re-included, so a nested negation must not
 * resurrect a file whose ancestor an outer file excluded - the case
 * `isIgnoredByChain` alone gets wrong (see its second precondition). The
 * oxfmt CLI follows the same rule (measured against 0.60.0: a scan skips a
 * nested `!keep.ts` under a root-ignored `dist/`), so every per-file caller -
 * the cascading tree checkers and the disk-backed resolver in
 * `formatters/oxfmt.ts` - goes through here.
 *
 * A directory's own ignore files cannot un-ignore the directory itself, so
 * its verdict comes from its parent's chain - probed with a trailing slash,
 * which is what makes a directory-only pattern like `dist/` match. Verdicts
 * are memoized per directory, so a batch of files shares its ancestor walks.
 */
function createAncestorAwareIgnoreChecker(resolve) {
    const ignoredDirs = new Map();
    const isIgnoredDirectory = (dir) => {
        if (dir === '') {
            return false;
        }
        const cached = ignoredDirs.get(dir);
        if (cached !== undefined) {
            return cached;
        }
        const parent = posixDirname(dir);
        const ignored = isIgnoredDirectory(parent) ||
            isIgnoredByChain(resolve(parent), `${dir}/`);
        ignoredDirs.set(dir, ignored);
        return ignored;
    };
    return {
        isIgnoredFile: (filePath) => {
            const dir = posixDirname(filePath);
            return (isIgnoredDirectory(dir) || isIgnoredByChain(resolve(dir), filePath));
        },
        isIgnoredDirectory,
    };
}
let alwaysIgnored;
/**
 * Directories that should never be walked, whatever the workspace's own ignore
 * files say - `node_modules`, `.git`, the nx caches.
 *
 * The list comes from the native walker rather than a second copy here, so a
 * filesystem walk and a tree walk cannot drift apart.
 *
 * Checked ahead of the cascading chain rather than folded into it: these are not
 * re-includable, and as ordinary patterns a nested negation could resurrect
 * `node_modules`.
 */
function isAlwaysIgnored(path) {
    alwaysIgnored ??= ignore().add((0, index_1.getHardcodedIgnorePatterns)());
    return alwaysIgnored.ignores(path);
}
/**
 * What git ignores, which is also what the native walker ignores.
 *
 * `.nxignore` outranks `.gitignore` - `walker.rs` registers it with
 * `add_custom_ignore_filename` - which a merge with `.nxignore` last reproduces.
 * git itself does not read it.
 *
 * Reads from the tree rather than disk because a generator can create or amend
 * an ignore file in the same run, which would leave the on-disk copy stale.
 */
function createGitIgnoreChecker(tree) {
    return createTreeIgnoreChecker(tree, {
        filenames: ['.gitignore', '.nxignore'],
        cascade: true,
        merge: true,
    });
}
/**
 * What prettier ignores: the workspace root only, and one ignorer per
 * `--ignore-path` ORed rather than merged (both measured), so a `!` in
 * `.prettierignore` cannot re-include what `.gitignore` excluded. That is the
 * CLI `nx format:check` shells out to.
 *
 * Not an exact match for that command: `isAlwaysIgnored` is wider than
 * prettier's built-ins, and `format.ts` filters its own patterns through
 * `.nxignore`, which this does not read.
 *
 * Reads from the tree rather than disk, as above.
 */
function createPrettierIgnoreChecker(tree) {
    return createTreeIgnoreChecker(tree, {
        filenames: ['.gitignore', '.prettierignore'],
        cascade: false,
        merge: false,
    });
}
/**
 * What oxfmt ignores: prettier's two files, but resolved from each file's own
 * directory upwards rather than the workspace root - measured against the
 * oxfmt 0.60.0 CLI, which differs from prettier on exactly that axis. Still
 * one matcher per file rather than merged.
 *
 * A config's `ignorePatterns` is not an ignore file and is not read here;
 * `formatFilesWithOxfmt` applies it rooted at that config's directory.
 */
function createOxfmtIgnoreChecker(tree) {
    return createTreeIgnoreChecker(tree, exports.OXFMT_IGNORE_OPTIONS);
}
/**
 * Exported, unlike git's and prettier's, because oxfmt has two consumers:
 * this tree-backed checker and the disk-backed resolver in
 * `formatters/oxfmt.ts`. A shared value is the only thing that keeps them
 * agreeing, so do not restate these three anywhere.
 *
 * `satisfies` rather than an annotation keeps the values literal - an
 * annotation widens `cascade` and `merge` to `boolean` (measured in the
 * declaration emit).
 */
exports.OXFMT_IGNORE_OPTIONS = {
    filenames: ['.gitignore', '.prettierignore'],
    cascade: true,
    merge: false,
};
function createTreeIgnoreChecker(tree, { filenames, cascade, merge }) {
    const resolve = createIgnoreChainResolver((path) => tree.read(path, 'utf-8'), filenames, merge);
    if (cascade) {
        // Cascading resolution and the excluded-ancestor rule travel together:
        // both come from git, and the one cascading tool that is not git - oxfmt -
        // applies both (measured, see `createAncestorAwareIgnoreChecker`).
        const checker = createAncestorAwareIgnoreChecker(resolve);
        return {
            isIgnoredFile: (path) => isAlwaysIgnored(path) || checker.isIgnoredFile(path),
            // The trailing slash is what makes a directory-only pattern like `dist/`
            // match - `ignore` will not match it against the bare `dist`.
            isIgnoredDirectory: (path) => isAlwaysIgnored(`${path}/`) || checker.isIgnoredDirectory(path),
        };
    }
    // Root-only: the whole chain is the root's, so no ancestor holds ignore
    // files of its own, and within one matcher `ignore` itself refuses to
    // re-include under an excluded directory (measured). Nothing is left for an
    // ancestor walk to add.
    const check = (probe) => isAlwaysIgnored(probe) || isIgnoredByChain(resolve(''), probe);
    return {
        isIgnoredFile: (path) => check(path),
        isIgnoredDirectory: (path) => check(`${path}/`),
    };
}
/**
 * `path.dirname` for the workspace-relative POSIX paths the chain is keyed by,
 * except that the workspace root is `''` rather than `.` - that is the key
 * `createIgnoreChainResolver` terminates on.
 */
function posixDirname(relativePath) {
    const separator = relativePath.lastIndexOf('/');
    return separator === -1 ? '' : relativePath.slice(0, separator);
}
/**
 * Adds an entry to a .gitignore file if it's not already covered by existing patterns.
 * Creates the file if it doesn't exist.
 */
function addEntryToGitIgnore(tree, gitignorePath, entry) {
    const gitignore = tree.exists(gitignorePath)
        ? tree.read(gitignorePath, 'utf-8')
        : '';
    const ig = ignore();
    ig.add(gitignore);
    if (!ig.ignores(entry)) {
        const updatedLines = gitignore.length ? [gitignore, entry] : [entry];
        tree.write(gitignorePath, updatedLines.join('\n'));
    }
}
