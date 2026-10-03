/**
 * The security middleware (design, "Middleware order"). Each guard is a small
 * factory returning an Express handler so the order is visible in one place:
 * `server.ts` registers them in the sequence the design fixes.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { sendError, sendUnauthorized } from '../api/errors.js';
import { LOOPBACK_PEERS, SESSION_COOKIE } from './constants.js';
import type { Lockout } from './lockout.js';
import type { SessionStore } from './sessions.js';
import { constantTimeEqual } from './token.js';

export function isLoopbackPeer(address: string | undefined): boolean {
  return address !== undefined && LOOPBACK_PEERS.includes(address);
}

/** 1. Peer check: a non-loopback peer gets no response bytes (Requirement 2.5). */
export function peerCheck(): RequestHandler {
  return (req, _res, next) => {
    if (!isLoopbackPeer(req.socket.remoteAddress)) {
      req.socket.destroy();
      return;
    }
    next();
  };
}

export function allowedHosts(port: number): readonly string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

export function allowedOrigins(port: number): readonly string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

/** 2. Host guard (DNS-rebinding defence, Requirement 4.1): 421 on a bad Host. */
export function hostGuard(port: () => number): RequestHandler {
  return (req, res, next) => {
    const host = req.headers.host;
    if (host === undefined || !allowedHosts(port()).includes(host.toLowerCase())) {
      res.status(421).end();
      return;
    }
    next();
  };
}

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

/** 3. Security headers on every response (Requirements 4.3, 4.5, 4.6). */
export function securityHeaders(): RequestHandler {
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/') || req.path === '/launch') {
      res.setHeader('Cache-Control', 'no-store');
    }
    res.removeHeader('X-Powered-By');
    next();
  };
}

/** Cross-origin preflight is refused with no CORS headers (Requirement 4.3). */
export function refusePreflight(): RequestHandler {
  return (req, res, next) => {
    if (req.method === 'OPTIONS') {
      res.status(403).end();
      return;
    }
    next();
  };
}

/** 4. Lockout (Requirement 3.6): 429 with `Retry-After`. */
export function lockoutGuard(lockout: Lockout): RequestHandler {
  return (_req, res, next) => {
    const wait = lockout.blocked();
    if (wait !== undefined) {
      res.setHeader('Retry-After', String(wait));
      res.status(429).end();
      return;
    }
    next();
  };
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      continue;
    }
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

export interface LaunchDeps {
  readonly token: string;
  readonly sessions: SessionStore;
  readonly lockout: Lockout;
}

const LAUNCH_PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta http-equiv="refresh" content="0; url=/"><title>Tradecraft</title></head>' +
  '<body><p>Opening Tradecraft…</p></body></html>';

/**
 * 5. The launch route: the only route that accepts the token in a query
 * (Requirement 3.3). A wrong token counts toward the lockout.
 */
export function launchRoute(deps: LaunchDeps): RequestHandler {
  return (req, res, next) => {
    if (req.method !== 'GET' || req.path !== '/launch') {
      next();
      return;
    }
    const supplied = req.query['token'];
    if (typeof supplied !== 'string' || !constantTimeEqual(supplied, deps.token)) {
      deps.lockout.fail();
      sendUnauthorized(res);
      return;
    }
    const id = deps.sessions.create();
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).type('html').send(LAUNCH_PAGE);
  };
}

/**
 * 6. Authentication (Requirements 3.4, 3.5): a valid session cookie, or
 * `Authorization: Bearer <token>` for scripts and evals. A presented but wrong
 * credential counts toward the lockout; a missing one is simply refused.
 */
export function authenticate(deps: LaunchDeps): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const cookie = readCookie(req.headers.cookie, SESSION_COOKIE);
    const auth = req.headers.authorization;
    const bearer = auth !== undefined ? /^Bearer (.+)$/.exec(auth)?.[1] : undefined;

    if (cookie !== undefined && deps.sessions.has(cookie)) {
      next();
      return;
    }
    if (bearer !== undefined && constantTimeEqual(bearer, deps.token)) {
      next();
      return;
    }
    if (cookie !== undefined || bearer !== undefined) {
      deps.lockout.fail();
    }
    sendUnauthorized(res);
  };
}

/**
 * 7. Origin guard for every state-changing request (Requirement 4.2), plus the
 * JSON content-type requirement for any body (Requirement 4.4).
 */
export function originGuard(port: () => number): RequestHandler {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      next();
      return;
    }
    const origin = req.headers.origin;
    if (origin === undefined || !allowedOrigins(port()).includes(origin.toLowerCase())) {
      res.status(403).end();
      return;
    }
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') {
      res.status(403).end();
      return;
    }
    const length = Number(req.headers['content-length'] ?? '0');
    const chunked = req.headers['transfer-encoding'] !== undefined;
    if ((length > 0 || chunked) && !req.is('application/json')) {
      sendError(res, {
        code: 'bad-request',
        issues: [{ path: 'content-type', message: 'application/json is required' }],
      });
      return;
    }
    next();
  };
}
