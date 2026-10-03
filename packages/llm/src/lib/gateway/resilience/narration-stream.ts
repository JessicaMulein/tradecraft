/**
 * The cancellable narration stream (design "LLM Gateway": "A narrator call is
 * cancelled if the player issues the next action before its first sentence").
 *
 * Narration is the one call the player can out-run: it streams Flavour after
 * the Fact Lines are already shown, so if the player types the next action
 * before the Narrator has produced anything worth keeping, the call should be
 * dropped to free the model for the new turn. But once a first sentence exists,
 * cancelling would throw away useful text mid-flight, so cancellation has a
 * cut-off: it is honoured only *before the first sentence boundary*.
 *
 * {@link cancellableNarration} wraps a raw token stream (the Gateway's
 * `stream('narrator', …)`) and returns a {@link NarrationStream}: an async
 * iterable of the same tokens plus a {@link NarrationStream.cancel}. Calling
 * `cancel()` before the first sentence boundary stops the stream — the iterator
 * ends after the token in flight and no further tokens are yielded. Calling it
 * after the first sentence has been seen is a no-op, so a started narration
 * runs to completion. "First sentence boundary" is a token ending in sentence
 * punctuation (`.`, `!`, `?`), the same coarse boundary the narration layer's
 * guards release on; the gateway only needs to know *that* a sentence exists,
 * not to parse it.
 *
 * Cancellation also aborts an {@link AbortController} when one is supplied, so
 * the underlying call (and its slot in the scheduler) is released rather than
 * left running.
 */

/** Characters that close a sentence, used for the first-sentence cut-off. */
const SENTENCE_ENDINGS = /[.!?]["')\]]?\s*$/;

/** A narration token stream that can be cancelled before its first sentence. */
export interface NarrationStream extends AsyncIterable<string> {
  /**
   * Cancel the narration if it has not yet produced a first sentence. A no-op
   * once the first sentence boundary has been seen, so an in-progress narration
   * is never cut off part-way through its opening sentence.
   */
  cancel(): void;
  /** Whether a first sentence boundary has been observed. For tests/metrics. */
  readonly firstSentenceSeen: boolean;
  /** Whether the stream was cancelled before its first sentence. */
  readonly cancelled: boolean;
}

/** Options for {@link cancellableNarration}. */
export interface NarrationStreamOptions {
  /**
   * Aborted when a pre-first-sentence cancel fires, so the underlying call can
   * stop. The Gateway passes the scheduled call's controller.
   */
  readonly controller?: AbortController;
  /**
   * Called the moment the first sentence boundary is observed, before the
   * boundary token is yielded. Lets the caller mark time-to-first-sentence.
   */
  readonly onFirstSentence?: () => void;
}

/** True once `text` (accumulated text) closes a sentence. */
function endsSentence(text: string): boolean {
  return SENTENCE_ENDINGS.test(text);
}

/**
 * Wrap a raw narrator token stream in a {@link NarrationStream}. Tokens pass
 * through in order; the wrapper tracks whether a first sentence boundary has
 * been seen and, until it has, lets {@link NarrationStream.cancel} end the
 * stream early.
 */
export function cancellableNarration(
  tokens: AsyncIterable<string>,
  options: NarrationStreamOptions = {},
): NarrationStream {
  const state = { firstSentenceSeen: false, cancelled: false };
  // Accumulates across tokens so a boundary split over tokens ("end", ".")
  // still registers once the punctuation arrives.
  let buffer = '';

  async function* iterate(): AsyncGenerator<string> {
    for await (const token of tokens) {
      // A cancel that landed before any first sentence stops us here.
      if (state.cancelled && !state.firstSentenceSeen) {
        return;
      }

      if (!state.firstSentenceSeen) {
        buffer += token;
        if (endsSentence(buffer)) {
          state.firstSentenceSeen = true;
          options.onFirstSentence?.();
        }
      }

      yield token;
    }
  }

  const generator = iterate();

  return {
    get firstSentenceSeen(): boolean {
      return state.firstSentenceSeen;
    },
    get cancelled(): boolean {
      return state.cancelled;
    },
    cancel(): void {
      if (state.firstSentenceSeen || state.cancelled) {
        return;
      }
      state.cancelled = true;
      options.controller?.abort();
    },
    [Symbol.asyncIterator](): AsyncIterator<string> {
      return generator;
    },
  };
}
