/**
 * The filesystem {@link OutcomeSink} (slice-integration task 12.3; design,
 * "Turn Pipeline" step 9; Requirements 7.6, 13.1). Task 12.3.
 *
 * The Turn Pipeline writes the game's {@link OutcomeRecord} through the injected
 * {@link OutcomeSink} seam exactly once per game, when a turn commits a new End
 * Condition (design, "Turn Pipeline" step 9). This is the live wiring of that
 * seam: it persists the record to `saves/outcomes/`, beside the save files.
 *
 * The engine already owns the pure derivation (`buildOutcomeRecord`) and the
 * thin disk write (`writeOutcomeRecord`, which validates the record against the
 * versioned schema, creates `saves/outcomes/` if missing, and writes one
 * pretty-printed `<seed>-<endedAt>.json` file). This sink is the one-line
 * adapter from the pipeline's `(record) => void` seam onto that engine write, so
 * the Outcome Record directory and file-naming stay owned in one place.
 */

import { writeOutcomeRecord, type OutcomeRecord } from '@tradecraft/engine';
import type { OutcomeSink } from '@tradecraft/player-view';

/**
 * The default directory Outcome Records are written to (design: `saves/
 * outcomes/`). It lives beside the Saves Directory; `writeOutcomeRecord`
 * resolves it against the process working directory and creates it on first
 * write. Re-exported here under the sink's own name so the Composition Root can
 * name the directory without reaching into the engine for it.
 */
export const OUTCOMES_DIR = 'saves/outcomes';

/**
 * Build the filesystem {@link OutcomeSink} the Turn Pipeline writes through
 * (design, "Turn Pipeline" step 9; Req 7.6). Each call persists the record with
 * the engine's `writeOutcomeRecord`, which validates it before writing and
 * creates `saves/outcomes/` if it is missing. A write failure throws; the
 * pipeline catches it, leaves `outcomeWritten` false and raises a status-bar
 * notice, so the record is retried on a later end.
 *
 * @param dir the Outcome Records directory (default `saves/outcomes/`).
 */
export function fsOutcomeSink(dir: string = OUTCOMES_DIR): OutcomeSink {
  return (record: OutcomeRecord): void => {
    writeOutcomeRecord(record, dir);
  };
}
