/**
 * The Shell Server (design, "Server"; Requirements 1–5, 12, 13).
 *
 * `startShellServer` generates the Access Token, binds to the loopback address
 * only, learns the port, builds the allowed Host and Origin sets and returns
 * the Launch URL. The host is a constant: there is no configuration key that
 * could change it (Requirement 2.2).
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { type ErrorRequestHandler, type Express, type Request, type Response } from 'express';
import type { EngineApi } from '@tradecraft/player-view';

import { sendError } from './api/errors.js';
import { ActionRefTable } from './api/action-refs.js';
import { buildRouter } from './api/routes.js';
import { TurnGate } from './api/turn.js';
import { buildManifest } from './audio/manifest.js';
import { parseCueMap, parseTakeMeta } from './audio/cue-map.js';
import type { ShellConfig } from './config.js';
import { FrameService } from './frames/service.js';
import type { SceneFrameProvider } from './frames/types.js';
import {
  authenticate,
  hostGuard,
  isLoopbackPeer,
  launchRoute,
  lockoutGuard,
  originGuard,
  peerCheck,
  refusePreflight,
  securityHeaders,
} from './security/guards.js';
import { LOOPBACK_HOST } from './security/constants.js';
import { Lockout } from './security/lockout.js';
import { SessionStore } from './security/sessions.js';
import { generateToken } from './security/token.js';
import { EventBus, type ShellState } from './state.js';

export interface LogEntry {
  readonly method: string;
  readonly route: string;
  readonly status: number;
  readonly ms: number;
}

export interface ShellDeps {
  readonly frameProvider?: SceneFrameProvider;
  /** Fixes the Access Token and session ids in tests. */
  readonly random?: (n: number) => Buffer;
  /** Resolves relative config paths. Defaults to the process working directory. */
  readonly baseDir?: string;
  /** The parsed `soundtrack/cue-map.yaml`, if any. The launcher reads the YAML. */
  readonly cueMap?: unknown;
  /** The parsed `soundtrack/take-meta.yaml`, if any. */
  readonly takeMeta?: unknown;
  /** Set when the supplied engine already holds a running game. */
  readonly started?: boolean;
  /** Request log: method, route, status and duration only (Requirement 13.3). */
  readonly log?: (entry: LogEntry) => void;
  /** Error log: the cause goes here, never to the client. */
  readonly logError?: (message: string, cause?: unknown) => void;
  readonly frameTimeoutMs?: number;
}

export interface ShellServer {
  readonly port: number;
  /** Contains the token. Printed once by the launcher and never logged. */
  readonly launchUrl: string;
  /** Stop accepting, let the in-flight turn commit, close streams. */
  close(): Promise<void>;
}

