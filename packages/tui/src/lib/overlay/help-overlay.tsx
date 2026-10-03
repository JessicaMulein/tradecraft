/**
 * The help overlay — a toggleable panel listing the commands available in the
 * current context, with their costs, plus the glossary (task 22.8; design,
 * "Help and hints": "Help lists `quote()` results for the current Location";
 * Requirement 26.5).
 *
 * The overlay answers "what can I do here, and what does it cost?" from the
 * facade's {@link HelpView} projection: the current Location's actions each with
 * their {@link ActionQuote} (the phase/money cost when allowed, the reason when
 * not), and the glossary drawn from the Content Set. It is a transient surface
 * the player toggles with `?` and dismisses with `?` again or Escape; while
 * hidden it renders nothing so it adds no footprint to the layout.
 *
 * ## Presentational
 *
 * The overlay is pure presentation over the {@link HelpView} prop and a
 * `visible` flag the owning screen controls, so it renders identically from a
 * live projection or a fixture. Its own `useInput` recognises `?`/Escape and
 * reports a toggle through `onToggle`; the owning screen owns the visibility
 * state and the key that first opens it, so there is one source of truth even
 * when several surfaces listen for `?`.
 *
 * ## Boundary
 *
 * The overlay reads only `@tradecraft/player-view` types (Req 13.5): the
 * view-safe {@link HelpView}, whose action entries carry a cost/eligibility
 * {@link ActionQuote} and whose glossary entries are authored prose. Nothing
 * truth-bearing is reachable — the help content is derived from the facade's
 * projections, never from the engine.
 */

import type { ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';
import type { HelpActionEntry, HelpView } from '@tradecraft/player-view';

/** The key that toggles the help overlay. */
export const HELP_TOGGLE_KEY = '?';

/** Props for {@link HelpOverlay}. */
export interface HelpOverlayProps {
  /** The help projection — the Location's actions with quotes, and the glossary. */
  readonly help: HelpView;
  /** Whether the overlay is shown. While `false` it renders nothing. */
  readonly visible: boolean;
  /**
   * Signalled when the player presses `?` or Escape while the overlay is
   * visible — a request to toggle it closed. The owning screen holds the
   * visibility state and flips it. Omitted callers get a read-only overlay.
   */
  readonly onToggle?: () => void;
}

/** The cost summary for one action row: the cost when allowed, else the reason. */
function actionCost(entry: HelpActionEntry): string {
  const { allowed, reason, phases, money } = entry.quote;
  if (!allowed) {
    // Disallowed actions always surface *why* (Req 26.5 lists costs; the quote
    // carries the gate reason when the Location blocks the action).
    return reason === undefined || reason === '' ? 'unavailable' : reason;
  }
  const phaseLabel = `${phases} ${phases === 1 ? 'phase' : 'phases'}`;
  const base = money > 0 ? `${phaseLabel}, ${money}` : phaseLabel;
  // Targeted actions pick their subject at use; flag that so the cost line
  // reads as a representative base cost rather than a final one.
  return entry.targeted ? `${base} · pick target` : base;
}

/** One action row: the action kind and its cost/eligibility summary. */
function ActionRow({ entry }: { readonly entry: HelpActionEntry }): ReactElement {
  return (
    <Box>
      <Text dimColor={!entry.quote.allowed}>
        {entry.kind} — {actionCost(entry)}
      </Text>
    </Box>
  );
}

/**
 * The help overlay: a toggleable panel listing the current Location's actions
 * with their costs, plus the glossary. Hidden until `visible`; `?` or Escape
 * requests a toggle through {@link HelpOverlayProps.onToggle}.
 */
export function HelpOverlay({
  help,
  visible,
  onToggle,
}: HelpOverlayProps): ReactElement | null {
  // Listen for the toggle keys only while shown — the key that *opens* the
  // overlay is the owning screen's, so this handler never fights it to close
  // something that is not yet open.
  useInput(
    (input, key) => {
      if (input === HELP_TOGGLE_KEY || key.escape) {
        onToggle?.();
      }
    },
    { isActive: visible },
  );

  if (!visible) {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>Help — {help.location.name}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Actions here</Text>
        {help.actions.length === 0 ? (
          <Text dimColor>No actions available here.</Text>
        ) : (
          help.actions.map((entry, index) => (
            // Keyed by position: an action kind alone is not unique across the
            // list, and the entry order is stable within a projection.
            <ActionRow key={index} entry={entry} />
          ))
        )}
      </Box>
      {help.glossary.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Glossary</Text>
          {help.glossary.map((entry) => (
            <Text key={entry.term}>
              <Text bold>{entry.term}</Text>: {entry.definition}
            </Text>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>? or Esc to close</Text>
      </Box>
    </Box>
  );
}
