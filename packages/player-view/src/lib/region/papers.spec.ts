import { describe, expect, it } from 'vitest';

import { paperViews } from './papers.js';

describe('paper views', () => {
  it('lists held papers without their quality', () => {
    const views = paperViews(['paper:passport'], {
      'paper:passport': {
        id: 'paper:passport',
        kind: 'passport',
        holder: 'player',
        issuedBy: { kind: 'station', id: 'station' },
        satisfies: ['post:north'],
        quality: 0.2,
      },
    });
    expect(views).toEqual([
      {
        id: 'paper:passport',
        kind: 'passport',
        holder: 'player',
        issuedBy: { kind: 'station', id: 'station' },
        satisfies: ['post:north'],
      },
    ]);
    expect(JSON.stringify(views)).not.toContain('quality');
  });
});
