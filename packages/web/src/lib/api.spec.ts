import { request as httpRequest } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { parseSse, startHarness, type Harness } from './test-support/harness.js';
import { ActionRefTable } from './api/action-refs.js';
import { fakeActions } from './test-support/fake-engine.js';

let h: Harness | undefined;
afterEach(async () => {
  h?.engine.release();
  await h?.close();
  h = undefined;
});

async function state(harness: Harness): Promise<{ stateVersion: number; actions: { ref: string; option: { action: { kind: string; amount?: number } }; template?: unknown }[] }> {
  return (await harness.request({ path: '/api/state' })).json() as never;
}

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('read API', () => {
  it('serves state with schemaVersion, stateVersion and issued references', async () => {
    h = await startHarness();
    const res = await h.request({ path: '/api/state' });
    const body = res.json() as { schemaVersion: number; started: boolean; actions: { ref: string }[] };
    expect(body.schemaVersion).toBe(1);
    expect(body.started).toBe(true);
    expect(body.actions).toHaveLength(4);
    expect(new Set(body.actions.map((a) => a.ref)).size).toBe(4);
  });

  it('reports not started before a game exists', async () => {
    h = await startHarness({}, { started: false });
    const body = (await h.request({ path: '/api/state' })).json();
    expect(body['started']).toBe(false);
    expect((await h.request({ path: '/api/views/journal' })).json()['error']).toEqual({ code: 'not-started' });
  });

  it('serves each view and validates ids', async () => {
    h = await startHarness();
    for (const name of ['journal', 'map', 'people', 'documents', 'intercepts', 'help']) {
      const res = await h.request({ path: `/api/views/${name}` });
      expect(res.status, name).toBe(200);
      expect(res.json()[name], name).toBeDefined();
    }
    expect((await h.request({ path: '/api/views/document/doc:real' })).status).toBe(200);
    expect((await h.request({ path: '/api/views/document/doc:missing' })).status).toBe(404);
    expect((await h.request({ path: '/api/views/document/' + encodeURIComponent('<script>') })).status).toBe(400);
    expect((await h.request({ path: '/api/views/workbench/int:1' })).status).toBe(200);
    expect((await h.request({ path: '/api/views/workbench/int:9' })).status).toBe(404);
  });

  it('returns the debrief only when the engine returns one (Req 10.4)', async () => {
    h = await startHarness();
    expect((await h.request({ path: '/api/views/debrief' })).status).toBe(404);
  });

  it('validates the case file filter', async () => {
    h = await startHarness();
    expect((await h.request({ path: '/api/casefile' })).status).toBe(200);
    expect((await h.request({ path: '/api/casefile?grade=Z9' })).status).toBe(400);
    expect((await h.request({ path: '/api/casefile?bogus=1' })).status).toBe(400);
  });

  it('never leaks internals in a 500', async () => {
    h = await startHarness();
    h.engine.api.views.journal = () => {
      throw new Error('secret path /home/x/truth.json');
    };
    const res = await h.request({ path: '/api/views/journal' });
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('secret');
    expect(res.json()['error']).toEqual({ code: 'internal' });
  });

  it('answers unknown routes with a typed 404', async () => {
    h = await startHarness();
    const res = await h.request({ path: '/api/nothing' });
    expect(res.status).toBe(404);
    expect(res.json()['error']).toEqual({ code: 'not-found' });
  });
});

