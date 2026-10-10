/**
 * The note on the wire is words. The private field message stays the engine's.
 */
import { describe, expect, it } from 'vitest';

import type { Proposition } from '../model/core.js';
import { operationalPlaintext } from './operational.js';

describe('operationalPlaintext', () => {
  it('writes a meeting and a channel check as sentences', () => {
    const props: Proposition[] = [
      {
        id: 'p:0',
        subject: 'npc:friedrich-pichler-0',
        predicate: 'MEETS_AT',
        object: 'npc:tamara-panov-4',
        place: 'loc:cafe-mohnblume-2',
        window: { from: { day: 4, phase: 0 } },
      },
      {
        id: 'p:1',
        subject: 'org:noise-diplomatic',
        predicate: 'USES_CHANNEL',
        object: { kind: 'text', value: 'chan:noise/0/diplomatic' },
      },
    ];
    expect(operationalPlaintext(props)).toBe(
      [
        'FRIEDRICH PICHLER TRIFFT TAMARA PANOV BEI CAFE MOHNBLUME TAG 4 MORGENS',
        'NOISE DIPLOMATIC KANAL DIPLOMATIC',
      ].join('\n'),
    );
  });

  it('uses a glossary name when one was supplied', () => {
    const props: Proposition[] = [
      {
        id: 'p:0',
        subject: 'npc:ana',
        predicate: 'LOCATED_AT',
        object: 'loc:cafe',
        place: 'loc:cafe',
      },
    ];
    const names = new Map<string, string>([
      ['npc:ana', 'Anna Berger'],
      ['loc:cafe', 'Café Mozart'],
    ]);
    expect(operationalPlaintext(props, names)).toBe('ANNA BERGER GESEHEN CAFE MOZART');
  });
});
