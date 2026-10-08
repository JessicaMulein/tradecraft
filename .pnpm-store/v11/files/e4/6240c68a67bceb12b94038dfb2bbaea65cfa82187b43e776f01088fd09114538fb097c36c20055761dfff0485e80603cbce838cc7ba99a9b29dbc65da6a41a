"use strict";
// Fast-path completion: project/target/generator/flag values, served from
// registered metadata without loading the yargs command surface.
Object.defineProperty(exports, "__esModule", { value: true });
exports.tryValueCompletion = tryValueCompletion;
require("./registrations");
const metadata_1 = require("./metadata");
const argv_layout_1 = require("./argv-layout");
/** Returns true if handled — caller should not fall through. */
function tryValueCompletion(argv = process.argv) {
    const parsed = (0, argv_layout_1.parseCompletionArgs)(argv);
    if (parsed === null)
        return false;
    const completions = (0, metadata_1.resolveCompletion)(parsed.tokens, parsed.current, parsed.previousToken);
    if (completions === null)
        return false;
    for (const line of completions) {
        console.log(line);
    }
    return true;
}
