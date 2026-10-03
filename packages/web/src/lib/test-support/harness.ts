import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';

import { parseShellConfig, type ShellConfig } from '../config.js';
import { startShellServer, type ShellDeps, type ShellServer } from '../server.js';
import { createFakeEngine, type FakeEngine } from './fake-engine.js';

export interface Harness {
  readonly engine: FakeEngine;
  readonly server: ShellServer;
  readonly port: number;
  readonly origin: string;
  /** A session cookie obtained through the launch flow. */
  readonly cookie: string;
  request(opts: Req): Promise<Res>;
  /** Open a streaming request and collect text until the end event or a limit. */
  close(): Promise<void>;
}

export interface Req {
  readonly method?: string;
  readonly path: string;
  readonly headers?: Record<string, string | undefined>;
  readonly body?: unknown;
  /** Use the session cookie and a same-origin Origin header (default true). */
  readonly auth?: boolean;
  readonly rawBody?: string;
}

export interface Res {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly text: string;
  readonly json: () => Record<string, unknown>;
}

export async function startHarness(
  config: Partial<Record<string, unknown>> = {},
  deps: ShellDeps = {},
): Promise<Harness> {
  const engine = createFakeEngine();
  const cfg: ShellConfig = parseShellConfig({ port: 0, ...config });
  const server = await startShellServer(engine.api, cfg, {
    random: (n) => Buffer.alloc(n, 7),
    started: true,
    ...deps,
  });
  const port = server.port;
  const origin = `http://127.0.0.1:${port}`;

  const raw = (opts: Req, cookie: string | undefined): Promise<Res> =>
    new Promise((resolve, reject) => {
      const auth = opts.auth ?? true;
      const method = opts.method ?? 'GET';
      const body = opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
      const headers: Record<string, string | number> = {};
      if (auth && cookie !== undefined) headers['cookie'] = cookie;
      if (auth && method !== 'GET') headers['origin'] = origin;
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = Buffer.byteLength(body);
      }
      for (const [k, v] of Object.entries(opts.headers ?? {})) {
        if (v === undefined) delete headers[k.toLowerCase()];
        else headers[k.toLowerCase()] = v;
      }
      const req = httpRequest({ host: '127.0.0.1', port, path: opts.path, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('error', reject);
        res.on('aborted', () => reject(new Error('response aborted')));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text,
            json: () => JSON.parse(text) as Record<string, unknown>,
          });
        });
      });
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    });

  // The launch flow: exchange the token for a session cookie.
  const token = new URL(server.launchUrl).searchParams.get('token') as string;
  const launch = await raw({ path: `/launch?token=${token}`, auth: false }, undefined);
  const setCookie = launch.headers['set-cookie']?.[0] ?? '';
  const cookie = setCookie.split(';')[0] as string;

  return {
    engine,
    server,
    port,
    origin,
    cookie,
    request: (opts) => raw(opts, cookie),
    close: () => server.close(),
  };
}

/** Parse an SSE body into events. */
export function parseSse(text: string): { event: string; data: unknown }[] {
  const out: { event: string; data: unknown }[] = [];
  for (const block of text.split('\n\n')) {
    const lines = block.split('\n').filter((l) => !l.startsWith(':') && l.length > 0);
    if (lines.length === 0) continue;
    const event = lines.find((l) => l.startsWith('event: '))?.slice(7) ?? 'message';
    const data = lines.find((l) => l.startsWith('data: '))?.slice(6);
    out.push({ event, data: data === undefined ? undefined : JSON.parse(data) });
  }
  return out;
}
