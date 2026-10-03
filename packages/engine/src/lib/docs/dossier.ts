/**
 * The Dossier composer (design, "Document Generator"; Requirement 26.1 — the
 * Starting Brief includes Dossiers).
 *
 * A Dossier is an HQ file on one entity, carrying **apparent information only**
 * (design: "apparent allegiance, cover employment, descriptor, known associates
 * and HQ false beliefs. Dossiers never contain truth fields"). It is composed
 * from the **Station's Knowledge Slice** (task 5.5): the Dossier on a subject
 * asserts the Propositions in that slice whose subject is the entity — which may
 * include HQ false beliefs, so a Dossier is a source of leads, not of truth
 * (the player must corroborate what the file says).
 *
 * The composer renders the `dossier` Document template (`dossier-hq-person` in
 * the core pack) through the player-perspective {@link playerNamer}, binding the
 * template's slots from the subject NPC's view-safe name and from the slice's
 * beliefs about the subject alone: the apparent-allegiance line from the slice's
 * `MEMBER_OF` / `WORKS_FOR` propositions (true lead or HQ false belief), an
 * associate from a `MEETS_AT` lead, a last-seen place. No field is read from the
 * NPC record, so a Dossier can neither reveal nor contradict the truth through a
 * field (Requirements 2.2, 33.4). The rendered `body` is fact-layer text;
 * `asserts` names every slice Proposition the Dossier reports, true lead or HQ
 * false belief alike.
 *
 * Determinism: the composer makes no random draws of its own (there is no
 * `{pick:…}` in the dossier template), so a Dossier is a pure function of the
 * subject, the slice and the content — stable for a given seed.
 */

import {
  type DocumentTemplate,
  type TemplateBindings,
} from '@tradecraft/content';
import {
  type EntityId,
  type LocId,
  type Proposition,
} from '../model/core.js';
import type { Npc } from '../city/npc.js';
import type { KnowledgeSlice } from '../city/knowledge.js';
import {
  docId,
  type ComposedDocument,
  type Document,
} from './document.js';
import { playerNamer, type NamerContext } from './namer.js';
import { compileSections, renderTitle } from './render.js';

/** Inputs the Dossier composer needs beyond the shared namer context. */
export interface DossierContext extends NamerContext {
  /** The Station's Knowledge Slice (the apparent information HQ holds). */
  readonly stationSlice: KnowledgeSlice;
}

/**
 * Every Proposition in the Station slice (true lead or HQ false belief) whose
 * subject is `subject`. These are exactly the apparent facts a Dossier on the
 * subject reports.
 */
export function slicePropsAbout(
  slice: KnowledgeSlice,
  subject: EntityId,
): Proposition[] {
  const about = (p: Proposition): boolean => p.subject === subject;
  return [...slice.known.filter(about), ...slice.falseBeliefs.filter(about)];
}

/**
 * The apparent-allegiance line for a Dossier, derived **only** from the Station
 * slice's beliefs about the subject — never from the NPC record (design,
 * "Document Generator", Dossier: "No field is read from the NPC record, so a
 * Dossier cannot reveal or contradict the truth through a field"; Requirements
 * 2.2, 33.4, Property 33).
 *
 * HQ records an entity's affiliation through its `MEMBER_OF` and `WORKS_FOR`
 * propositions, true lead or HQ false belief alike:
 *
 * - a `MEMBER_OF` an org names that org's apparent-allegiance category (so a
 *   subject HQ believes is in the Cell reads `cell` on file — true or wrong);
 * - a `WORKS_FOR` a cover employer names that cover employment;
 * - with neither on file, the Dossier states no affiliation (it must not invent
 *   one, so it can never state an allegiance the slice does not hold).
 *
 * The slice props are already filtered to the subject by {@link slicePropsAbout}.
 */
function apparentAllegianceLine(
  props: readonly Proposition[],
  orgs: Readonly<Record<string, { readonly allegiance: string }>>,
): string {
  for (const p of props) {
    if (p.predicate === 'MEMBER_OF' && typeof p.object === 'string') {
      const org = orgs[p.object];
      if (org !== undefined) {
        return org.allegiance;
      }
    }
  }
  for (const p of props) {
    if (
      p.predicate === 'WORKS_FOR' &&
      typeof p.object === 'object' &&
      p.object.kind === 'text'
    ) {
      return `employed by ${p.object.value}`;
    }
  }
  return 'no affiliation on file';
}

/** The first associate named by a `MEETS_AT` lead about the subject, if any. */
function associateOf(props: readonly Proposition[]): EntityId | undefined {
  for (const p of props) {
    if (p.predicate === 'MEETS_AT' && typeof p.object === 'string') {
      return p.object;
    }
  }
  return undefined;
}

/** The first place a lead about the subject names (`place`, or a loc object). */
function lastSeenPlaceOf(props: readonly Proposition[]): LocId | undefined {
  for (const p of props) {
    if (p.place !== undefined) {
      return p.place;
    }
    if (typeof p.object === 'string' && p.object.startsWith('loc:')) {
      return p.object as LocId;
    }
  }
  return undefined;
}

/**
 * Compose a Dossier on `subject` from the Station's Knowledge Slice.
 *
 * The Dossier asserts every slice Proposition about the subject (true leads and
 * HQ false beliefs both), renders the HQ-file template through the
 * player-perspective namer, and carries no `obtainableAt` — a Dossier is
 * delivered with the Starting Brief, not obtained at a Location.
 */
export function composeDossier(
  template: DocumentTemplate,
  subject: Npc,
  ctx: DossierContext,
): ComposedDocument {
  const asserted = slicePropsAbout(ctx.stationSlice, subject.id);
  const associate = associateOf(asserted);
  const place = lastSeenPlaceOf(asserted);
  const allegiance = apparentAllegianceLine(asserted, ctx.orgs);
  const namer = playerNamer(ctx);

  const local = subject.id.slice(subject.id.indexOf(':') + 1);
  const fileRef = `S-${local.toUpperCase()}`;

  // The template declares these slots; optional ones are omitted (left unbound)
  // when there is no apparent fact to fill them, so their `{?slot}` sections do
  // not render.
  // `subject`, `file-ref`, `allegiance-apparent`, `source-grade`, `assessment`,
  // `last-seen-place` and `last-seen-date` are *required* slots in the dossier
  // template, so each is always bound (a neutral placeholder when a lead carries
  // no fact). `allegiance-apparent` is derived *only* from the Station slice's
  // beliefs about the subject — never from the NPC record — so a Dossier can
  // neither reveal nor contradict the truth through a field, and never states an
  // allegiance the slice does not hold (Property 33). `alias` and `association`
  // are optional `{?slot}` sections, bound only when there is a fact to fill them.
  const bindings: TemplateBindings = {
    subject: subject.id,
    'file-ref': fileRef,
    'allegiance-apparent': allegiance,
    'source-grade': 'C3',
    assessment:
      'leads on file are to be worked and corroborated before any action',
    'last-seen-place': place ?? 'no fixed location recorded',
    'last-seen-date': 'a recent date',
    ...(associate !== undefined ? { association: associate } : {}),
  };

  const body = compileSections(template, bindings, namer);
  const title = renderTitle(template, bindings, namer);

  const document: Document = {
    id: docId('dossier', local),
    kind: 'dossier',
    title,
    date: { day: 0, phase: 0 },
    body,
    asserts: asserted.map((p) => p.id),
  };

  return { document, propositions: asserted };
}
