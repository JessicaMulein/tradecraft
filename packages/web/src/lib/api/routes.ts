/**
 * The API routes (design, "Routes"; Requirements 6, 7, 8). Every JSON body
 * carries `schemaVersion: 1`, and every response is a plain serialisation of a
 * value `EngineApi` returned, with no mapping layer that could add a field.
 */

import {
  Router,
  json,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { z } from 'zod';
import {
  CLAIM_SOURCE_KINDS,
  NARRATION_MODES,
  isValidSaveName,
  tutorialSuggestion,
  type EngineApi,
} from '@tradecraft/player-view';

import { buildBatchRequest, buildFrameRequest } from '../frames/request.js';
import type { ShellState } from '../state.js';
import {
  sendError,
  sendJson,
  type WebError,
  type ZodIssueSummary,
} from './errors.js';
import type { Action } from './templates.js';
import { sseFrame, type TurnKind, type TurnRecorder } from './turn.js';

class HttpError extends Error {
  constructor(readonly web: WebError) {
    super(web.code);
  }
}

function fail(web: WebError): never {
  throw new HttpError(web);
}

function parseWith<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues: ZodIssueSummary[] = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    fail({ code: 'bad-request', issues });
  }
  return result.data;
}

const ID = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9:_./ -]{0,199}$/, 'invalid id');

const ActBody = z.strictObject({
  ref: z.string().min(1).max(100),
  params: z.record(z.string(), z.unknown()).optional(),
});
const SayBody = z.strictObject({
  line: z.string().min(1).max(2000),
  offer: z.number().int().min(0).max(1_000_000).optional(),
});
const NewGameBody = z.strictObject({
  seed: z.string().min(1).max(100).optional(),
  preset: z.string().min(1).max(100),
  mole: z.boolean(),
  narration: z.enum(NARRATION_MODES),
});
const GradeBody = z.strictObject({
  id: ID,
  grade: z.strictObject({
    reliability: z.enum(['A', 'B', 'C', 'D', 'E', 'F']),
    credibility: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
  }),
});
const LinkBody = z.strictObject({ a: ID, b: ID });
const NoteBody = z.strictObject({
  attachTo: z.union([z.number().int().min(0), ID]),
  text: z.string().min(1).max(4000),
});
const SaveBody = z.strictObject({ name: z.string().min(1).max(64) });
const CaseFileQuery = z.strictObject({
  entity: ID.optional(),
  source: z.enum(CLAIM_SOURCE_KINDS).optional(),
  grade: z
    .string()
    .regex(/^[A-F][1-6]$/)
    .optional(),
});

const SIMPLE_VIEWS = [
  'journal',
  'map',
  'people',
  'documents',
  'intercepts',
  'help',
  'city',
  'stories',
  'duties',
] as const;

type Handler = (req: Request, res: Response) => Promise<void> | void;

