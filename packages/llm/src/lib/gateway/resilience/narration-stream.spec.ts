import { describe, expect, it, vi } from 'vitest';

import { cancellableNarration } from './narration-stream.js';

/** An async iterable over fixed tokens, with an optional per-token hook. */
async function* tokenSource(
  tokens: string[],
  onYield?: (index: number) => void,
): AsyncGenerator<string> {
  for (let i = 0; i < tokens.length; i++) {
    onYield?.(i);
    yield tokens[i];
  }
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const token of stream) {
    out.push(token);
  }
  return out;
}

describe('cancellableNarration', () => {
  it('passes every token through when never cancelled', async () => {
    const stream = cancellableNarration(
      tokenSource(['The ', 'rain ', 'fell.']),
    );
    await expect(collect(stream)).resolves.toEqual(['The ', 'rain ', 'fell.']);
  });

  it('reports the first sentence boundary', async () => {
    const onFirstSentence = vi.fn();
    const stream = cancellableNarration(
      tokenSource(['A still ', 'night.', ' Then ', 'nothing.']),
      { onFirstSentence },
    );
    await collect(stream);
    expect(onFirstSentence).toHaveBeenCalledTimes(1);
    expect(stream.firstSentenceSeen).toBe(true);
  });

  it('detects a boundary split across tokens', async () => {
    const onFirstSentence = vi.fn();
    const stream = cancellableNarration(
      tokenSource(['The street was quiet', '.']),
      { onFirstSentence },
    );
    await collect(stream);
    expect(onFirstSentence).toHaveBeenCalledTimes(1);
  });

  it('stops the stream when cancelled before the first sentence', async () => {
    // Cancel after the first token is produced but before any sentence ends.
    const stream = cancellableNarration(
      tokenSource(['A low ', 'grey ', 'sky']),
    );

    const out: string[] = [];
    for await (const token of stream) {
      out.push(token);
      stream.cancel();
    }

    expect(stream.cancelled).toBe(true);
    // No further tokens are released once cancelled before a sentence.
    expect(out).toEqual(['A low ']);
  });

  it('ignores cancel once the first sentence is seen', async () => {
    const stream = cancellableNarration(
      tokenSource(['It was over.', ' The ', 'room ', 'emptied.']),
    );

    const out: string[] = [];
    for await (const token of stream) {
      out.push(token);
      // Try to cancel after each token; the first already ended a sentence.
      stream.cancel();
    }

    expect(stream.cancelled).toBe(false);
    expect(out).toEqual(['It was over.', ' The ', 'room ', 'emptied.']);
  });

  it('aborts the supplied controller on a pre-first-sentence cancel', async () => {
    const controller = new AbortController();
    const stream = cancellableNarration(tokenSource(['grey ', 'light']), {
      controller,
    });

    for await (const token of stream) {
      void token;
      stream.cancel();
    }
    expect(controller.signal.aborted).toBe(true);
  });

  it('does not abort the controller when cancel is a no-op after a sentence', async () => {
    const controller = new AbortController();
    const stream = cancellableNarration(tokenSource(['Done.']), {
      controller,
    });
    for await (const token of stream) {
      void token;
      stream.cancel();
    }
    expect(controller.signal.aborted).toBe(false);
  });
});
