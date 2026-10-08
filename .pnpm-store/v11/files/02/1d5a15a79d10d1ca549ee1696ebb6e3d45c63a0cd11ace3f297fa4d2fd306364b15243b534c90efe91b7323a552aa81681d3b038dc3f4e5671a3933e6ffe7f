"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const metadata_1 = require("../completion/metadata");
const completion_providers_1 = require("../completion/completion-providers");
(0, metadata_1.registerCompletion)('show project', {
    positionals: [{ complete: completion_providers_1.getProjectNameCompletions }],
});
// `nx show target` accepts the keyword on either side of the target —
// `nx show target my-app:build inputs` or `nx show target inputs my-app:build`.
const TARGET_SUBCOMMANDS = ['inputs', 'outputs'];
(0, metadata_1.registerCompletion)('show target', {
    positionals: [
        {
            complete: (current) => [
                ...(0, completion_providers_1.completeProjectTarget)(current),
                ...TARGET_SUBCOMMANDS.filter((k) => k.startsWith(current)),
            ],
        },
        { choices: TARGET_SUBCOMMANDS },
    ],
});
(0, metadata_1.registerCompletion)('show target inputs', {
    positionals: [{ complete: completion_providers_1.completeProjectTarget }],
});
(0, metadata_1.registerCompletion)('show target outputs', {
    positionals: [{ complete: completion_providers_1.completeProjectTarget }],
});
