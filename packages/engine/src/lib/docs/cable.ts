/**
 * The Cable composer (design, "Document Generator"; Requirements 27.4, 26.1,
 * 26.4).
 *
 * A Cable is a short message between the field and HQ, written in numbered
 * paragraphs. A person named in it also carries a cryptonym. Two uses matter
 * at this task:
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
import { cryptonym } from './cryptonym.js';
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
  /**
   * The subject's cryptonym, when the cable names a person. Filled from
   * {@link fields.subject} when that value is an `npc:` id and this is omitted.
   */
  readonly cryptonym?: string;
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
 * `deadline`, `budget-line`) — the core pack's `cable-hq-directive`. The body
 * is numbered paragraphs. A subject that is an `npc:` id also prints that
 * person's cryptonym. The cable asserts the leads in `ctx.asserts`.
 */
export function composeCable(
  template: DocumentTemplate,
  fields: CableFields,
  ctx: CableContext,
): ComposedDocument {
  const namer = playerNamer(ctx);
  const asserted = ctx.asserts ?? [];

  const named =
    fields.cryptonym ?? (fields.subject.startsWith('npc:') ? cryptonym(fields.subject) : undefined);
  const instruction = asParagraph(fields.instruction);
  let next = highestParagraph(instruction) + 1;
  const deadlineNo = fields.deadline !== undefined ? String(next++) : undefined;
  const fundsNo = fields.budgetLine !== undefined ? String(next) : undefined;
  const bindings: TemplateBindings = {
    'cable-ref': fields.cableRef,
    priority: fields.priority ?? 'ROUTINE',
    date: formatDate(ctx.date),
    'to-station': fields.toStation ?? 'STATION',
    subject: fields.subject,
    instruction,
    ...(named !== undefined ? { cryptonym: named } : {}),
    ...(deadlineNo !== undefined && fields.deadline !== undefined
      ? { 'deadline-no': deadlineNo, deadline: fields.deadline }
      : {}),
    ...(fundsNo !== undefined && fields.budgetLine !== undefined
      ? { 'funds-no': fundsNo, 'budget-line': fields.budgetLine }
      : {}),
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

/** Keep an instruction that is already numbered. Otherwise make it paragraph 2. */
function asParagraph(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (/^\d+\./.test(trimmed)) {
    return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
  }
  const clean = trimmed.replace(/\.+$/, '');
  return `2. ${clean}.`;
}

/** The highest numbered paragraph already used, so the next line can follow it. */
function highestParagraph(text: string): number {
  let highest = 1;
  for (const match of text.matchAll(/(?:^|\s)(\d+)\./g)) {
    const n = Number(match[1]);
    if (n > highest) {
      highest = n;
    }
  }
  return highest;
}
