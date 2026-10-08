"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatChangedFiles = formatChangedFiles;
exports.formatFileContents = formatFileContents;
const tslib_1 = require("tslib");
const path = tslib_1.__importStar(require("path"));
const path_1 = require("../../utils/path");
const formatters_1 = require("../../utils/formatters");
const oxfmt_1 = require("../../utils/formatters/oxfmt");
const installation_directory_1 = require("../../utils/installation-directory");
const output_1 = require("../../utils/output");
/**
 * Formats all the created or updated files using the configured formatter
 * @param tree - the file system tree
 *
 * @remarks
 * Set the environment variable `NX_SKIP_FORMAT` to `true` to skip
 * formatting. This is useful for repositories that format with a tool Nx does
 * not drive (Biome, dprint) or that have custom formatting requirements.
 */
async function formatChangedFiles(tree, options) {
    if (process.env.NX_SKIP_FORMAT === 'true') {
        return;
    }
    const excludedPaths = options?.excludePaths
        ? new Set(Array.from(options.excludePaths, path_1.normalizePath))
        : undefined;
    const files = new Set(tree
        .listChanges()
        .filter((file) => file.type !== 'DELETE' &&
        !excludedPaths?.has((0, path_1.normalizePath)(file.path))));
    // Detect from the tree, not disk: the tree is the source of truth and may
    // hold a config the generator just created but hasn't flushed. Probing disk
    // would also read the real workspace config in tests.
    //
    // No `seedConfig` is threaded through, unlike devkit's `formatFiles`:
    // `formatFilesWithOxfmt` falls back to a JSON config carried in the batch.
    const formatterType = (0, formatters_1.detectFormatterInTree)(tree);
    if (!formatterType) {
        return;
    }
    const results = await formatDetectedFiles(formatterType, Array.from(files), tree.root, options, 
    // The post-flush root, which disk cannot see: a config staged here is not
    // written yet, and one the tree deletes still is.
    oxfmt_1.oxfmtConfigFiles.filter((name) => tree.exists(name)), 
    // Same reason, for the ignore files and the root .editorconfig: the batch
    // is selected against the tree, so the backend has to re-check against the
    // tree and not against disk.
    (relativePath) => tree.read(relativePath, 'utf-8'));
    for (const [path, content] of results) {
        tree.write(path, content);
    }
}
async function formatFileContents(files, root, options) {
    // Check here as well for direct callers of this function
    if (process.env.NX_SKIP_FORMAT === 'true' || files.length === 0) {
        return new Map();
    }
    // Direct callers have no tree, so detection falls back to disk.
    const formatterType = (0, formatters_1.detectFormatter)(root);
    if (!formatterType) {
        return new Map();
    }
    return formatDetectedFiles(formatterType, files, root, options);
}
function formatDetectedFiles(formatterType, files, root, options, rootConfigNames, read) {
    switch (formatterType) {
        case 'prettier':
            return formatFilesWithPrettier(files, root, options);
        case 'oxfmt':
            return runOxfmtBatch(files, root, options, rootConfigNames, read);
        default: {
            // Without this arm an unhandled formatter returns undefined into
            // callers that iterate it.
            const unhandled = formatterType;
            throw new Error(`Unhandled formatter: ${unhandled}`);
        }
    }
}
async function formatFilesWithPrettier(files, root, options) {
    const results = new Map();
    let prettier;
    try {
        const prettierPath = require.resolve('prettier', {
            paths: [...(0, installation_directory_1.getNxRequirePaths)(root), __dirname],
        });
        prettier = require(prettierPath);
    }
    catch { }
    if (!prettier) {
        // Detection said prettier, so this is "configured but not installed" -
        // the oxfmt path reports it, and silence here just leaves files
        // unformatted with no reason given.
        if (!options?.silent) {
            output_1.output.warn({
                title: 'prettier is configured for this workspace but is not installed.',
                bodyLines: ['Install "prettier" to format generated files.'],
            });
        }
        return results;
    }
    await Promise.all(Array.from(files).map(async (file) => {
        try {
            const systemPath = path.join(root, file.path);
            let resolvedOptions = {
                filepath: systemPath,
            };
            // No early return when this is null: detection accepts a formatter
            // declared in the root package.json, so a workspace can select prettier
            // without configuring it. Skipping here would leave `nx release` and
            // migrations unformatted while devkit's `formatFiles` - which has never
            // had this guard - formats the same workspace on prettier's defaults.
            const config = await prettier.resolveConfig(systemPath, {
                editorconfig: true,
            });
            resolvedOptions = {
                ...resolvedOptions,
                ...config,
            };
            const support = await prettier.getFileInfo(systemPath, resolvedOptions);
            if (support.ignored || !support.inferredParser) {
                return;
            }
            results.set(file.path, await prettier.format(file.content.toString('utf-8'), resolvedOptions));
        }
        catch (e) {
            if (!options?.silent) {
                output_1.output.warn({
                    title: `Could not format ${file.path}`,
                    bodyLines: [e.message],
                });
            }
        }
    }));
    return results;
}
async function runOxfmtBatch(files, root, options, rootConfigNames, read) {
    try {
        // The whole batch goes through one call: oxfmt's ESM API is loaded once and
        // each file is formatted in memory, so no process is spawned per file and a
        // file oxfmt cannot parse costs only itself.
        const { formatted, errors } = await (0, oxfmt_1.formatFilesWithOxfmt)(files.map((file) => ({
            path: file.path,
            content: file.content.toString('utf-8'),
        })), root, undefined, rootConfigNames, read);
        if (errors?.length && !options?.silent) {
            output_1.output.warn({
                title: 'Could not format some files with oxfmt',
                bodyLines: errors,
            });
        }
        return formatted;
    }
    catch (e) {
        if (!options?.silent) {
            output_1.output.warn({
                title: 'Could not format files with oxfmt',
                bodyLines: [e.message],
            });
        }
        return new Map();
    }
}
