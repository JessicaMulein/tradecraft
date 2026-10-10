/**
 * A typed bluff is transcribed into slot claims. The model does not judge them.
 */

import type { CallInput, Gateway, Role } from '@tradecraft/llm';
import type { ZodType } from 'zod';
import { describe, expect, it } from 'vitest';

import { transcribeBluff } from './bluff-transcript.js';

function gateway(value: unknown): Gateway {
  return {
    structured: async (_role: Role, input: CallInput, schema: ZodType) => {
      const text = typeof input === 'string' ? input : input.map((message) => message.content).join('\n');
      expect(text).toContain('Do not decide');
      expect(text).toContain('from the office');
      return schema.parse(value);
    },
  } as Gateway;
}

describe('transcribeBluff', () => {
  it('keeps allowed slot claims and drops a verdict the model was not asked for', async () => {
    const claims = await transcribeBluff(
      gateway({
        propositions: [
          { slot: 'workplace', value: 'the office' },
          { slot: 'outcome', value: 'pass' },
        ],
      }),
      'from the office',
      ['workplace', 'origin'],
    );
    expect(claims).toEqual([{ slot: 'workplace', value: 'the office' }]);
  });
});
