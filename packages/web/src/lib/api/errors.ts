/**
 * Typed errors (design, "Errors"; Requirement 13). A body is built from this
 * vocabulary only. `internal` carries no message: the cause goes to the server
 * log, never to the client (Requirement 13.2).
 */

import type { Response } from 'express';
import type { FeedError, LoadError } from '@tradecraft/player-view';

export interface ZodIssueSummary {
  readonly path: string;
  readonly message: string;
}

export type WebError =
  | { readonly code: 'bad-request'; readonly issues: readonly ZodIssueSummary[] }
  | { readonly code: 'unauthorized' }
  | { readonly code: 'busy' }
  | { readonly code: 'paused' }
  | { readonly code: 'stale-ref' }
  | { readonly code: 'unknown-ref' }
  | { readonly code: 'not-allowed'; readonly reason: string }
  | { readonly code: 'load-error'; readonly error: LoadError }
  | { readonly code: 'feed-error'; readonly errors: readonly FeedError[] }
  | { readonly code: 'not-started' }
  | { readonly code: 'not-found' }
  | { readonly code: 'too-large' }
  | { readonly code: 'internal' };

export const SCHEMA_VERSION = 1 as const;

const STATUS: Record<WebError['code'], number> = {
  'bad-request': 400,
  unauthorized: 401,
  busy: 409,
  paused: 409,
  'stale-ref': 409,
  'unknown-ref': 400,
  'not-allowed': 409,
  'load-error': 409,
  'feed-error': 400,
  'not-started': 409,
  'not-found': 404,
  'too-large': 413,
  internal: 500,
};

export function statusFor(error: WebError): number {
  return STATUS[error.code];
}

export function sendError(res: Response, error: WebError): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(statusFor(error)).json({ schemaVersion: SCHEMA_VERSION, error });
}

/** 401 with no detail and no body (Requirement 3.4). */
export function sendUnauthorized(res: Response): void {
  res.status(401).end();
}

export function sendJson(res: Response, body: Record<string, unknown>): void {
  res.json({ schemaVersion: SCHEMA_VERSION, ...body });
}