export function buildRouter(s: ShellState): Router {
  const router = Router();
  const api: EngineApi = s.api;

  const wrap =
    (fn: Handler): RequestHandler =>
    async (req, res) => {
      try {
        await fn(req, res);
      } catch (cause) {
        if (cause instanceof HttpError) {
          sendError(res, cause.web);
          return;
        }
        s.log('request failed', cause);
        sendError(res, { code: 'internal' });
      }
    };

  const requireStarted = (): void => {
    if (!s.started) {
      fail({ code: 'not-started' });
    }
  };

  /** State-changing calls other than turns: refuse while a turn runs or is paused. */
  const requireIdle = (): void => {
    if (s.gate.isRunning) {
      fail({ code: 'busy' });
    }
    if (s.gate.isPaused) {
      fail({ code: 'paused' });
    }
  };

  const bump = (): void => {
    s.stateVersion += 1;
  };

  // --- Read API ---------------------------------------------------------

  router.get(
    '/state',
    wrap((_req, res) => {
      if (!s.started) {
        sendJson(res, {
          started: false,
          stateVersion: s.stateVersion,
          paused: false,
          turnRunning: false,
        });
        return;
      }
      const status = api.status();
      const here = api.views.here();
      const scene = api.views.scene();
      const actions = s.refs.issue(api.actions(), s.stateVersion);
      const duty = [...api.notifications.list()]
        .reverse()
        .find(
          (note) =>
            note.kind === 'cover-duty-due' ||
            note.kind === 'cover-duty-missed' ||
            note.kind === 'cover-employer-message',
        );
      const body: Record<string, unknown> = {
        started: true,
        stateVersion: s.stateVersion,
        paused: s.gate.isPaused,
        turnRunning: s.gate.isRunning,
        status,
        here,
        scene,
        actions,
        dutyAlert: duty?.factLine ?? null,
      };
      if (s.gate.paused !== undefined) {
        body['pausedInfo'] = s.gate.paused;
      }
      if (s.frames.active) {
        const req = buildFrameRequest({
          scene,
          here,
          artDirection: s.config.frames.artDirection,
        });
        body['frame'] = { key: req.key };
        void s.frames.cached(req.key).then((hit) => {
          if (hit) {
            s.events.broadcast('frame', { type: 'frame', key: req.key });
          } else {
            s.frames.request(req);
          }
        });
      }
      sendJson(res, body);
    }),
  );

  router.get(
    '/tutorial',
    wrap((_req, res) => {
      if (!s.started) {
        sendJson(res, { suggestion: null });
        return;
      }
      sendJson(res, { suggestion: tutorialSuggestion(api) ?? null });
    }),
  );

  router.get(
    '/views/document/:id',
    wrap((req, res) => {
      requireStarted();
      const id = parseWith(ID, req.params['id']);
      const doc = api.views.document(id as never);
      if (doc === undefined) {
        fail({ code: 'not-found' });
      }
      sendJson(res, { document: doc });
    }),
  );

  router.get(
    '/views/workbench/:id',
    wrap((req, res) => {
      requireStarted();
      const id = parseWith(ID, req.params['id']);
      let view: unknown;
      try {
        view = api.views.workbench(id as never);
      } catch {
        fail({ code: 'not-found' });
      }
      sendJson(res, { workbench: view });
    }),
  );

  router.get(
    '/views/debrief',
    wrap((_req, res) => {
      requireStarted();
      const debrief = api.views.debrief();
      if (debrief === null) {
        fail({ code: 'not-found' });
      }
      sendJson(res, { debrief });
    }),
  );

  for (const name of SIMPLE_VIEWS) {
    router.get(
      `/views/${name}`,
      wrap((_req, res) => {
        requireStarted();
        const view = (api.views[name] as () => unknown)();
        sendJson(res, { [name]: view });
      }),
    );
  }

  router.get(
    '/casefile',
    wrap((req, res) => {
      requireStarted();
      const q = parseWith(CaseFileQuery, req.query);
      const filter: Record<string, unknown> = {};
      if (q.entity !== undefined) filter['entity'] = q.entity;
      if (q.source !== undefined) filter['source'] = q.source;
      if (q.grade !== undefined) {
        filter['grade'] = {
          reliability: q.grade[0],
          credibility: Number(q.grade[1]),
        };
      }
      sendJson(res, { claims: api.caseFile.list(filter as never) });
    }),
  );

  router.get(
    '/notifications',
    wrap((_req, res) => {
      requireStarted();
      sendJson(res, { notifications: api.notifications.list() });
    }),
  );

  router.get(
    '/saves',
    wrap((_req, res) => {
      sendJson(res, { saves: api.saves.list() });
    }),
  );

  router.get(
    '/cue-map',
    wrap((_req, res) => {
      sendJson(res, {
        cueMap: s.audio.cueMap ?? null,
        manifest: s.audio.manifest,
        formats: s.config.audioFormats,
      });
    }),
  );

  router.get(
    '/frames/:key',
    wrap(async (req, res) => {
      const key = String(req.params['key']);
      const frame = await s.frames.read(key);
      if (frame === undefined) {
        fail({ code: 'not-found' });
      }
      res.setHeader('Content-Type', frame.mediaType);
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.status(200).end(frame.bytes);
    }),
  );

  // --- Json body for everything below -----------------------------------

  const body = json({
    limit: s.config.maxBodyBytes,
    strict: true,
    type: 'application/json',
  });

  router.post(
    '/quote',
    body,
    wrap((req, res) => {
      requireStarted();
      const b = parseWith(ActBody, req.body ?? {});
      const action = resolveAction(b.ref, b.params);
      sendJson(res, { quote: api.quote(action) });
    }),
  );

  function resolveAction(ref: string, params: unknown): Action {
    const resolved = s.refs.resolve(ref, s.stateVersion);
    if (resolved.kind === 'stale') fail({ code: 'stale-ref' });
    if (resolved.kind === 'unknown') fail({ code: 'unknown-ref' });
    const completed = s.refs.complete(resolved.offered, params);
    if (completed.kind === 'invalid')
      fail({ code: 'bad-request', issues: completed.issues });
    return completed.action;
  }

  // --- Turns -------------------------------------------------------------

  function startTurn(
    kind: TurnKind,
    open: () => ReturnType<typeof api.act>,
  ): TurnRecorder {
    const result = s.gate.run(kind, open);
    switch (result.kind) {
      case 'busy':
        return fail({ code: 'busy' });
      case 'paused':
        return fail({ code: 'paused' });
      case 'not-paused':
        return fail({
          code: 'not-allowed',
          reason: 'there is no paused turn to retry',
        });
      case 'started':
        return result.recorder;
    }
  }

  async function stream(
    req: Request,
    res: Response,
    recorder: TurnRecorder,
  ): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const beat = setInterval(() => res.write(': hb\n\n'), 15_000);
    beat.unref();
    let closed = false;
    const onClose = (): void => {
      closed = true;
    };
    res.on('close', onClose);
    try {
      for await (const event of recorder.follow()) {
        if (closed) {
          break; // the turn keeps running; only this follower stops
        }
        res.write(sseFrame(event));
      }
    } finally {
      clearInterval(beat);
      res.off('close', onClose);
      if (!res.writableEnded) {
        res.end();
      }
    }
    void req;
  }

  router.post(
    '/act',
    body,
    wrap(async (req, res) => {
      requireStarted();
      requireIdle();
      const b = parseWith(ActBody, req.body ?? {});
      const action = resolveAction(b.ref, b.params);
      const quote = api.quote(action);
      if (!quote.allowed) {
        fail({ code: 'not-allowed', reason: quote.reason ?? 'not allowed' });
      }
      const recorder = startTurn('act', () => api.act(action));
      await stream(req, res, recorder);
    }),
  );

  router.post(
    '/say',
    body,
    wrap(async (req, res) => {
      requireStarted();
      requireIdle();
      const b = parseWith(SayBody, req.body ?? {});
      const recorder = startTurn('say', () =>
        api.say(b.line, b.offer === undefined ? undefined : { offer: b.offer }),
      );
      await stream(req, res, recorder);
    }),
  );

  router.post(
    '/end-scene',
    body,
    wrap(async (req, res) => {
      requireStarted();
      requireIdle();
      parseWith(z.strictObject({}), req.body ?? {});
      const recorder = startTurn('end-scene', () => api.endScene());
      await stream(req, res, recorder);
    }),
  );

  router.post(
    '/retry',
    body,
    wrap(async (req, res) => {
      requireStarted();
      if (s.gate.isRunning) {
        fail({ code: 'busy' });
      }
      parseWith(z.strictObject({}), req.body ?? {});
      const recorder = startTurn('retry', () => api.retry());
      await stream(req, res, recorder);
    }),
  );

  router.get(
    '/turn/last',
    wrap(async (req, res) => {
      const last = s.gate.lastTurn;
      if (last === undefined) {
        fail({ code: 'not-found' });
      }
      await stream(req, res, last);
    }),
  );

  // --- Events -------------------------------------------------------------

  router.get(
    '/events',
    wrap((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      res.write(': open\n\n');
      const remove = s.events.add(res);
      let unsubscribe: (() => void) | undefined;
      if (s.started) {
        unsubscribe = api.notifications.subscribe((n) => {
          res.write(`event: notification\ndata: ${JSON.stringify(n)}\n\n`);
        });
      }
      const beat = setInterval(() => res.write(': hb\n\n'), 15_000);
      beat.unref();
      req.on('close', () => {
        clearInterval(beat);
        remove();
        unsubscribe?.();
      });
    }),
  );

  // --- Case File, notes, notifications -----------------------------------

  router.post(
    '/casefile/grade',
    body,
    wrap((req, res) => {
      requireStarted();
      requireIdle();
      const b = parseWith(GradeBody, req.body ?? {});
      api.caseFile.grade(b.id, b.grade as never);
      sendJson(res, { ok: true });
    }),
  );
  router.post(
    '/casefile/link',
    body,
    wrap((req, res) => {
      requireStarted();
      requireIdle();
      const b = parseWith(LinkBody, req.body ?? {});
      api.caseFile.link(b.a, b.b);
      sendJson(res, { ok: true });
    }),
  );
  router.post(
    '/casefile/unlink',
    body,
    wrap((req, res) => {
      requireStarted();
      requireIdle();
      const b = parseWith(LinkBody, req.body ?? {});
      api.caseFile.unlink(b.a, b.b);
      sendJson(res, { ok: true });
    }),
  );
  router.post(
    '/notes',
    body,
    wrap((req, res) => {
      requireStarted();
      requireIdle();
      const b = parseWith(NoteBody, req.body ?? {});
      api.notes.add({ attachTo: b.attachTo as never, text: b.text });
      sendJson(res, { ok: true });
    }),
  );
  router.post(
    '/notifications/:id/dismiss',
    body,
    wrap((req, res) => {
      requireStarted();
      const id = parseWith(ID, req.params['id']);
      api.notifications.dismiss(id as never);
      sendJson(res, { ok: true });
    }),
  );

  // --- Saves and new game -------------------------------------------------

  router.post(
    '/saves',
    body,
    wrap(async (req, res) => {
      requireStarted();
      requireIdle();
      const b = parseWith(SaveBody, req.body ?? {});
      if (!isValidSaveName(b.name)) {
        fail({
          code: 'bad-request',
          issues: [{ path: 'name', message: 'invalid save name' }],
        });
      }
      sendJson(res, { save: await api.saves.save(b.name) });
    }),
  );

  router.post(
    '/saves/:name/load',
    body,
    wrap(async (req, res) => {
      requireIdle();
      const name = parseWith(z.string().min(1).max(64), req.params['name']);
      if (!isValidSaveName(name)) {
        fail({
          code: 'bad-request',
          issues: [{ path: 'name', message: 'invalid save name' }],
        });
      }
      const result = await api.saves.load(name);
      if (!result.ok) {
        fail({ code: 'load-error', error: result.error });
      }
      s.started = true;
      s.gate.reset();
      bump();
      sendJson(res, { game: result.value, stateVersion: s.stateVersion });
    }),
  );

  router.post(
    '/new-game',
    body,
    wrap(async (req, res) => {
      requireIdle();
      const b = parseWith(NewGameBody, req.body ?? {});
      const game = await api.newGame({
        ...(b.seed !== undefined ? { seed: b.seed } : {}),
        preset: b.preset,
        mole: b.mole,
        narration: b.narration,
      });
      s.started = true;
      s.gate.reset();
      bump();
      if (s.frames.active) {
        const here = api.views.here();
        const scene = api.views.scene();
        const map = api.views.map();
        const context = {
          phase: String(api.status().time.phase),
          weather: scene.weather,
          artDirection: s.config.frames.artDirection,
        };
        const batch = [
          buildFrameRequest({
            scene,
            here,
            artDirection: s.config.frames.artDirection,
          }),
          ...map.districts.flatMap((d) =>
            d.locations.map((l) =>
              buildBatchRequest(
                { name: l.name, type: l.type, crowd: String(l.crowd) },
                context,
              ),
            ),
          ),
        ];
        s.frames.prepareBatch(batch);
      }
      sendJson(res, { game, stateVersion: s.stateVersion });
    }),
  );

  return router;
}
