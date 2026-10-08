import { type Tree } from '@nx/devkit';
/**
 * TypeScript 6.0 changed the implicit `rootDir`. Before 6.0 an unset `rootDir`
 * was inferred as the common directory of a program's non-declaration input
 * files; 6.0 defaults it to the tsconfig's own directory instead. A program
 * whose files resolve outside that directory (most commonly a spec/e2e tsconfig
 * importing another project's source through a `paths` alias) then hard-fails
 * with TS5011 or TS6059.
 *
 * For every project `tsconfig*.json` that lacks an explicit `rootDir`, this pins
 * `rootDir` to exactly the directory TypeScript 5 would have inferred, so both
 * compilation and emit layout are unchanged under 6.0. The value is computed by
 * the compiler itself: a throwaway program built with `configFilePath` cleared
 * takes the file-derived branch of `getCommonSourceDirectory`, so it matches
 * `tsc` exactly, including project-reference redirects. The pin is written even
 * when the inferred directory already equals the tsconfig directory: inference
 * is per-program, and tools like ts-jest's `isolatedModules` compile single
 * files against the same config, collapsing the common directory below the
 * config dir and failing with TS5011.
 *
 * Composite configs are pinned too, to the tsconfig's own directory. Under `tsc`
 * a composite `rootDir` already defaults there (for any file subset), so `"."`
 * is a no-op — but ts-jest strips `composite` for its per-file transpile, and
 * TypeScript 6 only exempts genuinely-composite programs from the containment
 * check (`!options.composite`), so a composite spec config compiled by ts-jest
 * hits TS5011 all the same. The explicit `"."` survives the strip. Pinning the
 * own directory (not a deeper file-derived value) keeps a real composite build's
 * emit layout unchanged.
 *
 * Each config is written on its own; nothing is written to a shared `extends`
 * base, so a config never inherits a `rootDir` computed for a sibling — and
 * because every config that emits is given its own explicit `rootDir`, none
 * inherits a value pinned on a base. Runs only on TypeScript 6 workspaces
 * (gated by `requires`).
 */
export default function (tree: Tree): Promise<void>;
