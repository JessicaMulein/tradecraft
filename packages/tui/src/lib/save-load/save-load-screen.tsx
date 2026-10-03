/**
 * The Save/load screen (design, "TUI" → the Save/load screen: lists
 * `saves.list()`; saves with `manifestMatches: false` are marked; loading one
 * shows the `manifest-mismatch` pack list and leaves the current game unchanged;
 * Requirements 13.9, 31.6). Task 22.12.
 *
 * The screen renders the save listing the facade reports — one row per
 * {@link SaveInfo}, each showing the save name, its seed, its Difficulty Preset
 * and its day/phase — with a cursor the player moves to pick one. Saves taken
 * under different Content Packs (`manifestMatches === false`) are marked, and
 * when such a save is highlighted the screen shows its `manifest-mismatch` pack
 * list as a read-only warning: loading it is *refused* so the current game is
 * never changed by inspecting an incompatible save (Req 31.6).
 *
 * ## Presentational over props (the facade `saves` is a stub)
 *
 * The facade's `saves` object is not yet wired to the filesystem (that is a
 * separate task), so — like the game-over and debrief screens — this screen is
 * built presentationally: it takes the listing as a `saves` prop and the
 * load/save/cancel actions as callbacks (`onLoad`/`onSave`/`onCancel`). The pure
 * cursor and manifest-gate logic lives in `./save-list.ts`; the differing-pack
 * list for a mismatched save is supplied by the owning screen (which has run
 * player-view's `diffManifests`/`loadSnapshot` and holds the resulting
 * `manifest-mismatch` `LoadError`), keyed by save name — `SaveInfo` itself
 * carries only the `manifestMatches` boolean.
 *
 * ## Boundary (Req 13.5)
 *
 * The screen reads only `@tradecraft/player-view` types — the view-safe
 * {@link SaveInfo} and the `manifest-mismatch` differing-pack shape (mirrored
 * locally as {@link PackDifference}). The engine `GameTime` is not re-exported,
 * so the day/phase is rendered by the TUI's own `formatTime` helper.
 *
 * ## Keys
 *
 * - Up/Down move the cursor between saves (wrapping).
 * - Enter loads the highlighted save — but only when its manifest matches; on a
 *   mismatched save Enter does nothing but keep the warning on screen.
 * - `s` writes a new save (fires `onSave`), when `onSave` is supplied.
 * - Esc cancels and returns without changing the game.
 */

