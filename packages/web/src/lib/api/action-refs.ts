/**
 * Action References (design, "Action References"; Requirement 7).
 *
 * Every action in a response carries a reference that is valid for one state
 * version. The client sends the reference, never an Action object. A reference
 * is `${stateVersion}.${hash}`, where the hash covers the action itself, so a
 * catalogue that changes within one state version (a Case File change can add
 * an arrest) can never leave an old reference pointing at a different action.
 * Two identical actions in one catalogue get a `-n` suffix.
 */

import { createHash } from 'node:crypto';
import type { ActionOption } from '@tradecraft/player-view';

import { templateFor, type Action, type TemplateSpec } from './templates.js';
import type { ZodIssueSummary } from './errors.js';

export interface OfferedAction {
  readonly ref: string;
  readonly option: ActionOption;
  readonly template?: TemplateSpec;
}

export type ResolveResult =
  | { readonly kind: 'ok'; readonly offered: OfferedAction }
  | { readonly kind: 'stale' }
  | { readonly kind: 'unknown' };

export type CompleteResult =
  | { readonly kind: 'ok'; readonly action: Action }
  | { readonly kind: 'invalid'; readonly issues: readonly ZodIssueSummary[] };

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
      );
    }
    return v;
  });
}

function shortHash(action: Action): string {
  return createHash('sha256').update(canonical(action)).digest('hex').slice(0, 10);
}

const REF = /^(\d+)\.[0-9a-f]{10}(?:-\d+)?$/;

export class ActionRefTable {
  private issued = new Map<string, OfferedAction>();

  /** Issue references for the current catalogue, replacing the previous issue. */
  issue(options: readonly ActionOption[], stateVersion: number): OfferedAction[] {
    const out: OfferedAction[] = [];
    const next = new Map<string, OfferedAction>();
    const seen = new Map<string, number>();
    options.forEach((option) => {
      const hash = shortHash(option.action);
      const n = seen.get(hash) ?? 0;
      seen.set(hash, n + 1);
      const ref = `${stateVersion}.${hash}${n === 0 ? '' : `-${n}`}`;
      const template = templateFor(option.action);
      const offered: OfferedAction = {
        ref,
        option,
        ...(template !== undefined ? { template: template.spec } : {}),
      };
      next.set(ref, offered);
      out.push(offered);
    });
    this.issued = next;
    return out;
  }

  resolve(ref: string, stateVersion: number): ResolveResult {
    const m = REF.exec(ref);
    if (m === null) {
      return { kind: 'unknown' };
    }
    if (Number(m[1]) !== stateVersion) {
      return { kind: 'stale' };
    }
    const offered = this.issued.get(ref);
    return offered === undefined ? { kind: 'unknown' } : { kind: 'ok', offered };
  }

  /**
   * Produce the final Action from an offered one plus validated parameters. A
   * template's schema is strict, so unknown parameters are refused; an Offered
   * Action that is not a template takes no parameters at all.
   */
  complete(offered: OfferedAction, params: unknown): CompleteResult {
    const tpl = templateFor(offered.option.action);
    if (tpl === undefined) {
      const empty =
        params === undefined ||
        (typeof params === 'object' && params !== null && Object.keys(params).length === 0);
      return empty
        ? { kind: 'ok', action: offered.option.action }
        : { kind: 'invalid', issues: [{ path: 'params', message: 'this action takes no parameters' }] };
    }
    const parsed = tpl.def.schema.safeParse(params ?? {});
    if (!parsed.success) {
      return {
        kind: 'invalid',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }
    return { kind: 'ok', action: tpl.def.complete(offered.option.action, parsed.data) };
  }
}