/** The package root, found from this module in both `src/lib` and `dist/lib`. */
function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export async function startShellServer(
  api: EngineApi,
  config: ShellConfig,
  deps: ShellDeps = {},
): Promise<ShellServer> {
  const baseDir = resolve(deps.baseDir ?? process.cwd());
  const root = packageRoot();
  const paths = {
    soundtrackDir: resolve(baseDir, config.soundtrackDir),
    artDir: resolve(baseDir, config.artDir),
    staticDir: resolve(root, 'src', 'static'),
    clientDir: resolve(root, 'dist', 'client-js'),
  };
  const logError = deps.logError ?? (() => undefined);

  const token = generateToken(deps.random);
  const sessions = new SessionStore(deps.random);
  const lockout = new Lockout(config.lockout);

  // Audio: validate the Cue Map and discover Takes. A missing cue is reported,
  // never fatal (Requirement 15.15).
  const cueMap = deps.cueMap === undefined ? undefined : parseCueMap(deps.cueMap);
  const meta = parseTakeMeta(deps.takeMeta);
  const built =
    cueMap === undefined
      ? { manifest: { takes: {}, missing: [], singleTake: [] }, allowed: new Set<string>() }
      : await buildManifest(paths.soundtrackDir, cueMap, config.audioFormats, meta);

  const events = new EventBus();
  const state: ShellState = {
    api,
    config,
    paths,
    stateVersion: 1,
    started: deps.started ?? false,
    refs: new ActionRefTable(),
    gate: new TurnGate({
      onCommit: () => {
        state.stateVersion += 1;
      },
      log: logError,
    }),
    frames: new FrameService({
      dir: resolve(baseDir, config.frames.dir),
      ...(deps.frameProvider !== undefined ? { provider: deps.frameProvider } : {}),
      emit: (e) => events.broadcast(e.type, e),
      ...(deps.frameTimeoutMs !== undefined ? { timeoutMs: deps.frameTimeoutMs } : {}),
      log: (m) => logError(m),
    }),
    events,
    audio: { cueMap, manifest: built.manifest, allowed: built.allowed },
    log: logError,
  };

  let boundPort = 0;
  const port = (): number => boundPort;

  const app: Express = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  const http = createServer(app);
  http.on('connection', (socket) => {
    if (!isLoopbackPeer(socket.remoteAddress)) {
      socket.destroy();
    }
  });

  // --- Middleware, in the order the design fixes -------------------------
  app.use(peerCheck());
  app.use(requestLog(deps.log));
  app.use(hostGuard(port));
  app.use(securityHeaders());
  app.use(refusePreflight());
  app.use(lockoutGuard(lockout));
  const auth = { token, sessions, lockout };
  app.use(launchRoute(auth));
  app.use(authenticate(auth));
  app.use(originGuard(port));

  // --- Routes -------------------------------------------------------------
  app.use('/api', buildRouter(state));

  app.get('/audio/*path', (req: Request, res: Response) => {
    const raw = req.params['path'];
    const rel = (Array.isArray(raw) ? raw.join('/') : String(raw)).normalize('NFC');
    if (!state.audio.allowed.has(rel)) {
      sendError(res, { code: 'not-found' });
      return;
    }
    sendFileOr404(res, rel, paths.soundtrackDir, 'private, max-age=3600');
  });

  const ART: Record<string, string> = {
    'box-wide.jpg': 'box_art.jpeg',
    'box-square.jpg': 'box_art-1-1.jpeg',
  };
  app.get('/art/:name', (req: Request, res: Response) => {
    const file = ART[String(req.params['name'])];
    if (file === undefined) {
      sendError(res, { code: 'not-found' });
      return;
    }
    sendFileOr404(res, file, paths.artDir, 'private, max-age=3600');
  });

  app.get('/', (_req, res) => sendFileOr404(res, 'index.html', paths.staticDir, 'no-store'));
  app.get('/static/app.css', (_req, res) => sendFileOr404(res, 'app.css', paths.staticDir, 'no-store'));
  app.use(
    '/static/js',
    express.static(paths.clientDir, { index: false, dotfiles: 'deny', etag: false, maxAge: 0 }),
  );

  app.use((_req, res) => sendError(res, { code: 'not-found' }));

  const onError: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    const type = (err as { type?: string } | undefined)?.type;
    if (type === 'entity.too.large') {
      sendError(res, { code: 'too-large' });
    } else if (type === 'entity.parse.failed' || err instanceof SyntaxError) {
      sendError(res, { code: 'bad-request', issues: [{ path: 'body', message: 'invalid JSON' }] });
    } else {
      logError('unhandled error', err);
      sendError(res, { code: 'internal' });
    }
  };
  app.use(onError);

  // --- Listen -------------------------------------------------------------
  await new Promise<void>((resolveListen, rejectListen) => {
    http.once('error', (cause: NodeJS.ErrnoException) => {
      rejectListen(
        new Error(
          cause.code === 'EADDRINUSE'
            ? `port ${config.port} is already in use`
            : `could not listen on ${LOOPBACK_HOST}:${config.port}: ${cause.message}`,
        ),
      );
    });
    http.listen(config.port, LOOPBACK_HOST, () => resolveListen());
  });

  const address = http.address() as AddressInfo | null;
  if (address === null || typeof address === 'string' || address.address !== LOOPBACK_HOST) {
    http.close();
    throw new Error(`the Shell Server must bind to ${LOOPBACK_HOST}; it bound to ${JSON.stringify(address)}`);
  }
  boundPort = address.port;

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      // Stop accepting; the callback fires once every open connection has ended.
      const stopped = new Promise<void>((resolveStop) => http.close(() => resolveStop()));
      await state.gate.idle(); // let the in-flight turn commit
      events.closeAll();
      await state.frames.close();
      sessions.clear();
      // Give followers of the finished turn a moment to flush, then cut the rest.
      let settled = false;
      void stopped.then(() => {
        settled = true;
      });
      const deadline = Date.now() + 2000;
      while (!settled && Date.now() < deadline) {
        http.closeIdleConnections();
        await new Promise<void>((r) => setTimeout(r, 20));
      }
      http.closeAllConnections();
    })();
    return closing;
  };

  return {
    port: boundPort,
    launchUrl: `http://${LOOPBACK_HOST}:${boundPort}/launch?token=${token}`,
    close,
  };
}

function sendFileOr404(res: Response, file: string, root: string, cacheControl: string): void {
  res.sendFile(file, { root, dotfiles: 'deny', acceptRanges: true, cacheControl: false, headers: { 'Cache-Control': cacheControl } }, (err) => {
    if (err !== undefined && err !== null && !res.headersSent) {
      sendError(res, { code: 'not-found' });
    }
  });
}

/** Logs method, route, status and duration. Never the query, headers or body. */
function requestLog(log: ((entry: LogEntry) => void) | undefined): express.RequestHandler {
  return (req, res, next) => {
    if (log === undefined) {
      next();
      return;
    }
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const route = req.route !== undefined ? `${req.baseUrl}${String((req.route as { path?: unknown }).path)}` : '(unmatched)';
      log({
        method: req.method,
        route,
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - start) / 1_000_000n),
      });
    });
    next();
  };
}

