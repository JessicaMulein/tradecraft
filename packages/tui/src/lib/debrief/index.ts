/**
 * The Debrief slice of the TUI (task 22.11): the Ink Debrief screen that renders
 * the facade's `views.debrief()` {@link DebriefView} section by section — the
 * outcome summary, true allegiances, the Plot timeline, the Claims that were
 * lies, the noise leads, the fed Propositions, the Directive results and the
 * score — paged with up/down, with a placeholder while the game is still in
 * progress; plus the pure section-paging reducer behind it (design, Debrief
 * screen; Requirements 13.8, 19.6).
 */

export {
  Debrief,
  type DebriefProps,
} from './debrief.js';

export {
  DEBRIEF_SECTION_IDS,
  DEBRIEF_SECTION_COUNT,
  DEBRIEF_SECTION_TITLES,
  initialDebriefSectionsState,
  reduceDebriefSections,
  currentSectionId,
  currentSectionTitle,
  sectionItemCount,
  type DebriefSectionId,
  type DebriefAction,
  type DebriefSectionsState,
} from './debrief-sections.js';