describe('Property 4: Offered actions only', () => {
  // Feature: web-shell, Property 4: Offered actions only
  it('acts only on an issued reference for the current state version', async () => {
    h = await startHarness();
    const s = await state(h);
    const wait = s.actions.find((a) => a.option.action.kind === 'wait') as { ref: string };
    const res = await h.request({ method: 'POST', path: '/api/act', body: { ref: wait.ref } });
    expect(res.status).toBe(200);
    expect(parseSse(res.text).at(-1)).toEqual({ event: 'end', data: { ok: true } });
    expect(h.engine.calls.filter((c) => c.startsWith('act:'))).toEqual(['act:{"kind":"wait","phases":1}']);
  });

  it('never passes an Action object, unknown reference or stale reference to act', async () => {
    h = await startHarness();
    const s = await state(h);
    const ref = (s.actions[0] as { ref: string }).ref;

    const bodies: unknown[] = [
      { action: { kind: 'arrest', npc: 'npc:viktor' } },
      { ref, action: { kind: 'arrest', npc: 'npc:viktor' } },
      { ref: '1.0000000000' },
      { ref: 'garbage' },
      { ref: '999.aaaaaaaaaa' },
      {},
      [],
      'wait',
    ];
    for (const body of bodies) {
      const res = await h.request({ method: 'POST', path: '/api/act', body });
      expect([400, 409], JSON.stringify(body)).toContain(res.status);
    }
    expect(h.engine.calls.filter((c) => c.startsWith('act:'))).toEqual([]);

    // Commit a turn; the old reference is now stale.
    expect((await h.request({ method: 'POST', path: '/api/act', body: { ref } })).status).toBe(200);
    const stale = await h.request({ method: 'POST', path: '/api/act', body: { ref } });
    expect(stale.status).toBe(409);
    expect(stale.json()['error']).toEqual({ code: 'stale-ref' });
    expect(h.engine.calls.filter((c) => c.startsWith('act:'))).toHaveLength(1);
  });

  it('returns the quote reason for a disallowed offered action and starts no turn', async () => {
    h = await startHarness();
    const s = await state(h);
    const tired = s.actions.find((a) => (a.option.action as { phases?: number }).phases === 4) as { ref: string };
    const res = await h.request({ method: 'POST', path: '/api/act', body: { ref: tired.ref } });
    expect(res.status).toBe(409);
    expect(res.json()['error']).toEqual({ code: 'not-allowed', reason: 'too tired' });
    expect(h.engine.calls.filter((c) => c.startsWith('act:'))).toEqual([]);
  });

  it('completes a template with validated parameters and nothing else', async () => {
    h = await startHarness();
    const s = await state(h);
    const pay = s.actions.find((a) => a.option.action.kind === 'pay') as { ref: string; template?: unknown };
    expect(pay.template).toBeDefined();

    const bad = [{ amount: -5 }, { amount: 1.5 }, { amount: 'ten' }, { amount: 5, kind: 'arrest' }, { amount: 5, npc: 'npc:other' }, {}];
    for (const params of bad) {
      const r = await h.request({ method: 'POST', path: '/api/act', body: { ref: pay.ref, params } });
      expect(r.status, JSON.stringify(params)).toBe(400);
    }
    expect(h.engine.calls.filter((c) => c.startsWith('act:'))).toEqual([]);

    const ok = await h.request({ method: 'POST', path: '/api/act', body: { ref: pay.ref, params: { amount: 25 } } });
    expect(ok.status).toBe(200);
    expect(h.engine.calls.filter((c) => c.startsWith('act:'))).toEqual(['act:{"kind":"pay","npc":"npc:viktor","amount":25}']);
  });

  it('refuses parameters for an action that is not a template', async () => {
    h = await startHarness();
    const s = await state(h);
    const wait = s.actions.find((a) => a.option.action.kind === 'wait') as { ref: string };
    const r = await h.request({ method: 'POST', path: '/api/act', body: { ref: wait.ref, params: { phases: 4 } } });
    expect(r.status).toBe(400);
  });

  it('keeps a reference from pointing at a different action when the catalogue changes in one version', () => {
    const table = new ActionRefTable();
    const first = table.issue(fakeActions(), 1);
    const changed = fakeActions().slice(1);
    table.issue(changed, 1);
    // The removed action's reference is gone; a surviving action keeps its own.
    expect(table.resolve((first[0] as { ref: string }).ref, 1).kind).toBe('unknown');
    const survivor = table.resolve((first[1] as { ref: string }).ref, 1);
    expect(survivor.kind).toBe('ok');
    expect(survivor.kind === 'ok' && survivor.offered.option.action).toEqual(first[1]?.option.action);
  });
});

