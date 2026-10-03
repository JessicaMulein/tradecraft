/**
 * The Case File browser (design, "TUI": "Case File: filterable by entity, source
 * (npc, intercept, surveillance, document) and grade, with grade and link
 * editing"; Requirements 8.1, 13.3).
 *
 * The browser lists the Case File's Claims — each with its source, a readable
 * rendering of its Proposition, its hedge flag, the player's Admiralty Grade and
 * its corroboration relation — and lets the player narrow the list by entity,
 * source kind and grade, assign an Admiralty Grade to the selected Claim, and
 * link or unlink two Claims.
 *
 * ## Presentational, with the Claims and actions threaded in
 *
 * The browser never reaches the facade. It renders the `claims` prop — the
 * *already filtered* `ClaimView[]` the owning screen got from
 * `caseFile.list(filter)` — and signals its edits through callbacks:
 * `onGrade(id, grade)`, `onLink(a, b)`, `onUnlink(a, b)` map straight onto the
 * facade's `caseFile.grade/link/unlink`, and `onFilter(filter)` hands the screen
 * the new {@link CaseFileFilter} to re-list with. The owning screen owns the one
 * place that calls the facade, so the browser is unit-testable without a live
 * engine, and a later screen task wires these callbacks to `EngineApi.caseFile`.
 *
 * ## Boundary
 *
 * The browser reads only `@tradecraft/player-view` types (Req 13.5): the
 * view-safe {@link ClaimView} and {@link CaseFileFilter}. The Admiralty Grade
 * shape is mirrored in the reducer module, not reached from the engine.
 *
 * ## Keys
 *
 * - Up/Down move the Claim cursor.
 * - Tab/Shift+Tab move the filter axis; Left/Right cycle the focused axis's
 *   value (source kind, grade or entity); `x` clears all filters.
 * - `r`/`R` and `c`/`C` adjust the grade cursor's reliability and credibility;
 *   `g` assigns the composed grade to the selected Claim (`onGrade`).
 * - `l` marks the selected Claim as a link anchor, then links it to the next
 *   selected Claim (`onLink`); `u` unlinks the anchor from the selected Claim
 *   (`onUnlink`); `Esc` clears a held anchor.
 */

import { useReducer, type ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CaseFileFilter, ClaimView } from '@tradecraft/player-view';

import {
  formatGrade,
  initialCaseFileState,
  reduceCaseFile,
  type AdmiraltyGrade,
  type ClaimId,
  type EntityId,
} from './case-file.js';

/** Props for {@link CaseFileBrowser}. */
export interface CaseFileBrowserProps {
  /**
   * The Claims to show, already filtered by the owning screen through
   * `caseFile.list(filter)`. Rendered in the order given (the Case File's own
   * observation-time order).
   */
  readonly claims: readonly ClaimView[];
  /**
   * The entities the entity filter can cycle through (those present in the Case
   * File). The owning screen supplies them so the browser need not reach the
   * facade. Empty when there are none.
   */
  readonly entities?: readonly EntityId[];
  /** A starting filter, if the browser is opened pre-filtered. */
  readonly initialFilter?: CaseFileFilter;
  /** Signalled with the new filter whenever the player changes a filter axis. */
  readonly onFilter?: (filter: CaseFileFilter) => void;
  /** Signalled to assign an Admiralty Grade to a Claim (`caseFile.grade`). */
  readonly onGrade?: (id: ClaimId, grade: AdmiraltyGrade) => void;
  /** Signalled to link two Claims (`caseFile.link`). */
  readonly onLink?: (a: ClaimId, b: ClaimId) => void;
  /** Signalled to unlink two Claims (`caseFile.unlink`). */
  readonly onUnlink?: (a: ClaimId, b: ClaimId) => void;
}

/** The player-facing label for a Claim's source, naming the originating thing. */
function sourceLabel(source: ClaimView['source']): string {
  switch (source.kind) {
    case 'npc':
      return `npc ${source.npc}`;
    case 'intercept':
      return `intercept ${source.id}`;
    case 'surveillance':
      return `surveillance ${source.loc}`;
    case 'document':
      return `document ${source.id}`;
    default:
      return 'unknown';
  }
}

/** Render a Proposition's object (an entity id or a literal) readably. */
function objectLabel(object: ClaimView['prop']['object']): string {
  if (typeof object === 'string') {
    return object;
  }
  switch (object.kind) {
    case 'amount':
      return String(object.value);
    case 'time':
      return `day ${object.value.day} phase ${object.value.phase}`;
    case 'text':
    default:
      return object.value;
  }
}

/**
 * Render a Claim's Proposition as a readable `subject predicate object` line,
 * with the place appended when the Proposition carries one.
 */
function propLabel(prop: ClaimView['prop']): string {
  const base = `${prop.subject} ${prop.predicate} ${objectLabel(prop.object)}`;
  return prop.place === undefined ? base : `${base} @ ${prop.place}`;
}

/** The relation marker shown beside a Claim. */
function relationLabel(relation: ClaimView['relation']): string {
  switch (relation) {
    case 'corroborated':
      return 'corroborated';
    case 'conflicted':
      return 'conflicted';
    case 'none':
    default:
      return '—';
  }
}

