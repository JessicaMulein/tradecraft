/**
 * `pnpm content <command> [options]` — the runnable entry for the content
 * authoring tools (task 5.1; design, "content-tools package").
 *
 * This is a thin IO wrapper around the testable {@link main} dispatcher in
 * `src/cli.ts`, mirroring the `scripts/play.ts` and `scripts/world.ts` pattern:
 * the root `pnpm content` script runs it through `tsx`. The script lives outside
 * `src`, so the lib build, the typecheck target and CI exclude it; it only needs
 * to run under an ESM TS runner.
 *
 * Usage:
 *   pnpm content lint --profile release
 *   pnpm --filter @tradecraft/content-tools exec tsx scripts/content.ts preview --help
 */

import { main } from '../src/cli.js';

void main();
