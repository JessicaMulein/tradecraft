/**
 * The Debrief screen — the TUI's end-of-game reckoning (design, "Arrests, end
 * conditions, the debrief and the Outcome Record" → the Debrief screen;
 * Requirements 13.8, 19.6). Task 22.11.
 *
 * When the game ends, the Player View lifts the fence that keeps ground truth
 * out of the client (Req 2.2) and lays out the final reckoning. This screen
 * renders the facade's `views.debrief()` — a {@link DebriefView} — one section
 * at a time: the outcome summary, every NPC's true allegiance versus the one
 * they presented, the actual Plot timeline, the Case File Claims that were lies,
 * the leads that turned out to be noise, the Propositions the player fed, the
 * Directive results, and the score and grading accuracy (Req 19.6). The player
 * pages through the sections with up/down; a header shows the current section,
 * its position in the set, and its item count.
 *
 * ## Presentational + pure reducer
 *
 * The section paging (which section is on screen and how up/down moves between
 * them) is the pure reducer in `./debrief-sections.ts`, unit-tested without a
 * TTY. This component holds that state with {@link useReducer}, renders the
 * current section against the {@link DebriefView}, and maps each keypress to one
 * {@link DebriefAction}.
 *
 * ## The not-ended case
 *
 * `views.debrief()` returns `null` until the game has ended, so this screen
 * accepts `view: DebriefView | null` and renders a quiet placeholder when it is
 * `null` — the debrief is only available once the operation is over.
 *
 * ## Boundary
 *
 * The screen reads only `@tradecraft/player-view` types (Req 13.5): the
 * view-safe {@link DebriefView} and its section shapes, all re-exported through
 * the facade. The engine `GameTime` and `Outcome` are not re-exported, so the
 * day/phase and the outcome tag are rendered structurally by small local
 * helpers rather than imported.
 */