import { useReducer, type ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';
import type { SaveInfo } from '@tradecraft/player-view';

import { formatTime } from '../scene/time.js';
import {
  canLoad,
  initialSaveListState,
  reduceSaveList,
  selectedSave,
  type PackDifference,
} from './save-list.js';

/** Props for {@link SaveLoadScreen}. */
export interface SaveLoadScreenProps {
  /**
   * The saves to list (the facade's `saves.list()` result), in display order.
   * Each row shows the save's name, seed, Difficulty Preset and day/phase.
   */
  readonly saves: readonly SaveInfo[];
  /**
   * The `manifest-mismatch` differing-pack list for mismatched saves, keyed by
   * save name. The owning screen supplies this from player-view's
   * `diffManifests` / the `manifest-mismatch` `LoadError`. A save with
   * `manifestMatches === false` whose name is absent here still shows the
   * generic mismatch warning (the pack detail is simply unavailable).
   */
  readonly mismatchedPacks?: Readonly<Record<string, readonly PackDifference[]>>;
  /**
   * Load the named save. Fired on Enter over a save whose manifest matches; a
   * mismatched save is refused (never fires this), leaving the game unchanged.
   */
  readonly onLoad?: (name: string) => void;
  /** Write a new save. Fired on `s`, when supplied. */
  readonly onSave?: (name: string) => void;
  /** Leave the screen without changing the game. Fired on Esc. */
  readonly onCancel?: () => void;
}

/** The player-facing name a new save is written under when `s` is pressed. */
const NEW_SAVE_NAME = 'quicksave';

/** One save row: a cursor marker, the name, seed, preset, time and mismatch mark. */
function SaveRow({
  save,
  highlighted,
}: {
  readonly save: SaveInfo;
  readonly highlighted: boolean;
}): ReactElement {
  const mismatched = !save.manifestMatches;
  return (
    <Box>
      <Text color={highlighted ? 'cyan' : undefined}>
        {highlighted ? '> ' : '  '}
        {save.name}
      </Text>
      <Text dimColor>
        {'  '}seed {save.seed} · {save.difficulty} · {formatTime(save.at)}
      </Text>
      {mismatched ? (
        <Text color="yellow">
          {'  '}[manifest mismatch]
        </Text>
      ) : null}
    </Box>
  );
}

/** The read-only warning shown under a selected mismatched save (Req 31.6). */
function MismatchWarning({
  save,
  packs,
}: {
  readonly save: SaveInfo;
  readonly packs: readonly PackDifference[];
}): ReactElement {
  return (
    <Box flexDirection="column">
      <Text color="yellow">
        This save was taken under different Content Packs. It cannot be loaded;
        the current game is unchanged.
      </Text>
      {packs.length === 0 ? (
        <Text dimColor>(The differing packs are not available to show.)</Text>
      ) : (
        packs.map((pack) => (
          <Text key={pack.id} dimColor>
            {'  '}
            {pack.id}: save {pack.saved ?? '—'} vs loaded {pack.loaded ?? '—'}
          </Text>
        ))
      )}
    </Box>
  );
}

/** The placeholder shown when there are no saves to list. */
function EmptyList(): ReactElement {
  return <Text dimColor>No saves found.</Text>;
}

/**
 * The Save/load screen: lists the saves, marks the ones whose manifest no longer
 * matches the loaded packs, and loads the highlighted save on Enter — refusing a
 * mismatched save and surfacing its differing-pack list instead. Holds the
 * cursor with the pure reducer in `./save-list.ts`.
 */
export function SaveLoadScreen({
  saves,
  mismatchedPacks,
  onLoad,
  onSave,
  onCancel,
}: SaveLoadScreenProps): ReactElement {
  const [state, dispatch] = useReducer(
    reduceSaveList,
    initialSaveListState(saves),
  );

  const current = selectedSave(state);

  useInput((input, key) => {
    if (key.upArrow) {
      dispatch({ type: 'prev' });
      return;
    }
    if (key.downArrow) {
      dispatch({ type: 'next' });
      return;
    }
    if (key.escape) {
      onCancel?.();
      return;
    }
    if (input === 's' && onSave !== undefined) {
      onSave(NEW_SAVE_NAME);
      return;
    }
    if (key.return) {
      // A mismatched save is refused: Enter keeps the warning on screen and
      // leaves the current game unchanged (Req 31.6). Only a matching save
      // fires onLoad.
      if (current !== undefined && canLoad(current)) {
        onLoad?.(current.name);
      }
    }
  });

  const showWarning = current !== undefined && !current.manifestMatches;
  const warningPacks =
    showWarning && mismatchedPacks !== undefined
      ? mismatchedPacks[current.name] ?? []
      : [];

  return (
    <Box flexDirection="column">
      <Text bold>Saves</Text>
      <Box marginTop={1} flexDirection="column">
        {saves.length === 0 ? (
          <EmptyList />
        ) : (
          saves.map((save, index) => (
            <SaveRow
              key={save.name}
              save={save}
              highlighted={index === state.index}
            />
          ))
        )}
      </Box>
      {showWarning && current !== undefined ? (
        <Box marginTop={1}>
          <MismatchWarning save={current} packs={warningPacks} />
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>
          ↑/↓ move · Enter load{onSave !== undefined ? ' · s save' : ''} · Esc
          cancel
        </Text>
      </Box>
    </Box>
  );
}
