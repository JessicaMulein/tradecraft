/**
 * Web-shell client parity and truth isolation over a real game (web-shell
 * Properties 5 and 6). A scripted game is assembled through the real
 * Composition Root with Fake Seams; the shell is started over its `EngineApi`
 * and every read endpoint is compared with the same call made directly. Because
 * every body equals a serialisation of a Player View value, the shell cannot
 * carry anything the facade did not hand it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseShellConfig, startShellServer, type ShellServer } from '@tradecraft/web';

import { ScriptedGame, WIN_BY_ARREST } from './scripted-games.js';

const FORBIDDEN_KEYS = [
  'trueAllegiance', 'apparentAllegiance', 'mice', 'moneyNeed', 'tradecraft',
  'securityConsciousness', 'suspicion', 'conceal', 'believed', 'lie',
];

let game: ScriptedGame;
let server: ShellServer;
let origin: string;
let token: string;

const get = async (path: string): Promise<unknown> => {
  const res = await fetch(origin + path, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status, path).toBe(200);
  return res.json();
};
const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

beforeAll(async () => {
  game = await ScriptedGame.start(WIN_BY_ARREST);
  server = await startShellServer(game.api, parseShellConfig({ port: 0, frames: {} }), { started: true });
  const url = new URL(server.launchUrl);
  origin = url.origin;
  token = url.searchParams.get('token') ?? '';
});
afterAll(async () => { await server.close(); });

describe('Property 6: the shell serves exactly what the Player View returns', () => {
  it.each(['journal', 'map', 'people', 'documents', 'intercepts', 'help'] as const)('/api/views/%s', async (name) => {
    const body = (await get(`/api/views/${name}`)) as Record<string, unknown>;
    expect(body[name]).toEqual(plain((game.api.views[name] as () => unknown)()));
  });

  it('/api/state matches status, here and scene', async () => {
    const body = (await get('/api/state')) as Record<string, unknown>;
    expect(body['status']).toEqual(plain(game.api.status()));
    expect(body['here']).toEqual(plain(game.api.views.here()));
    expect(body['scene']).toEqual(plain(game.api.views.scene()));
  });

  it('/api/casefile matches the Case File listing', async () => {
    const body = (await get('/api/casefile')) as { claims: unknown };
    expect(body.claims).toEqual(plain(game.api.caseFile.list({})));
  });
});

describe('Property 5: no response carries a Truth Store field name', () => {
  it('holds for every read endpoint at game start', async () => {
    const paths = ['/api/state', '/api/casefile', ...['journal', 'map', 'people', 'documents', 'intercepts', 'help'].map((n) => `/api/views/${n}`)];
    for (const p of paths) {
      const text = JSON.stringify(await get(p));
      for (const k of FORBIDDEN_KEYS) {
        expect(text, `${p} contains key ${k}`).not.toContain(`"${k}":`);
      }
    }
  });

  it('offers only references, never raw actions', async () => {
    const body = (await get('/api/state')) as { actions: { ref: string }[] };
    expect(body.actions.length).toBeGreaterThan(0);
    for (const a of body.actions) expect(a.ref).toMatch(/^\d+\.[0-9a-f]{10}(-\d+)?$/);
  });
});

describe('a turn over HTTP', () => {
  it('plays an offered action by reference and streams to a terminal end event', async () => {
    const state = (await get('/api/state')) as { actions: { ref: string; option: { action: { kind: string }; quote: { allowed: boolean } }; template?: unknown }[] };
    const pick = state.actions.find((a) => a.option.quote.allowed && a.template === undefined && a.option.action.kind === 'travel');
    expect(pick).toBeDefined();
    const res = await fetch(origin + '/api/act', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ ref: pick?.ref }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('event: end');
    expect(text).toContain('"ok":true');
    // The old reference is now stale.
    const again = await fetch(origin + '/api/act', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ ref: pick?.ref }),
    });
    expect(again.status).toBe(409);
  });
});