describe('turns: streaming, one at a time, disconnect safety', () => {
  it('relays chunks in order as server-sent events with a terminal event', async () => {
    h = await startHarness();
    const s = await state(h);
    const res = await h.request({ method: 'POST', path: '/api/act', body: { ref: (s.actions[0] as { ref: string }).ref } });
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseSse(res.text);
    expect(events.map((e) => e.event)).toEqual(['chunk', 'chunk', 'chunk', 'end']);
    expect(events.map((e) => (e.data as { kind?: string }).kind)).toEqual(['fact', 'flavour', 'done', undefined]);
  });

  // Feature: web-shell, Property 8: One turn at a time
  it('answers 409 busy to every state-changing request while a turn runs', async () => {
    h = await startHarness();
    h.engine.hold = true;
    const s = await state(h);
    const ref = (s.actions[0] as { ref: string }).ref;
    const first = h.request({ method: 'POST', path: '/api/act', body: { ref } });
    await waitFor(() => h!.engine.calls.some((c) => c.startsWith('act:')));

    const attempts = [
      { path: '/api/act', body: { ref } },
      { path: '/api/say', body: { line: 'hello' } },
      { path: '/api/end-scene', body: {} },
      { path: '/api/retry', body: {} },
      { path: '/api/saves', body: { name: 'x' } },
      { path: '/api/saves/good/load', body: {} },
      { path: '/api/new-game', body: { preset: 'p', mole: false, narration: 'off' } },
      { path: '/api/notes', body: { attachTo: 1, text: 't' } },
    ];
    for (const a of attempts) {
      const r = await h.request({ method: 'POST', ...a });
      expect(r.status, a.path).toBe(409);
      expect(r.json()['error'], a.path).toEqual({ code: 'busy' });
    }
    expect(h.engine.calls.filter((c) => c.startsWith('act:') || c.startsWith('say:') || c === 'endScene' || c === 'retry' || c === 'newGame')).toHaveLength(1);

    h.engine.release();
    expect((await first).status).toBe(200);
  });

  // Feature: web-shell, Property 7: Turn atomicity under disconnect
  it('finishes and records a turn whose client disconnects mid-stream', async () => {
    h = await startHarness();
    h.engine.hold = true;
    const s = await state(h);
    const ref = (s.actions[0] as { ref: string }).ref;
    const harness = h;

    await new Promise<void>((resolve) => {
      const body = JSON.stringify({ ref });
      const req = httpRequest(
        { host: '127.0.0.1', port: harness.port, path: '/api/act', method: 'POST', headers: { cookie: harness.cookie, origin: harness.origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
        (res) => {
          res.once('data', () => {
            res.destroy(); // the client goes away after the first chunk
            resolve();
          });
        },
      );
      req.end(body);
    });

    expect(harness.engine.committed).toBe(0);
    harness.engine.hold = false;
    harness.engine.release();
    await waitFor(() => harness.engine.committed === 1);

    const replay = await harness.request({ path: '/api/turn/last' });
    const kinds = parseSse(replay.text).map((e) => (e.data as { kind?: string }).kind);
    expect(kinds).toEqual(['fact', 'flavour', 'done', undefined]);

    // The version moved on, so the old reference is stale.
    const again = await harness.request({ method: 'POST', path: '/api/act', body: { ref } });
    expect(again.status).toBe(409);
    expect(again.json()['error']).toEqual({ code: 'stale-ref' });
  });

  it('lets a reconnecting client follow a turn in progress from its first chunk', async () => {
    h = await startHarness();
    h.engine.hold = true;
    const s = await state(h);
    const harness = h;
    const first = harness.request({ method: 'POST', path: '/api/act', body: { ref: (s.actions[0] as { ref: string }).ref } });
    await waitFor(() => harness.engine.calls.some((c) => c.startsWith('act:')));
    const replay = harness.request({ path: '/api/turn/last' });
    harness.engine.release();
    const events = parseSse((await replay).text);
    expect(events.map((e) => e.event)).toEqual(['chunk', 'chunk', 'chunk', 'end']);
    await first;
  });

  it('has no last turn before one has run', async () => {
    h = await startHarness();
    expect((await h.request({ path: '/api/turn/last' })).status).toBe(404);
  });

  it('exposes a paused turn, refuses other changes, and retries through the engine', async () => {
    h = await startHarness();
    h.engine.pauseNext = true;
    const s = await state(h);
    const ref = (s.actions[0] as { ref: string }).ref;
    const res = await h.request({ method: 'POST', path: '/api/act', body: { ref } });
    const kinds = parseSse(res.text).map((e) => (e.data as { kind?: string }).kind);
    expect(kinds).toEqual(['fact', 'paused', undefined]);

    const paused = (await h.request({ path: '/api/state' })).json();
    expect(paused['paused']).toBe(true);
    expect(paused['pausedInfo']).toEqual({ endpoint: 'fast', message: 'unreachable' });

    const refused = await h.request({ method: 'POST', path: '/api/say', body: { line: 'hi' } });
    expect(refused.status).toBe(409);
    expect(refused.json()['error']).toEqual({ code: 'paused' });

    const retried = await h.request({ method: 'POST', path: '/api/retry', body: {} });
    expect(retried.status).toBe(200);
    expect(h.engine.calls).toContain('retry');
    expect((await h.request({ path: '/api/state' })).json()['paused']).toBe(false);
  });

  it('refuses a retry when nothing is paused', async () => {
    h = await startHarness();
    const r = await h.request({ method: 'POST', path: '/api/retry', body: {} });
    expect(r.status).toBe(409);
  });

  it('streams a terminal event with a typed error when the turn throws', async () => {
    h = await startHarness();
    h.engine.api.endScene = () => {
      throw new Error('boom with /secret/path');
    };
    const r = await h.request({ method: 'POST', path: '/api/end-scene', body: {} });
    const events = parseSse(r.text);
    expect(events.at(-1)).toEqual({ event: 'end', data: { ok: false, error: { code: 'internal' } } });
    expect(r.text).not.toContain('secret');
  });
});

describe('other operations', () => {
  it('relays say, case file, notes and dismiss to the matching engine method', async () => {
    h = await startHarness();
    expect((await h.request({ method: 'POST', path: '/api/say', body: { line: 'good evening', offer: 20 } })).status).toBe(200);
    expect(h.engine.calls).toContain('say:good evening');
    expect((await h.request({ method: 'POST', path: '/api/casefile/grade', body: { id: 'claim:1', grade: { reliability: 'B', credibility: 2 } } })).status).toBe(200);
    expect((await h.request({ method: 'POST', path: '/api/casefile/grade', body: { id: 'claim:1', grade: { reliability: 'Z', credibility: 9 } } })).status).toBe(400);
    expect((await h.request({ method: 'POST', path: '/api/casefile/link', body: { a: 'claim:1', b: 'claim:2' } })).status).toBe(200);
    expect((await h.request({ method: 'POST', path: '/api/casefile/unlink', body: { a: 'claim:1', b: 'claim:2' } })).status).toBe(200);
    expect((await h.request({ method: 'POST', path: '/api/notes', body: { attachTo: 'npc:viktor', text: 'nervous' } })).status).toBe(200);
    expect((await h.request({ method: 'POST', path: '/api/notifications/n1/dismiss', body: {} })).status).toBe(200);
    expect(h.engine.calls).toEqual(expect.arrayContaining(['grade', 'link', 'unlink', 'notes', 'dismiss']));
  });

  it('maps a load failure to a typed load-error and a success to a new version', async () => {
    h = await startHarness();
    const bad = await h.request({ method: 'POST', path: '/api/saves/broken/load', body: {} });
    expect(bad.status).toBe(409);
    expect(bad.json()['error']).toEqual({ code: 'load-error', error: { kind: 'corrupt' } });
    const before = (await state(h)).stateVersion;
    const good = await h.request({ method: 'POST', path: '/api/saves/good/load', body: {} });
    expect(good.status).toBe(200);
    expect((await state(h)).stateVersion).toBe(before + 1);
    expect((await h.request({ method: 'POST', path: '/api/saves/' + encodeURIComponent('../etc') + '/load', body: {} })).status).toBe(400);
  });

  it('starts a game and bumps the version', async () => {
    h = await startHarness({}, { started: false });
    const r = await h.request({ method: 'POST', path: '/api/new-game', body: { preset: 'standard', mole: false, narration: 'off' } });
    expect(r.status).toBe(200);
    expect((await h.request({ path: '/api/state' })).json()['started']).toBe(true);
    expect((await h.request({ method: 'POST', path: '/api/new-game', body: { preset: 'standard', mole: 'yes', narration: 'off' } })).status).toBe(400);
  });

  it('streams notifications on /api/events and unsubscribes when the client closes', async () => {
    h = await startHarness();
    const harness = h;
    const received: string[] = [];
    const req = httpRequest({ host: '127.0.0.1', port: harness.port, path: '/api/events', headers: { cookie: harness.cookie } }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (c: string) => received.push(c));
    });
    req.end();
    await waitFor(() => harness.engine.subscribers === 1);
    harness.engine.notify({ id: 'n1', kind: 'info', text: 'hello' });
    await waitFor(() => received.join('').includes('event: notification'));
    expect(received.join('')).toContain('"text":"hello"');
    req.destroy();
    await waitFor(() => harness.engine.subscribers === 0);
  });
});

describe('shutdown', () => {
  it('lets the in-flight turn commit before close resolves', async () => {
    h = await startHarness();
    h.engine.hold = true;
    const s = await state(h);
    const harness = h;
    const turn = harness.request({ method: 'POST', path: '/api/act', body: { ref: (s.actions[0] as { ref: string }).ref } }).catch(() => undefined);
    await waitFor(() => harness.engine.calls.some((c) => c.startsWith('act:')));
    let closed = false;
    const closing = harness.server.close().then(() => {
      closed = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(closed).toBe(false);
    harness.engine.release();
    await closing;
    expect(harness.engine.committed).toBe(1);
    await turn;
  });
});
