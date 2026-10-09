/**
 * Parameter templates (design, "Action References"; Requirement 7.2).
 *
 * An Offered Action that needs free input from the player is a *template*: the
 * catalogue lists it with a placeholder (an empty plaintext, a zero amount, an
 * empty report body, an empty list of items to leave). The client sends the
 * Action Reference plus the completing parameters, validated here, and
 * `complete` merges them into the offered Action. It can change only the fields
 * the template declares, never the kind.
 *
 * The table is typed against the Action union: every kind must have an entry
 * (a template or `null`), so a new kind added to the union fails to typecheck
 * here until someone decides whether it takes parameters.
 */

import { z } from 'zod';
import type { ActionOption } from '@tradecraft/player-view';

export type Action = ActionOption['action'];
type ActionOf<K extends Action['kind']> = Extract<Action, { kind: K }>;

export interface TemplateField {
  readonly name: string;
  readonly label: string;
  readonly type: 'text' | 'textarea' | 'integer' | 'item-list';
  readonly required: boolean;
  readonly min?: number;
  readonly max?: number;
}

export interface TemplateSpec {
  readonly fields: readonly TemplateField[];
}

interface TemplateDef<A extends Action> {
  /** Whether this Offered Action is a template at all (a trace cable is not). */
  readonly applies: (a: A) => boolean;
  readonly spec: TemplateSpec;
  readonly schema: z.ZodType<Record<string, unknown>>;
  readonly complete: (a: A, params: Record<string, unknown>) => Action;
}

type TemplateTable = { [K in Action['kind']]: TemplateDef<ActionOf<K>> | null };

const text = (max: number) => z.string().min(1).max(max);
const itemList = z
  .array(z.strictObject({ item: z.string().min(1).max(200) }))
  .max(20);

function def<A extends Action>(d: TemplateDef<A>): TemplateDef<A> {
  return d;
}

export const TEMPLATES: TemplateTable = {
  talk: null,
  approach: null,
  travel: null,
  'arrange-meeting': null,
  surveil: null,
  follow: null,
  'service-drop': def<ActionOf<'service-drop'>>({
    applies: () => true,
    spec: {
      fields: [{ name: 'items', label: 'Items to leave', type: 'item-list', required: false, max: 20 }],
    },
    schema: z.strictObject({ items: itemList }),
    complete: (a, p) => ({ ...a, leave: (p['items'] as { item: string }[]) as never }),
  }),
  intercept: null,
  decrypt: def<ActionOf<'decrypt'>>({
    applies: (a) => a.submission.kind === 'plaintext',
    spec: {
      fields: [{ name: 'text', label: 'Your reading of the message', type: 'textarea', required: true, max: 4000 }],
    },
    schema: z.strictObject({ text: text(4000) }),
    complete: (a, p) => ({ ...a, submission: { kind: 'plaintext', text: p['text'] as string } }),
  }),
  read: null,
  cable: def<ActionOf<'cable'>>({
    applies: (a) => a.body.kind === 'report',
    spec: {
      fields: [{ name: 'body', label: 'Report', type: 'textarea', required: true, max: 2000 }],
    },
    schema: z.strictObject({ body: text(2000) }),
    complete: (a, p) => ({ ...a, body: { kind: 'report', body: p['body'] as string } }),
  }),
  task: def<ActionOf<'task'>>({
    applies: (a) => a.task.kind === 'service',
    spec: {
      fields: [{ name: 'items', label: 'Items to leave', type: 'item-list', required: false, max: 20 }],
    },
    schema: z.strictObject({ items: itemList }),
    complete: (a, p) =>
      a.task.kind === 'service'
        ? { ...a, task: { ...a.task, leave: (p['items'] as { item: string }[]) as never } }
        : a,
  }),
  pay: def<ActionOf<'pay'>>({
    applies: () => true,
    spec: {
      fields: [{ name: 'amount', label: 'Amount', type: 'integer', required: true, min: 1, max: 1_000_000 }],
    },
    schema: z.strictObject({ amount: z.number().int().min(1).max(1_000_000) }),
    complete: (a, p) => ({ ...a, amount: p['amount'] as number }),
  }),
  confront: def<ActionOf<'confront'>>({
    applies: () => true,
    spec: {
      fields: [{ name: 'claim', label: 'Claim', type: 'text', required: true, max: 200 }],
    },
    schema: z.strictObject({ claim: text(200) }),
    complete: (a, p) => ({ ...a, claim: p['claim'] as string }),
  }),
  arrest: null,
  'turn-agent': def<ActionOf<'turn-agent'>>({
    applies: () => true,
    spec: {
      fields: [{ name: 'offer', label: 'Offer', type: 'integer', required: false, min: 0, max: 1_000_000 }],
    },
    schema: z.strictObject({ offer: z.number().int().min(0).max(1_000_000).optional() }),
    complete: (a, p) => {
      const offer = p['offer'] as number | undefined;
      return offer === undefined ? a : { ...a, offer };
    },
  }),
  feed: def<ActionOf<'feed'>>({
    applies: () => true,
    spec: {
      fields: [{ name: 'claims', label: 'Claims to pass on', type: 'item-list', required: true, max: 20 }],
    },
    schema: z.strictObject({
      claims: z.array(z.strictObject({ claim: z.string().min(1).max(200) })).min(1).max(20),
    }),
    complete: (a, p) => ({
      ...a,
      items: (p['claims'] as { claim: string }[]).map((c) => ({ from: 'claim' as const, claim: c.claim })),
    }),
  }),
  wait: null,
  'attend-duty': null,
  depart: null,
  'request-papers': null,
  'apply-visa': null,
  'liaison-request': null,
  'liaison-share': null,
  exfiltrate: null,
};

/** The template an Offered Action carries, or undefined when it needs no input. */
export function templateFor(action: Action): { spec: TemplateSpec; def: TemplateDef<Action> } | undefined {
  const entry = TEMPLATES[action.kind] as TemplateDef<Action> | null;
  if (entry === null || !entry.applies(action)) {
    return undefined;
  }
  return { spec: entry.spec, def: entry };
}
