"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateOxfmtSetup = generateOxfmtSetup;
const devkit_1 = require("@nx/devkit");
// Imported rather than copied: detection ("is this workspace using oxfmt?")
// and setup ("should a config be written?") have to agree on the same list, or
// a workspace that already has a config gets a second, redundant one.
const internal_1 = require("@nx/devkit/internal");
const nx_formatter_internals_1 = require("./nx-formatter-internals");
const versions_1 = require("./versions");
function generateOxfmtSetup(tree, options) {
    (0, nx_formatter_internals_1.assertNxSupportsFormatters)();
    if (internal_1.oxfmtConfigFiles.every((name) => !tree.exists(name))) {
        // oxfmt defaults to double quotes and we prefer single, so that is the one
        // option worth setting. Line width is left at oxfmt's default.
        (0, devkit_1.writeJson)(tree, '.oxfmtrc.json', { singleQuote: true });
    }
    // The oxc extension is what drives oxfmt in the editor, so recommend it for
    // the same reason the prettier setup recommends its own. Only when the file
    // is already there - creating it would push an editor choice on a workspace
    // that has not made one.
    if (tree.exists('.vscode/extensions.json')) {
        (0, devkit_1.updateJson)(tree, '.vscode/extensions.json', (json) => {
            json.recommendations ??= [];
            const extension = 'oxc.oxc-vscode';
            if (!json.recommendations.includes(extension)) {
                json.recommendations.push(extension);
            }
            return json;
        });
    }
    return options.skipPackageJson
        ? () => { }
        : (0, devkit_1.addDependenciesToPackageJson)(tree, {}, { oxfmt: versions_1.oxfmtVersion });
}
