"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNodesFromFiles = createNodesFromFiles;
const error_types_1 = require("../error-types");
async function createNodesFromFiles(createNodes, configFiles, options, context) {
    const settled = await Promise.all(configFiles.map(async (file, idx) => {
        try {
            const value = await createNodes(file, options, {
                ...context,
                configFiles,
            }, idx);
            return value ? { kind: 'value', file, value } : { kind: 'empty' };
        }
        catch (e) {
            return { kind: 'error', file, error: e };
        }
    }));
    const results = [];
    const errors = [];
    for (const entry of settled) {
        if (entry.kind === 'value') {
            results.push([entry.file, entry.value]);
        }
        else if (entry.kind === 'error') {
            errors.push([entry.file, entry.error]);
        }
    }
    if (errors.length > 0) {
        throw new error_types_1.AggregateCreateNodesError(errors, results);
    }
    return results;
}
