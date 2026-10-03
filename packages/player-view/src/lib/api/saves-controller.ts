/**
 * The saves controller (slice-integration task 9.4; design, "Facade: saves";
 * Requirements 13.1–13.6).
 *
 * This is the implementation behind the facade's `saves` surface. It lives here,
 * not in `engine-api.ts`, so the facade stays out of the
 * `save → turn-pipeline → engine-api` import cycle: the pure save/load module
 * (`../save/save.ts`) imports the Turn Pipeline's stores, and the Turn Pipeline
 * imports the facade for its `PlayerViewEngine` type, so a facade that imported
 * the save module directly would close a cycle. Instead the controller imports
 * the facade (for the {@link PlayerViewEngine} type) and the save module, and
 * the facade only holds it behind the {@link SavesController} seam — exactly the
 * inversion the Turn Pipeline's `createTurnDriver` uses.
 *
 * `createSavesController(engine, { saveStore, bridge })` closes over the facade,
 * the injected {@link SaveStore} and the {@link SaveBridge} to the
 * pipeline/dialogue stores, and returns the `{ list, save, load }` the facade
 * forwards to one-to-one.
 */

import { TruthStore } from '@tradecraft/engine';
import type { ContentManifest } from '@tradecraft/content';

import { HintStore } from '../aids/hints.js';
import {
  diffManifests,
  parseAndLoad,
  saveSnapshot,
  type FlavourCacheSnapshotData,
  type LoadedSession,
  type PipelineSnapshot,
  type SaveSnapshot,
  type ViewStateSnapshot,
} from '../save/save.js';
import { canonicalJson } from '../save/in-memory-save-store.js';
import { ActionLog, ExtractionQueue } from './turn-pipeline.js';
import { isValidSaveName } from './types.js';
import type {
  GameView,
  LoadError,
  Result,
  SaveInfo,
  SaveStore,
} from './types.js';
import type {
  LoadedGame,
  PlayerViewEngine,
  SavesController,
} from './engine-api.js';

/**
 * The pipeline- and dialogue-owned pieces a save composes beside the facade's
 * own stores (the Journal, Notifications, Case File, Truth Store and World
 * State). The facade cannot reach these — the Turn Pipeline owns the action log,
 * the extraction queue, the monotonic turn counter and the `outcomeWritten`
 * flag privately, and the Location Flavour cache lives in `dialogue` — so the
 * controller reaches them through the injected {@link SaveBridge}.
 */
export interface SaveBridgeParts {
  /** The Location Flavour cache's plain snapshot. */
  readonly flavourCache: FlavourCacheSnapshotData;
  /** The Turn Pipeline's ordered action log. */
  readonly actionLog: ActionLog;
  /** The Turn Pipeline's pending extraction queue. */
  readonly extractionQueue: ExtractionQueue;
  /** The Player-View bookkeeping (seen hints, observed cover states). */
  readonly viewState: ViewStateSnapshot;
  /** The resumable counters (`turnCounter`, `outcomeWritten`). */
  readonly pipeline: PipelineSnapshot;
}

/**
 * The bridge to the parts of a Session the facade does not own directly
 * (slice-integration task 9.4). `collect()` reads the current pipeline/dialogue
 * state for `save`; `restore(loaded)` resets those stores from a loaded save so
 * a continued game keeps the saved action log and `turnId` order and never
 * re-writes the Outcome Record (the `outcomeWritten` flag carries over, Req
 * 7.6). The Composition Root (task 12.5) wires one that reads and resets the
 * pipeline's stores and the dialogue Flavour cache.
 */
export interface SaveBridge {
  /** The pipeline/dialogue parts of the current Session, for `save`. */
  collect(): SaveBridgeParts;
  /** Reset the pipeline/dialogue stores from a loaded save, for `load`. */
  restore(loaded: LoadedSession): void;
}

/** What {@link createSavesController} needs beyond the facade. */
export interface SavesControllerDeps {
  /** The injected store that reads, lists and atomically writes saves. */
  readonly saveStore: SaveStore;
  /** The bridge to the pipeline/dialogue stores a save composes. */
  readonly bridge: SaveBridge;
}

/**
 * Build the {@link SavesController} the facade forwards its `saves` surface to.
 * Closed over the facade and the injected {@link SaveStore} / {@link SaveBridge},
 * it composes a save from the facade's own stores plus the bridge's parts,
 * writes it as canonical JSON, lists stored saves with their manifest-match
 * flag, and loads a save by rebuilding the whole game and swapping it in.
 */
