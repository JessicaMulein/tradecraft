/** Thin fetch wrappers. Same-origin only; the session cookie rides along. */

export interface ApiError { status: number; code?: string; reason?: string }

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    let body: { error?: { code?: string; reason?: string } } = {};
    try { body = JSON.parse(text) as typeof body; } catch { /* empty body */ }
    const err: ApiError = { status: res.status };
    if (body.error?.code !== undefined) err.code = body.error.code;
    if (body.error?.reason !== undefined) err.reason = body.error.reason;
    throw err;
  }
  return text === '' ? undefined : JSON.parse(text);
}

export async function getJson<T>(path: string): Promise<T> {
  return (await parse(await fetch(path, { credentials: 'same-origin' }))) as T;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return (await parse(res)) as T;
}

export interface SseEvent { event: string; data: unknown }

/** Read an SSE response body incrementally. */
export async function* readSse(res: Response): AsyncGenerator<SseEvent> {
  if (!res.ok || res.body === null) {
    await parse(res);
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (data !== '') yield { event, data: JSON.parse(data) };
    }
  }
}

export function postStream(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
