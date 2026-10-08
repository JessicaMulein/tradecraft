"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeFormattedJsonFile = writeFormattedJsonFile;
const node_fs_1 = require("node:fs");
const format_changed_files_1 = require("../generators/internal-utils/format-changed-files");
const json_1 = require("./json");
const fileutils_1 = require("./fileutils");
const workspace_root_1 = require("./workspace-root");
/**
 * Writes a JSON file, formatting it with whichever formatter the workspace is
 * configured for, and falling back to standard JSON serialization when there
 * is none or it cannot format the file.
 */
async function writeFormattedJsonFile(filePath, content, options) {
    const formattedContent = await (0, format_changed_files_1.formatFileContents)([{ path: filePath, content: (0, json_1.serializeJson)(content) }], workspace_root_1.workspaceRoot, { silent: true });
    if (formattedContent.has(filePath)) {
        (0, node_fs_1.writeFileSync)(filePath, formattedContent.get(filePath), {
            encoding: 'utf-8',
        });
    }
    else {
        (0, fileutils_1.writeJsonFile)(filePath, content, options);
    }
}
