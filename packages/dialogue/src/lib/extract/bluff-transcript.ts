/**
 * Bookkeeping transcription for a typed street bluff.
 *
 * The model copies the statement into slot claims. It does not decide whether
 * the guard believes them. A failed call leaves the local parser to read the text.
 */

import type { Gateway } from '@tradecraft/llm';
import { z } from 'zod';

const TranscriptSchema = z
  .object({
    propositions: z.array(z.object({ slot: z.string(), value: z.string() })),
  })
  .strict();

export async function transcribeBluff(
  gateway: Gateway,
  text: string,
  slots: readonly string[],
): Promise<readonly { readonly slot: string; readonly value: string }[]> {
  const allowed = new Set(slots);
  const value = await gateway.structured(
    'bookkeeping',
    [
      {
        role: 'system',
        content:
          'Transcribe the statement into slot claims. Copy only what was said. Do not decide whether any claim is true, and do not add a pass or fail.',
      },
      { role: 'user', content: `Allowed slots: ${slots.join(', ')}\nStatement:\n${text}` },
    ],
    TranscriptSchema,
  );
  return value.propositions.filter((item) => allowed.has(item.slot) && item.value.trim() !== '');
}
