/**
 * The Cable composer (design, "Document Generator"; Requirements 27.4, 26.1,
 * 26.4).
 *
 * A Cable is a short message between the field and HQ, written in **period
 * telegraphic style**: upper-case, clipped, with `STOP` as the separator the
 * core pack's `cable` templates spell out (design: "Cable. Brief, Directives,
 * replies, Standing changes"). Two uses matter at this task:
 *
 * - The **Starting Brief is delivered as a brief Cable** (Requirement 26.1,
 *   26.4): an HQ directive naming the operation, the player's instruction and
 *   the leads HQ hands down. The brief Cable asserts those leads as Propositions
 *   (`asserts`), so reading the brief seeds the Case File (task 9.2) with the
 *   Station's starting knowledge.
 * - **Cable requests and replies** (Requirement 27.4): trace/funds/report
 *   requests to HQ and their replies, which task 10.2 mints on top of this
 *   composer.
 *
 * The composer renders a `cable` Document template through the player-perspective
 * {@link playerNamer} and returns the Cable plus the Propositions it asserts.
 * The rendered `body` is fact-layer text; a Cable carries no `obtainableAt` (it
 * is delivered, not obtained at a Location).
 *
 * Determinism: no random draws of the composer's own (the cable templates make
 * no `{pick:…}`), so a Cable is a pure function of its bindings, the asserted
 * leads and the content.
 */

import {
  type DocumentTemplate,
  type TemplateBindings,
} from '@tradecraft/content';
import { type GameTime, type Proposition } from '../model/core.js';
import {
  docId,
  type ComposedDocument,
  type Document,
} from './document.js';
import { playerNamer, formatDate, type NamerContext } from './namer.js';
import { compileSections, renderTitle } from './render.js';

/** The slots a composer may fill on an HQ directive Cable. */
export interface CableFields {
  /** The cable reference printed in the header (e.g. `HQ-0001`). */
  readonly cableRef: string;
  /** The priority word (e.g. `IMMEDIATE`, `ROUTINE`). */
  readonly priority?: string;
  /** The receiving station's cover designation. */
  readonly toStation?: string;
  /** The subject line (what the cable is about). */
  readonly subject: string;
  /** The instruction body (telegraphic prose). */
  readonly instruction: string;
  /** An optional deadline string. */
  readonly deadline?: string;
  /** An optional funds/budget line. */
  readonly budgetLine?: string;
}

/** Inputs the Cable composer needs. */
export interface CableContext extends NamerContext {
  /** The game time the Cable is dated. */
  readonly date: GameTime;
  /**
   * Propositions the Cable asserts (the leads delivered with the brief). The
   * read action (task 9.2) turns each into a Case File Claim. Defaults to none
   * for a Cable that carries only an instruction.
   */
  readonly asserts?: readonly Proposition[];
}

/**
 * Compose an HQ directive Cable from a `cable` Document template.
 *
 * `template` must be a `cable`-kind template that declares the directive slots
 * (`cable-ref`, `priority`, `date`, `to-station`, `subject`, `instruction`,
 * `deadline`, `budget-line`) — the core pack's `cable-hq-directive`. The Cable
 * is rendered telegraphic (the template supplies the `STOP` separators) and
 * asserts the leads in `ctx.asserts`.
 */
export function composeCable(
  template: DocumentTemplate,
  fields: CableFields,
  ctx: CableContext,
): ComposedDocument {
  const namer = playerNamer(ctx);
  const asserted = ctx.asserts ?? [];

  const bindings: TemplateBindings = {
    'cable-ref': fields.cableRef,
    priority: fields.priority ?? 'ROUTINE',
    date: formatDate(ctx.date),
    'to-station': fields.toStation ?? 'STATION',
    subject: fields.subject,
    instruction: fields.instruction,
    ...(fields.deadline !== undefined ? { deadline: fields.deadline } : {}),
    ...(fields.budgetLine !== undefined ? { 'budget-line': fields.budgetLine } : {}),
  };

  const body = compileSections(template, bindings, namer);
  const title = renderTitle(template, bindings, namer);

  const document: Document = {
    id: docId('cable', fields.cableRef),
    kind: 'cable',
    title,
    date: ctx.date,
    body,
    asserts: asserted.map((p) => p.id),
  };

  return { document, propositions: asserted };
}