/** One Claim row: cursor marker, anchor marker, source, prop, flags and grade. */
function ClaimRow({
  claim,
  focused,
  anchored,
}: {
  readonly claim: ClaimView;
  readonly focused: boolean;
  readonly anchored: boolean;
}): ReactElement {
  const grade = claim.grade === undefined ? 'ungraded' : formatGrade(claim.grade);
  const hedge = claim.hedged ? ' (hedged)' : '';
  const anchor = anchored ? '* ' : '  ';
  return (
    <Box>
      <Text color={focused ? 'cyan' : undefined}>
        {focused ? '> ' : '  '}
        {anchor}
        {sourceLabel(claim.source)} · {propLabel(claim.prop)}
        {hedge} · grade {grade} · {relationLabel(claim.relation)}
      </Text>
    </Box>
  );
}

/** The active-filter summary line. */
function filterSummary(filter: CaseFileFilter): string {
  const parts: string[] = [];
  parts.push(`source=${filter.source ?? 'all'}`);
  parts.push(`grade=${filter.grade === undefined ? 'all' : formatGrade(filter.grade)}`);
  parts.push(`entity=${filter.entity ?? 'all'}`);
  return parts.join(' · ');
}

/**
 * The Case File browser. Renders the supplied Claims and the filter/grade
 * controls, and drives the pure {@link reduceCaseFile} reducer from key presses,
 * calling the edit callbacks as the player grades, links and re-filters.
 */
export function CaseFileBrowser({
  claims,
  entities = [],
  initialFilter,
  onFilter,
  onGrade,
  onLink,
  onUnlink,
}: CaseFileBrowserProps): ReactElement {
  const [state, dispatch] = useReducer(
    reduceCaseFile,
    { count: claims.length, filter: initialFilter },
    initialCaseFileState,
  );

  // Keep the reducer's clamp bound to the current shown count.
  if (state.count !== claims.length) {
    dispatch({ type: 'set-count', count: claims.length });
  }

  const selected = claims[state.cursor];

  /** Cycle a filter axis and signal the resulting filter to the screen. */
  const cycleFilter = (step: 1 | -1): void => {
    const action =
      step === 1
        ? ({ type: 'filter-next', entities } as const)
        : ({ type: 'filter-prev', entities } as const);
    const next = reduceCaseFile(state, action);
    dispatch(action);
    onFilter?.(next.filter);
  };

  useInput((input, key) => {
    if (key.downArrow) {
      dispatch({ type: 'cursor-next' });
      return;
    }
    if (key.upArrow) {
      dispatch({ type: 'cursor-prev' });
      return;
    }
    if (key.tab) {
      dispatch({ type: key.shift ? 'axis-prev' : 'axis-next' });
      return;
    }
    if (key.rightArrow) {
      cycleFilter(1);
      return;
    }
    if (key.leftArrow) {
      cycleFilter(-1);
      return;
    }
    if (key.escape) {
      dispatch({ type: 'link-clear' });
      return;
    }
    switch (input) {
      case 'x': {
        dispatch({ type: 'filter-clear' });
        onFilter?.({});
        return;
      }
      case 'r':
        dispatch({ type: 'grade-reliability', step: 1 });
        return;
      case 'R':
        dispatch({ type: 'grade-reliability', step: -1 });
        return;
      case 'c':
        dispatch({ type: 'grade-credibility', step: 1 });
        return;
      case 'C':
        dispatch({ type: 'grade-credibility', step: -1 });
        return;
      case 'g': {
        if (selected !== undefined) {
          onGrade?.(selected.id, state.grade);
        }
        return;
      }
      case 'l': {
        if (selected === undefined) {
          return;
        }
        if (state.linkAnchor === undefined) {
          dispatch({ type: 'link-anchor', id: selected.id });
        } else {
          onLink?.(state.linkAnchor, selected.id);
          dispatch({ type: 'link-clear' });
        }
        return;
      }
      case 'u': {
        if (selected !== undefined && state.linkAnchor !== undefined) {
          onUnlink?.(state.linkAnchor, selected.id);
          dispatch({ type: 'link-clear' });
        }
        return;
      }
      default:
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Case File</Text>
      <Box marginTop={1}>
        <Text dimColor>
          Filter [{state.axis}]: {filterSummary(state.filter)}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {claims.length === 0 ? (
          <Text dimColor>No Claims match the filter.</Text>
        ) : (
          claims.map((claim, index) => (
            <ClaimRow
              key={claim.id}
              claim={claim}
              focused={index === state.cursor}
              anchored={claim.id === state.linkAnchor}
            />
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Grade cursor: {formatGrade(state.grade)}
          {state.linkAnchor === undefined
            ? ''
            : ` · link anchor: ${state.linkAnchor}`}
        </Text>
      </Box>
      <Box>
        <Text dimColor>
          ↑/↓ select · Tab axis · ←/→ filter · x clear · r/c grade · g apply ·
          l link · u unlink
        </Text>
      </Box>
    </Box>
  );
}
