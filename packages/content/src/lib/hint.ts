/**
 * Hints.
 *
 * A hint is a one-off piece of guidance the UI shows the first time a given
 * situation occurs, and only when hints are enabled (Requirement 26.6). The
 * trigger comes from a fixed enum so the view can match a hint to a situation
 * without interpreting free text, and hints never touch Sim state.
 */

import { z } from 'zod';
import { ContentIdSchema, TemplateStringSchema } from './common.js';

/**
 * The closed set of situations a hint may fire on. Keeping this an enum (rather
 * than an open string) means the view raises each trigger from a known event
 * and the loader can reject a hint whose trigger it does not recognise.
 */
export const HINT_TRIGGERS = [
  'first-unidentified-subject',
  'first-intercept',
  'first-dead-drop',
  'first-meeting',
  'first-recruitment',
  'first-document',
  'budget-low',
  'standing-low',
  'cover-suspicion-high',
  'directive-near-deadline',
  'plot-deadline-near',
  'first-arrest-available',
] as const;
export const HintTriggerSchema = z.enum(HINT_TRIGGERS);
export type HintTrigger = z.infer<typeof HintTriggerSchema>;

/** A hint: its trigger and the template text shown when the trigger first fires. */
export const HintSchema = z
  .object({
    id: ContentIdSchema,
    trigger: HintTriggerSchema,
    text: TemplateStringSchema,
  })
  .strict();
export type Hint = z.infer<typeof HintSchema>;

/** A `hints.yaml` file is a list of hints. */
export const HintFileSchema = z.array(HintSchema);
