"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.format = format;
const tslib_1 = require("tslib");
const path = tslib_1.__importStar(require("node:path"));
const configuration_1 = require("../../config/configuration");
const typescript_1 = require("../../plugins/js/utils/typescript");
const affected_project_graph_1 = require("../../project-graph/affected/affected-project-graph");
const file_utils_1 = require("../../project-graph/file-utils");
const project_graph_1 = require("../../project-graph/project-graph");
const chunkify_1 = require("../../utils/chunkify");
const command_line_utils_1 = require("../../utils/command-line-utils");
const fileutils_1 = require("../../utils/fileutils");
const formatters_1 = require("../../utils/formatters");
const oxfmt_1 = require("../../utils/formatters/oxfmt");
const prettier_1 = require("../../utils/formatters/prettier");
const ignore_1 = require("../../utils/ignore");
const object_sort_1 = require("../../utils/object-sort");
const output_1 = require("../../utils/output");
const workspace_root_1 = require("../../utils/workspace-root");
/**
 * A table, not a `switch`: this lookup sits inside a `try` whose `catch`
 * reports "configured but not installed", and a `never` arm would throw into
 * that catch and be misreported. A missing member is a compile error here.
 */
const resolveFormatterBin = {
    oxfmt: oxfmt_1.getOxfmtBinPath,
    prettier: prettier_1.getPrettierPath,
};
async function format(command, args) {
    const formatterType = (0, formatters_1.detectFormatter)(workspace_root_1.workspaceRoot);
    if (!formatterType) {
        output_1.output.warn({
            title: 'No formatter configured.',
            bodyLines: ['Install oxfmt or prettier to enable formatting.'],
        });
        return;
    }
    // Detection reads configuration only, so a workspace can be configured for a
    // formatter that is not installed - a fresh clone, `--omit=dev` CI, a pruned
    // node_modules. Resolving now turns a raw MODULE_NOT_FOUND into something
    // actionable.
    try {
        resolveFormatterBin[formatterType]();
    }
    catch {
        output_1.output.error({
            title: `${formatterType} is configured for this workspace but is not installed.`,
            bodyLines: [
                `Install "${formatterType}" and try again, or remove its configuration to disable "nx format:${command}".`,
            ],
        });
        process.exit(1);
    }
    const { nxArgs } = (0, command_line_utils_1.splitArgsIntoNxArgsAndOverrides)(args, 'affected', { printWarnings: false }, (0, configuration_1.readNxJson)());
    // Patterns are kept raw here. Prettier is invoked through a shell so it
    // quotes them at the call site; oxfmt is invoked with execFile and needs
    // the unquoted paths.
    const patterns = await getPatterns(formatterType, {
        ...args,
        ...nxArgs,
    });
    // Chunkify the patterns array to prevent crashing the windows terminal.
    // The prettier path quotes each pattern on its way to the shell, so size the
    // chunks against that; oxfmt goes through execFile and gets them raw.
    const chunkList = (0, chunkify_1.chunkify)(patterns, undefined, formatterType === 'prettier'
        ? (pattern) => (0, prettier_1.quoteForShell)(pattern).length
        : undefined);
    switch (command) {
        case 'write':
            if (nxArgs.sortRootTsconfigPaths) {
                sortTsConfig();
            }
            addRootConfigFiles(chunkList, nxArgs);
            chunkList.forEach((chunk) => write(formatterType, chunk));
            break;
        case 'check': {
            const filesWithDifferentFormatting = [];
            for (const chunk of chunkList) {
                const files = await check(formatterType, chunk);
                filesWithDifferentFormatting.push(...files);
            }
            if (filesWithDifferentFormatting.length > 0) {
                if (nxArgs.verbose) {
                    output_1.output.error({
                        title: 'The following files are not formatted correctly',
                        bodyLines: [
                            '- Run "nx format:write" and commit the resulting diff to fix these files.',
                            '',
                            ...filesWithDifferentFormatting,
                        ],
                    });
                }
                else {
                    console.log(filesWithDifferentFormatting.join('\n'));
                }
                process.exit(1);
            }
            break;
        }
    }
}
async function getPatterns(formatterType, args) {
    const allFilesPattern = ['.'];
    if (args.all) {
        return allFilesPattern;
    }
    try {
        if (args.projects && args.projects.length > 0) {
            const graph = await (0, project_graph_1.createProjectGraphAsync)({ exitOnError: true });
            return getPatternsFromProjects(args.projects, graph);
        }
        const p = (0, command_line_utils_1.parseFiles)(args);
        // Deleted files still show up in the changed-file set, and neither
        // formatter should be handed a path that is no longer there.
        let patterns = p.files
            .map((f) => path.relative(workspace_root_1.workspaceRoot, f))
            .filter((f) => (0, fileutils_1.fileExists)(f));
        if (formatterType === 'prettier') {
            // oxfmt needs no equivalent filter - it silently skips file types it
            // does not handle, and its base args keep an all-skipped run green.
            patterns = await (0, prettier_1.filterToPrettierSupportedFiles)(patterns);
        }
        // exclude patterns in .nxignore or .gitignore
        const nonIgnoredPatterns = (0, ignore_1.getIgnoreObject)().filter(patterns);
        if (args.libsAndApps) {
            return getPatternsFromApps(nonIgnoredPatterns);
        }
        return nonIgnoredPatterns;
    }
    catch (err) {
        output_1.output.error({
            title: err?.message ||
                'Something went wrong when resolving the list of files for the formatter',
            bodyLines: [`Defaulting to all files pattern: "${allFilesPattern}"`],
        });
        return allFilesPattern;
    }
}
async function getPatternsFromApps(affectedFiles) {
    const graph = await (0, project_graph_1.createProjectGraphAsync)({
        exitOnError: true,
    });
    const affectedGraph = await (0, affected_project_graph_1.filterAffected)(graph, (0, file_utils_1.calculateFileChanges)(affectedFiles));
    return getPatternsFromProjects(Object.keys(affectedGraph.nodes), affectedGraph);
}
function addRootConfigFiles(chunkList, nxArgs) {
    if (nxArgs.all) {
        return;
    }
    const chunk = [];
    const addToChunkIfNeeded = (file) => {
        if (chunkList.every((c) => !c.includes(file))) {
            chunk.push(file);
        }
    };
    ['nx.json', (0, typescript_1.getRootTsConfigFileName)()]
        .filter(Boolean)
        .forEach(addToChunkIfNeeded);
    if (chunk.length > 0) {
        chunkList.push(chunk);
    }
}
function getPatternsFromProjects(projects, projectGraph) {
    return (0, command_line_utils_1.getProjectRoots)(projects, projectGraph);
}
function write(formatterType, patterns) {
    if (patterns.length === 0) {
        return;
    }
    switch (formatterType) {
        case 'oxfmt':
            (0, oxfmt_1.writeWithOxfmt)(patterns);
            break;
        case 'prettier':
            (0, prettier_1.writeWithPrettier)(patterns);
            break;
        default: {
            // Without this, an unhandled formatter makes `nx format:write` exit 0
            // having formatted nothing, while `check()` throws - the two halves of
            // the same command disagreeing.
            const unhandled = formatterType;
            throw new Error(`Unhandled formatter: ${unhandled}`);
        }
    }
}
async function check(formatterType, patterns) {
    if (patterns.length === 0) {
        return [];
    }
    switch (formatterType) {
        case 'oxfmt':
            return (0, oxfmt_1.checkWithOxfmt)(patterns);
        case 'prettier':
            return (0, prettier_1.checkWithPrettier)(patterns);
        default: {
            // `strict: false` does not make a missing case an error on its own, but
            // it does reject this assignment - so adding a formatter fails to compile
            // here instead of returning undefined into a caller that spreads it.
            const unhandled = formatterType;
            throw new Error(`Unhandled formatter: ${unhandled}`);
        }
    }
}
function sortTsConfig() {
    try {
        const tsconfigPath = (0, typescript_1.getRootTsConfigPath)();
        const tsconfig = (0, fileutils_1.readJsonFile)(tsconfigPath);
        const sortedPaths = (0, object_sort_1.sortObjectByKeys)(tsconfig.compilerOptions.paths);
        tsconfig.compilerOptions.paths = sortedPaths;
        (0, fileutils_1.writeJsonFile)(tsconfigPath, tsconfig);
    }
    catch (e) {
        // catch noop
    }
}
