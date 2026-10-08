"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const metadata_1 = require("../completion/metadata");
const completion_providers_1 = require("../completion/completion-providers");
// Aliases are written out; the fast path runs before yargs can resolve them.
(0, metadata_1.registerCompletion)('affected', {
    flags: {
        projects: completion_providers_1.getProjectNameCompletions,
        p: completion_providers_1.getProjectNameCompletions,
        exclude: completion_providers_1.getProjectNameCompletions,
        targets: completion_providers_1.getTargetNameCompletions,
        target: completion_providers_1.getTargetNameCompletions,
        t: completion_providers_1.getTargetNameCompletions,
    },
});