export function createSavesController(
  engine: PlayerViewEngine,
  deps: SavesControllerDeps,
): SavesController {
  const { saveStore, bridge } = deps;

  return {
    /**
     * List the stored saves (design `saves.list`; Req 13.2). Each file's header
     * is read cheaply by the store; this maps the readable ones to
     * {@link SaveInfo} and sets `manifestMatches` by comparing the save's
     * manifest to the loaded packs with {@link diffManifests}. A file whose
     * header could not be read is skipped.
     */
    list(): SaveInfo[] {
      const loaded = engine.loadedManifest;
      const out: SaveInfo[] = [];
      for (const entry of saveStore.list()) {
        if (entry.header === 'corrupt') {
          continue;
        }
        const header = entry.header;
        out.push({
          name: entry.name,
          seed: header.seed,
          difficulty: header.difficulty,
          at: header.at,
          savedAt: header.savedAt,
          manifestMatches:
            diffManifests(header.content as unknown as ContentManifest, loaded)
              .length === 0,
        });
      }
      return out;
    },

    /**
     * Write the current game to a save (design `saves.save`; Req 13.1, 13.6).
     * The name is validated against {@link isValidSaveName} *before* anything is
     * built or written, so an unsafe name is rejected with no I/O (Req 13.6).
     * Then {@link saveSnapshot} composes the whole Session — the facade's own
     * stores plus the bridge's parts — the snapshot is serialised with canonical
     * JSON, and the store writes it atomically.
     */
    save(name: string): Promise<SaveInfo> {
      if (!isValidSaveName(name)) {
        return Promise.reject(
          new Error(
            `"${name}" is not a valid save name; use letters, digits, spaces, underscores or hyphens (starting with a letter or digit), up to 64 characters`,
          ),
        );
      }

      const truth = engine.truthStoreForSave;
      if (truth === undefined) {
        return Promise.reject(
          new Error('cannot save: the facade holds no Truth Store to snapshot'),
        );
      }

      const parts = bridge.collect();
      let snapshot: SaveSnapshot;
      try {
        snapshot = saveSnapshot({
          world: engine.worldState,
          journal: engine.journal,
          notifications: engine.notificationStoreRef,
          flavourCache: parts.flavourCache,
          actionLog: parts.actionLog,
          extractionQueue: parts.extractionQueue,
          caseFile: engine.caseFileStore,
          truth: truth.snapshot(),
          viewState: parts.viewState,
          pipeline: parts.pipeline,
        });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }

      saveStore.write(name, canonicalJson(snapshot));
      return Promise.resolve({
        name,
        seed: snapshot.seed,
        difficulty: snapshot.difficulty.id,
        at: snapshot.world.time,
        savedAt: snapshot.savedAt,
        // A just-written save is of this build, so its manifest matches.
        manifestMatches: true,
      });
    },

    /**
     * Load a save, swapping the whole game in on success (design `saves.load`;
     * Req 13.3–13.5). The store reads and `JSON.parse`s the file;
     * {@link parseAndLoad} validates it against the loaded manifest and maps
     * every failure to a typed {@link LoadError} — `corrupt` (missing,
     * unreadable or malformed), `version`, or `manifest-mismatch`. On any error
     * the current game is left untouched (Req 13.4, 13.5). On success the loaded
     * game is rebuilt — the Truth Store from the save's data and the loaded
     * registry, a fresh hints store with the saved seen flags re-marked — the
     * facade swaps its stores through {@link PlayerViewEngine.applyLoaded}, and
     * the bridge resets the pipeline/dialogue stores, so no store from the old
     * game survives (Req 13.3).
     */
    load(name: string): Promise<Result<GameView, LoadError>> {
      const read = saveStore.read(name);
      if (isReadError(read)) {
        // A missing or unreadable file is a `corrupt` load error, and the
        // current game is left untouched.
        return Promise.resolve({
          ok: false,
          error: {
            kind: 'corrupt',
            message:
              read.error === 'missing'
                ? `no save named "${name}"`
                : `the save "${name}" could not be read`,
          },
        });
      }

      const result = parseAndLoad(read, engine.loadedManifest);
      if (!result.ok) {
        // version / manifest-mismatch / corrupt: leave the current game as is.
        return Promise.resolve({ ok: false, error: result.error });
      }
      const session = result.session;

      // Rebuild the loaded game's engine-level stores (the controller holds the
      // predicate registry the facade's save path hands it through the engine).
      const content = engine.contentForLoad;
      const truth = TruthStore.from(content.predicates.evaluators, session.truth);
      const hints = new HintStore(content, engine.hints.enabled);
      for (const trigger of session.viewState.hintsSeen) {
        // `fire` marks a trigger seen even when hints are disabled, restoring
        // the seen set without showing anything (Req 19.10).
        hints.fire(trigger);
      }

      // `loadSnapshot` already rebuilt the view-safe stores (Case File, Journal,
      // Notifications) from the save; carry them straight through.
      const loaded: LoadedGame = {
        world: session.world,
        truth,
        caseFile: session.caseFile,
        journal: session.journal,
        notifications: session.notifications,
        hints,
      };

      // Swap the facade's own stores in one assignment (Req 13.3), then reset
      // the pipeline/dialogue stores from the same loaded session so the whole
      // Session swaps together.
      const view = engine.applyLoaded(loaded);
      bridge.restore(session);
      return Promise.resolve({ ok: true, value: view });
    },
  };
}

/** Whether a {@link SaveStore.read} result is the error marker, not a save value. */
function isReadError(
  value: unknown,
): value is { readonly error: 'missing' | 'unreadable' } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    ((value as { error: unknown }).error === 'missing' ||
      (value as { error: unknown }).error === 'unreadable')
  );
}
