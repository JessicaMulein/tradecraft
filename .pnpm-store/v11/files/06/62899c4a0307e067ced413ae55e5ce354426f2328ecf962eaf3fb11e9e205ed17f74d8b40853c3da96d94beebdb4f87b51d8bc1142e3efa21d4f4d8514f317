import { type Tree } from '@nx/devkit';
/**
 * Runs on TypeScript 6 workspaces (gated by `requires` in migrations.json) in
 * two passes over every `tsconfig*.json`.
 *
 * Pass 1 writes what pass 2's `extends` resolution reads back:
 *  - Default-preserving pins: on every chain root (no `extends`) that is not a
 *    pure solution container (`files: []` with no `include`), pin the TS6
 *    defaults that changed in a breaking way, but only where the root leaves
 *    them unset:
 *      - `strict: false`. TS6 treats an absent `strict` as true, TS5 as false.
 *      - `noUncheckedSideEffectImports: false`. TS6 defaults it true, turning a
 *        bare side-effect import of an asset without an ambient declaration
 *        (`import './styles.css'`) into a hard TS2882; a semantic diagnostic,
 *        not a deprecation, so `ignoreDeprecations` cannot silence it.
 *      - `types: ["*"]`. TS6 loads no @types when `types` is unset (TS5 loaded
 *        all); the wildcard restores that so a config relying on it (ts-node
 *        type-checking jest.config.ts) keeps finding @types/node.
 *      - `esModuleInterop: false`. TS6 flips the default false->true, changing
 *        `import * as x from '<cjs>'` call semantics at runtime; false preserves
 *        the pre-TS6 behavior. It is itself deprecated (removed in TS7), so pass
 *        2 silences it, deferring the interop change to the eventual TS7 work.
 *  - Config-load flag: set `ignoreDeprecations: "6.0"` on every file named
 *    exactly `tsconfig.json`, the name ts-node auto-resolves when jest compiles
 *    a config file like jest.config.ts (walking up from the working directory,
 *    not the config file's own directory). ts-node injects a
 *    `target: es5` when the config leaves it unset, and es5 is a TS6-deprecated
 *    value (TS5107); the flag (which ts-node passes through) keeps that load
 *    silent. Set unconditionally, since any `tsconfig.json` is a potential
 *    loader target, and inert when nothing is deprecated. It cannot silence a
 *    module/moduleResolution mismatch (TS5110) when ts-node's forced
 *    `module: commonjs` meets an inherited `nodenext` resolution.
 *
 * Pass 2 silences the remaining hard-deprecated values. For each config,
 * TypeScript resolves its `extends`-merged compiler options; when they carry a
 * value TS6 hard-deprecates (see `hasDeprecatedOption`) and their effective
 * `ignoreDeprecations` is not already `"6.0"`, add the flag. Because the check
 * runs on the merged options, it covers a value the config inherits from a base
 * this migration never edits, respects an inherited `"6.0"` (no redundant flag),
 * and upgrades a stale local `"5.0"` that overrides one. The
 * `ts-node.compilerOptions` overlay, which `tsc` does not merge, is checked on
 * its own.
 */
export default function (tree: Tree): Promise<void>;
