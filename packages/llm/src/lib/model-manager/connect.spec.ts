import { describe, expect, it, vi } from 'vitest';

import type { LmStudioClient } from './client-interface.js';
import { ConnectionError, connectWithRetry } from './connect.js';
import { makeFakeClient } from './fake-client.js';

/** A no-op sleep so the backoff never adds real delay in tests. */
const noSleep = () => Promise.resolve();

/** A start-server action that succeeds without doing anything. */
const noopStart = () => Promise.resolve();

describe('connectWithRetry', () => {
  it('connects on the first try without starting the server', async () => {
    const client = makeFakeClient([]);
    const connect = vi.fn(() => Promise.resolve(client as LmStudioClient));
    const startServer = vi.fn(noopStart);

    const result = await connectWithRetry({
      connect,
      startServer,
      sleep: noSleep,
    });

    expect(result).toBe(client);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(startServer).not.toHaveBeenCalled();
  });

  it('starts the server when down, then connects on retry', async () => {
    const client = makeFakeClient([]);
    // Simulate "server down" on the first attempt, "up" afterwards. The fake
    // start action flips the flag, so no real server or process is involved.
    let serverUp = false;
    const connect = vi.fn(async () => {
      if (!serverUp) {
        throw new Error('ECONNREFUSED');
      }
      return client as LmStudioClient;
    });
    const startServer = vi.fn(() => {
      serverUp = true;
      return Promise.resolve();
    });

    const result = await connectWithRetry({
      connect,
      startServer,
      sleep: noSleep,
    });

    expect(result).toBe(client);
    // Started exactly once, and only after the first failure.
    expect(startServer).toHaveBeenCalledTimes(1);
    // First attempt failed, second attempt (after start) succeeded.
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('starts the server at most once across several retries', async () => {
    const client = makeFakeClient([]);
    let attempts = 0;
    const connect = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error('still warming up');
      }
      return client as LmStudioClient;
    });
    const startServer = vi.fn(noopStart);

    await connectWithRetry({
      connect,
      startServer,
      maxAttempts: 5,
      sleep: noSleep,
    });

    expect(startServer).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('raises a clear ConnectionError when the server stays down past the cap', async () => {
    const connect = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const startServer = vi.fn(noopStart);

    await expect(
      connectWithRetry({
        connect,
        startServer,
        maxAttempts: 3,
        sleep: noSleep,
      }),
    ).rejects.toBeInstanceOf(ConnectionError);

    // Tried the full cap and attempted to start the server once.
    expect(connect).toHaveBeenCalledTimes(3);
    expect(startServer).toHaveBeenCalledTimes(1);
  });

  it('carries the attempt count and last cause on the ConnectionError', async () => {
    const cause = new Error('ECONNREFUSED');
    const connect = vi.fn(async () => {
      throw cause;
    });

    const error = await connectWithRetry({
      connect,
      startServer: noopStart,
      maxAttempts: 2,
      sleep: noSleep,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConnectionError);
    const ce = error as ConnectionError;
    expect(ce.attempts).toBe(2);
    expect(ce.cause).toBe(cause);
    expect(ce.message).toContain('ECONNREFUSED');
  });

  it('keeps retrying even if `lms server start` itself fails', async () => {
    const client = makeFakeClient([]);
    let serverUp = false;
    const connect = vi.fn(async () => {
      if (!serverUp) throw new Error('down');
      return client as LmStudioClient;
    });
    // Start "fails" (e.g. server already starting) but the server does come up.
    const startServer = vi.fn(() => {
      serverUp = true;
      return Promise.reject(new Error('server already starting'));
    });

    const result = await connectWithRetry({
      connect,
      startServer,
      sleep: noSleep,
    });

    expect(result).toBe(client);
    expect(startServer).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid maxAttempts', async () => {
    await expect(
      connectWithRetry({
        connect: () => Promise.resolve(makeFakeClient([]) as LmStudioClient),
        startServer: noopStart,
        maxAttempts: 0,
        sleep: noSleep,
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('never routes inference through the SDK client', async () => {
    // The connected client the Model Manager hands back exposes only
    // management methods. There is no chat/completion/inference method to call.
    const client = await connectWithRetry({
      connect: () => Promise.resolve(makeFakeClient([]) as LmStudioClient),
      startServer: noopStart,
      sleep: noSleep,
    });

    const surface = client as unknown as Record<string, unknown>;
    expect(surface.chat).toBeUndefined();
    expect(surface.complete).toBeUndefined();
    expect(surface.respond).toBeUndefined();
    expect(surface.completion).toBeUndefined();
    // The only management method present is the downloaded-model listing.
    expect(typeof client.listDownloadedModels).toBe('function');
  });
});
