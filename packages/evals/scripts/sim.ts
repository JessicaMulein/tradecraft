/**
 * `pnpm sim --seed <s> --script <actions.json>` — a debug CLI that runs a
 * scripted list of actions through the pure engine with NO model and prints the
 * resulting Fact Lines and the Case File (checkpoint 12; design, "Engine
 * inspection").
 *
 * This is a thin arg-parse + IO wrapper around the testable {@link runScript} /
 * {@link renderSimReport} helpers in `src/lib/debug/`: it parses the flags with
 * node's built-in `util.parseArgs`, reads the script file (a JSON array of
 * engine {@link Action}s) with `node:fs`, folds the actions through the engine,
 * and prints the sectioned report to stdout.
 *
 * The script file is a JSON array of actions, e.g. `scripts/example-actions.json`:
 *   [
 *     { "kind": "wait", "phases": 1 },
 *     { "kind": "travel", "to": "<locId>", "countersurveillance": false }
 *   ]
 * A `travel` names a real Location id from the generated world; run `pnpm world
 * --seed <s>` first to see the city's Location ids. The shipped
 * `example-actions.json` is runnable as-is — its `wait`s produce output and its
 * `travel` carries a placeholder id you replace with a real one from
 * `pnpm world`. An action the engine rejects (a closed Location, an unreachable
 * destination) is reported as REJECTED and leaves the state unchanged, so a
 * script is always safe to iterate on.
 *
 * Usage:
 *   pnpm sim --seed vienna-alpha --script packages/evals/scripts/example-actions.json
 *   pnpm --filter @tradecraft/evals exec tsx scripts/sim.ts --seed s --script scripts/example-actions.json
 *
 * The script is NOT part of the build, the typecheck target or CI — it lives
 * outside `src`, so the lib build and the test run exclude it.
 */

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import type { Action } from '@tradecraft/engine';

import { renderSimReport, runScript } from '../src/lib/debug/sim-run.js';

const USAGE = `Usage: pnpm sim --seed <seed> --script <actions.json>

  --seed    <string>   the game seed to generate the world from (required)
  --script  <path>     path to a JSON file holding an array of engine actions
                       (required). See packages/evals/scripts/example-actions.json
  --help               show this message

The script file is a JSON array of actions, e.g.
  [ { "kind": "wait", "phases": 1 },
    { "kind": "travel", "to": "<locId>", "countersurveillance": false } ]
Run \`pnpm world --seed <seed>\` first to see the city's Location ids.`;

/** Fail with a message on stderr and a non-zero exit. */
function fail(message: string): never {
  process.stderr.write(`${message}\n\n${USAGE}\n`);
  process.exit(1);
}

/** Read and parse the script file into an array of actions. */
function readScript(path: string): readonly Action[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    fail(`error: cannot read script "${path}": ${err instanceof Error ? err.message : String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    fail(`error: script "${path}" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!Array.isArray(parsed)) {
    fail(`error: script "${path}" must be a JSON array of actions`);
  }
  for (const [i, entry] of parsed.entries()) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as { kind?: unknown }).kind !== 'string'
    ) {
      fail(`error: action ${i} in "${path}" is not an action object with a string "kind"`);
    }
  }
  return parsed as readonly Action[];
}

function main(): void {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        seed: { type: 'string' },
        script: { type: 'string' },
        help: { type: 'boolean', default: false },
      },
      strict: true,
    });
  } catch (err) {
    fail(`bad arguments: ${err instanceof Error ? err.message : String(err)}`);
  }

  const { seed, script, help } = parsed.values;

  if (help === true) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  if (seed === undefined || seed.length === 0) {
    fail('error: --seed is required');
  }
  if (script === undefined || script.length === 0) {
    fail('error: --script is required');
  }

  const actions = readScript(script);

  let report: string;
  try {
    report = renderSimReport(runScript(seed, actions));
  } catch (err) {
    fail(`sim failed for seed "${seed}": ${err instanceof Error ? err.message : String(err)}`);
  }

  process.stdout.write(report);
}

main();
