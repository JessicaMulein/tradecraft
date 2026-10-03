/**
 * The Scene pane — the TUI's main pane (design, "TUI": "Scene (main): Fact Lines
 * in plain style, then Flavour in dim italic as it streams. Dialogue shows the
 * speaker's name"; Requirements 13.2, 13.4, 13.6).
 *
 * The pane shows two things: a header built from the current {@link SceneView}
 * (the Location's name, description and atmosphere, the time, weather, crowd and
 * visible persons), and the turn transcript — the accumulated Fact Lines,
 * Narrator flavour and dialogue, in arrival order. Fact Lines render plain;
 * flavour and speech render in a distinct dim-italic style so the player can
 * always tell Fact from Flavour (Req 13.6); speech is prefixed with the
 * speaker's player-facing name.
 *
 * ## Presentational
 *
 * The pane is pure presentation: it takes the {@link SceneView} and the already-
 * accumulated transcript lines as props, so it renders identically whether those
 * lines came from a live {@link TurnStream} or a fixture. The streaming itself —
 * folding a {@link TurnStream} into {@link TranscriptState} with {@link
 * reduceTranscript} and passing `state.lines` here — is a pure reducer in
 * `./transcript.ts`, driven by the screen that owns the turn (a later task).
 *
 * ## Boundary
 *
 * The pane reads only `@tradecraft/player-view` types (Req 13.5): the view-safe
 * {@link SceneView} and the transcript lines, which are themselves a projection
 * of the view-safe {@link TurnChunk} stream. Nothing truth-bearing is reachable.
 */

import type { ReactElement } from 'react';
import { Box, Text } from 'ink';
import type { SceneView } from '@tradecraft/player-view';

import { formatTime } from './time.js';
import type { TranscriptLine } from './transcript.js';

/** Props for {@link ScenePane}. */
export interface ScenePaneProps {
  /** The current scene — Location, time, weather, crowd and visible persons. */
  readonly scene: SceneView;
  /**
   * The accumulated transcript lines, in arrival order (from {@link
   * reduceTranscript} over the turn's {@link TurnStream}). Defaults to empty so
   * the pane renders the header alone before any turn has streamed.
   */
  readonly lines?: readonly TranscriptLine[];
}

/** The scene header: Location name, description, atmosphere and conditions. */
function SceneHeader({ scene }: { readonly scene: SceneView }): ReactElement {
  const atmosphere = scene.location.atmosphere.join(', ');
  const visible =
    scene.visible.length === 0
      ? 'no one in sight'
      : scene.visible.map((p) => p.label).join(', ');
  return (
    <Box flexDirection="column">
      <Text bold>{scene.location.name}</Text>
      <Text>{scene.location.description}</Text>
      {atmosphere !== '' && <Text dimColor>{atmosphere}</Text>}
      <Text dimColor>
        {formatTime(scene.time)} · {scene.weather} · {scene.crowd} · risk{' '}
        {scene.location.risk}
      </Text>
      <Text dimColor>Here: {visible}</Text>
    </Box>
  );
}

/** One transcript line, styled by kind (fact plain; flavour/speech distinct). */
function TranscriptRow({ line }: { readonly line: TranscriptLine }): ReactElement {
  switch (line.kind) {
    case 'fact':
      // Fact Lines are plain, so the player can rely on them (Req 13.6).
      return <Text>{line.text}</Text>;
    case 'flavour':
      // Flavour is the distinct dim-italic style (design, "Scene"; Req 13.6).
      return (
        <Text dimColor italic>
          {line.text}
        </Text>
      );
    case 'speech':
      // Dialogue is Flavour too (dim italic), prefixed with the speaker's name.
      return (
        <Text dimColor italic>
          {line.speaker}: {line.text}
        </Text>
      );
    default:
      return <Text />;
  }
}

/**
 * The Scene pane: the {@link SceneView} header above the turn transcript. Lines
 * render in order, Fact plain and Flavour/speech in the distinct style, so the
 * player can always tell them apart (Req 13.6).
 */
export function ScenePane({ scene, lines = [] }: ScenePaneProps): ReactElement {
  return (
    <Box flexDirection="column">
      <SceneHeader scene={scene} />
      {lines.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {lines.map((line, index) => (
            // The transcript is append-only in arrival order and never
            // reordered, so the arrival index is a stable key.
            <TranscriptRow key={index} line={line} />
          ))}
        </Box>
      )}
    </Box>
  );
}
