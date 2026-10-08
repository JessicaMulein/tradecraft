"use strict";
// Side-effect imports populating the completion registry. Each
// command's completion.ts pulls only metadata helpers + providers, not
// the heavy command-object surface.
Object.defineProperty(exports, "__esModule", { value: true });
require("../run/completion");
require("../run-many/completion");
require("../affected/completion");
require("../show/completion");
require("../generate/completion");
require("../graph/completion");
require("../watch/completion");
require("../add/completion");
// Must be last — infix-targets skips any name already registered above
// so a real Nx command (`run`, `add`, ...) wins over a same-named target.
require("./infix-targets");