import { useReducer, type ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';
import type {
  DebriefAllegiance,
  DebriefDirectiveResult,
  DebriefFedProposition,
  DebriefLead,
  DebriefLie,
  DebriefTimelineEntry,
  DebriefScore,
  DebriefView,
} from '@tradecraft/player-view';

import {
  DEBRIEF_SECTION_COUNT,
  currentSectionId,
  currentSectionTitle,
  initialDebriefSectionsState,
  reduceDebriefSections,
  sectionItemCount,
  type DebriefSectionId,
} from './debrief-sections.js';

/** Props for {@link Debrief}. */
export interface DebriefProps {
  /**
   * The end-of-game debrief from `views.debrief()`, or `null` when the game has
   * not ended yet (the debrief is unavailable until then).
   */
  readonly view: DebriefView | null;
}

// ---------------------------------------------------------------------------
// Local view-safe formatting (GameTime / Outcome are not re-exported; Req 13.5)
// ---------------------------------------------------------------------------

/** The four phase names in ordinal order, mirroring the engine's `PHASE_NAMES`. */
const PHASE_NAMES = ['morning', 'afternoon', 'evening', 'night'] as const;

/** A game-time shape the screen renders: a day and a phase ordinal. */
interface TimeLike {
  readonly day: number;
  readonly phase: number;
}

/** Render a {@link TimeLike} as the plain `Day N, <phase>` form the player reads. */
function formatTime(time: TimeLike): string {
  const phase = PHASE_NAMES[time.phase] ?? `phase ${time.phase}`;
  return `Day ${time.day}, ${phase}`;
}

/** A readable rendering of the outcome tag (`burned` -> `Burned`). */
function formatOutcome(outcome: string): string {
  if (outcome === '') {
    return 'Unknown';
  }
  return outcome.charAt(0).toUpperCase() + outcome.slice(1);
}

/** Format a `[0, 1]` accuracy as a whole-number percentage. */
function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

// ---------------------------------------------------------------------------
// Section bodies
// ---------------------------------------------------------------------------

/** The outcome summary: the final tag, when it ended, and the cause. */
function OutcomeSection({ view }: { readonly view: DebriefView }): ReactElement {
  return (
    <Box flexDirection="column">
      <Text>
        Outcome: <Text bold>{formatOutcome(view.outcome)}</Text>
      </Text>
      <Text>Ended: {formatTime(view.endedAt)}</Text>
      <Text>Cause: {view.cause === '' ? '(none recorded)' : view.cause}</Text>
    </Box>
  );
}

/** The true-allegiances section: each NPC's real org versus the one presented. */
function AllegiancesSection({
  rows,
}: {
  readonly rows: readonly DebriefAllegiance[];
}): ReactElement {
  if (rows.length === 0) {
    return <Text dimColor>No persons to reckon.</Text>;
  }
  return (
    <Box flexDirection="column">
      {rows.map((a) => {
        const trueOrg = a.trueOrgName ?? a.trueOrg ?? 'unaligned';
        return (
          <Text key={a.npc} color={a.deceptive ? 'red' : undefined}>
            {a.name} ({a.role}) — presented {a.apparent}, truly {trueOrg}
            {a.deceptive ? ' — DECEPTIVE' : ''}
          </Text>
        );
      })}
    </Box>
  );
}

/** The actual Plot timeline, stage by stage, with status and deadline. */
function TimelineSection({
  rows,
}: {
  readonly rows: readonly DebriefTimelineEntry[];
}): ReactElement {
  if (rows.length === 0) {
    return <Text dimColor>The Plot never advanced.</Text>;
  }
  return (
    <Box flexDirection="column">
      {rows.map((s) => (
        <Box key={s.stage} flexDirection="column" marginBottom={1}>
          <Text>
            {s.templateId} [{s.status}] — due {formatTime(s.deadline)}
          </Text>
          {s.traces.map((trace, i) => (
            <Text key={`${s.stage}-${i}`} dimColor>
              {'  '}
              {trace}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  );
}

/** The Claims that were lies, deliberate ones marked. */
function LiesSection({
  rows,
}: {
  readonly rows: readonly DebriefLie[];
}): ReactElement {
  if (rows.length === 0) {
    return <Text dimColor>No Claim in your file was a lie.</Text>;
  }
  return (
    <Box flexDirection="column">
      {rows.map((lie) => (
        <Text key={lie.claim} color={lie.deliberate ? 'red' : 'yellow'}>
          {lie.text} — {lie.deliberate ? 'deliberate lie' : 'honest error'}
        </Text>
      ))}
    </Box>
  );
}

/** The leads that were Side Threads or Rumours — noise, not signal. */
function NoiseLeadsSection({
  rows,
}: {
  readonly rows: readonly DebriefLead[];
}): ReactElement {
  if (rows.length === 0) {
    return <Text dimColor>Every lead you chased was signal.</Text>;
  }
  return (
    <Box flexDirection="column">
      {rows.map((lead) => {
        const source =
          lead.kind === 'side-thread'
            ? `side thread${lead.thread !== undefined ? ` (${lead.thread})` : ''}${lead.emergent ? ', emergent' : ''}`
            : 'rumour';
        return (
          <Text key={lead.claim} dimColor>
            {lead.text} — {source}
          </Text>
        );
      })}
    </Box>
  );
}

/** The Propositions the player fed, each tagged chickenfeed or deception. */
function FedPropositionsSection({
  rows,
}: {
  readonly rows: readonly DebriefFedProposition[];
}): ReactElement {
  if (rows.length === 0) {
    return <Text dimColor>You fed no one.</Text>;
  }
  return (
    <Box flexDirection="column">
      {rows.map((fed, i) => (
        <Text
          key={`${fed.agent}-${i}`}
          color={fed.classification === 'deception' ? 'green' : 'yellow'}
        >
          via {fed.agent}: {fed.text} — {fed.classification}
        </Text>
      ))}
    </Box>
  );
}

/** The Directive results, met / failed / open with the Standing lever. */
function DirectivesSection({
  rows,
}: {
  readonly rows: readonly DebriefDirectiveResult[];
}): ReactElement {
  if (rows.length === 0) {
    return <Text dimColor>No Directives were issued.</Text>;
  }
  const color = (status: DebriefDirectiveResult['status']): string =>
    status === 'met' ? 'green' : status === 'failed' ? 'red' : 'yellow';
  const sign = (reward: number): string => (reward >= 0 ? `+${reward}` : `${reward}`);
  return (
    <Box flexDirection="column">
      {rows.map((d) => (
        <Text key={d.id} color={color(d.status)}>
          {d.text} — {d.status} (standing {sign(d.reward)})
        </Text>
      ))}
    </Box>
  );
}

/** The score and the player's grading accuracy. */
function ScoreSection({ score }: { readonly score: DebriefScore }): ReactElement {
  return (
    <Box flexDirection="column">
      <Text>
        Final Standing: <Text bold>{score.standing}</Text>
      </Text>
      <Text>
        Claims: {score.claimsTrue}/{score.claimsTotal} held in truth
      </Text>
      <Text>
        Graded correctly: {score.gradedCorrect}/{score.gradedTotal}
      </Text>
      <Text>
        Grading accuracy: <Text bold>{formatPercent(score.gradingAccuracy)}</Text>
      </Text>
    </Box>
  );
}

function CityCaseSection({ view }: { readonly view: DebriefView }): ReactElement | null {
  const hooks = view.city?.hooks ?? [];
  if (hooks.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>The city and the case</Text>
      {hooks.map((hook) => (
        <Text key={`${hook.kind}:${hook.day}:${hook.detail}`}>
          Day {hook.day}: {hook.kind}
          {hook.detail.length > 0 ? ` — ${hook.detail}` : ''}
        </Text>
      ))}
    </Box>
  );
}

function EmergentThreadsSection({ view }: { readonly view: DebriefView }): ReactElement | null {
  const threads = view.city?.emergentThreads ?? [];
  if (threads.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>The city and the case</Text>
      {threads.map((thread) => (
        <Text key={thread.id}>Emergent thread {thread.id}</Text>
      ))}
    </Box>
  );
}

function PlotsSection({ view }: { readonly view: DebriefView }): ReactElement {
  const plots = view.plots ?? [];
  if (plots.length === 0) {
    return <Text dimColor>No library plots.</Text>;
  }
  return (
    <Box flexDirection="column">
      {plots.map((plot) => (
        <Text key={plot.displayName}>
          {plot.displayName} ({plot.role}, {plot.archetype}) — {plot.result}
          {plot.twist === undefined ? '' : `; twist ${plot.twist.kind}`}
        </Text>
      ))}
      {plots.flatMap((plot) =>
        plot.cells.map((cell) => (
          <Text key={`${plot.displayName}:${cell.name}`}>
            Cell {cell.name}: {cell.members.join(', ')}
            {cell.cutouts.length === 0 ? '' : `; cutouts ${cell.cutouts.join(', ')}`}
          </Text>
        )),
      )}
      {(view.lookalikes ?? []).map((thread) => (
        <Text key={thread.id}>
          Lookalike {thread.id}
          {thread.mimics === undefined ? '' : ` mimics ${thread.mimics}`}
        </Text>
      ))}
    </Box>
  );
}

/** Render the body of the section identified by `id`. */
function SectionBody({
  id,
  view,
}: {
  readonly id: DebriefSectionId;
  readonly view: DebriefView;
}): ReactElement {
  switch (id) {
    case 'outcome':
      return <OutcomeSection view={view} />;
    case 'allegiances':
      return <AllegiancesSection rows={view.allegiances} />;
    case 'timeline':
      return (
        <Box flexDirection="column">
          <TimelineSection rows={view.timeline} />
          {(view.plots?.length ?? 0) > 0 ? <PlotsSection view={view} /> : null}
          <CityCaseSection view={view} />
        </Box>
      );
    case 'lies':
      return <LiesSection rows={view.lies} />;
    case 'noise-leads':
      return (
        <Box flexDirection="column">
          <NoiseLeadsSection rows={view.noiseLeads} />
          <EmergentThreadsSection view={view} />
        </Box>
      );
    case 'fed-propositions':
      return <FedPropositionsSection rows={view.fedPropositions} />;
    case 'directives':
      return <DirectivesSection rows={view.directives} />;
    case 'score':
      return <ScoreSection score={view.score} />;
    default:
      return <Text dimColor>Nothing to show.</Text>;
  }
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/** The placeholder shown while the game is still in progress (view is null). */
function DebriefPlaceholder(): ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Debrief</Text>
      <Text dimColor>
        The debrief is available once the operation is over.
      </Text>
    </Box>
  );
}

/**
 * The Debrief screen: renders the end-of-game {@link DebriefView} one section at
 * a time, paged with up/down. Holds the paging state with the pure reducer in
 * `./debrief-sections.ts`. When `view` is `null` (the game has not ended), it
 * renders a quiet placeholder instead.
 */
export function Debrief({ view }: DebriefProps): ReactElement {
  if (view === null) {
    return <DebriefPlaceholder />;
  }
  return <DebriefScreen view={view} />;
}

/** The screen body for a present {@link DebriefView} (holds the paging state). */
function DebriefScreen({ view }: { readonly view: DebriefView }): ReactElement {
  const [state, dispatch] = useReducer(
    reduceDebriefSections,
    initialDebriefSectionsState(view),
  );

  useInput((_input, key) => {
    if (key.upArrow) {
      dispatch({ type: 'prev-section' });
      return;
    }
    if (key.downArrow) {
      dispatch({ type: 'next-section' });
      return;
    }
    if (key.pageUp) {
      dispatch({ type: 'first-section' });
      return;
    }
    if (key.pageDown) {
      dispatch({ type: 'last-section' });
    }
  });

  const id = currentSectionId(state);
  const title = currentSectionTitle(state);
  const count = sectionItemCount(view, id);
  const position = state.section + 1;
  // The outcome and score sections are single summaries; a count badge only
  // helps on the list sections, so show it only there.
  const badge =
    id === 'outcome' || id === 'score'
      ? ''
      : ` · ${count} ${count === 1 ? 'item' : 'items'}`;

  return (
    <Box flexDirection="column">
      <Text bold>
        Debrief — {title} ({position}/{DEBRIEF_SECTION_COUNT})
        {badge}
      </Text>
      <Box marginTop={1}>
        <SectionBody id={id} view={view} />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ section · PgUp/PgDn first/last</Text>
      </Box>
    </Box>
  );
}
