"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAngularPlugin = runAngularPlugin;
async function runAngularPlugin(tree, schema) {
    let move;
    try {
        // nx-ignore-next-line
        move = require('@nx/angular/internal').move;
    }
    catch { }
    if (!move) {
        return;
    }
    await move(tree, {
        oldProjectName: schema.projectName,
        newProjectName: schema.newProjectName,
    });
}
