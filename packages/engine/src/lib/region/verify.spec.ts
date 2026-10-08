import { describe, expect, it } from 'vitest';

import { applyRegionalChange, verifyRegion, type RegionGraph, type RegionWitness } from './verify.js';

function graph(paths: readonly RegionWitness[], patch?: Partial<RegionGraph>): RegionGraph {
  return {
    papers: [],
    obtainablePapers: [],
    knownLocs: ['loc:cafe'],
    targets: [{ key: 'prop:meet', paths }],
    jurisdiction: [{ city: 'city:home', permitsArrest: true }],
    success: ['arrest'],
    handoffAt: [],
    abortRoutes: [],
    ...patch,
  };
}

const human = (patch?: Partial<RegionWitness>): RegionWitness => ({
  role: 'human',
  edge: 'meeting',
  node: 'npc:ada',
  ...patch,
});

const signal = (patch?: Partial<RegionWitness>): RegionWitness => ({
  role: 'signal',
  edge: 'surveillance',
  node: 'loc:cafe',
  ...patch,
});

describe('Regional Verifier', () => {
  it('covers a target with disjoint human and signal paths', () => {
    const checked = verifyRegion(graph([human(), signal()]));
    expect([...checked.solvable]).toEqual(['prop:meet']);
    expect(checked.ok).toBe(true);
    expect(checked.witnesses.get('prop:meet')?.[0]).toEqual({ edge: 'meeting', node: 'npc:ada' });
    expect(checked.witnesses.get('prop:meet')?.[1]).toEqual({ edge: 'surveillance', node: 'loc:cafe' });
  });

  it('rejects two paths that share a liaison service', () => {
    const shared = verifyRegion(
      graph([
        human({ edge: 'liaison', liaison: 'service:liaison' }),
        signal({ edge: 'liaison', liaison: 'service:liaison' }),
      ]),
    );
    expect(shared.solvable.size).toBe(0);
    const split = verifyRegion(
      graph([
        human({ edge: 'liaison', liaison: 'service:east' }),
        signal({ edge: 'courier', node: 'line:west', liaison: 'service:west' }),
      ]),
    );
    expect([...split.solvable]).toEqual(['prop:meet']);
    expect(split.witnesses.get('prop:meet')?.[1].edge).toBe('intercept');
  });

  it('requires papers for a travel edge and obtainable papers satisfy it', () => {
    const witness = human({ edge: 'travel', route: 'route:a|b', requiresPapers: ['papers:visa'] });
    expect(verifyRegion(graph([witness, signal()])).solvable.size).toBe(0);
    const held = verifyRegion(graph([witness, signal()], { obtainablePapers: ['papers:visa'] }));
    expect([...held.solvable]).toEqual(['prop:meet']);
  });

  it('drops a key when a route closure removes its only human path', () => {
    const start = graph(
      [human({ edge: 'carriage', route: 'route:a|b' }), signal({ edge: 'terminal', node: 'loc:platform' })],
      { success: ['handoff'], jurisdiction: [{ city: 'city:east', permitsArrest: false }], handoffAt: ['loc:platform'] },
    );
    expect(verifyRegion(start).ok).toBe(true);
    const closed = applyRegionalChange(start, { kind: 'route-closure', a: 'b', b: 'a' });
    expect(verifyRegion(closed).solvable.size).toBe(0);
  });

  it('keeps a key when a closed location is only a spare signal', () => {
    const start = graph([
      human(),
      signal({ node: 'loc:park' }),
      signal({ node: 'loc:cafe' }),
    ]);
    const closed = applyRegionalChange(start, {
      kind: 'location-status',
      locs: ['loc:park'],
      status: 'closed-temporarily',
    });
    expect([...verifyRegion(closed).solvable]).toEqual(['prop:meet']);
  });

  it('fails jurisdiction when arrest is forbidden and the handoff terminal closes', () => {
    const start = graph([human(), signal()], {
      jurisdiction: [{ city: 'city:east', permitsArrest: false }],
      success: ['handoff'],
      handoffAt: ['loc:platform'],
    });
    expect(verifyRegion(start).ok).toBe(true);
    const closed = applyRegionalChange(start, {
      kind: 'location-status',
      locs: ['loc:platform'],
      status: 'closed-temporarily',
    });
    const checked = verifyRegion(closed);
    expect(checked.ok).toBe(false);
    expect(checked.solvable.size).toBe(0);
  });

  it('drops a detained witness and a channel that goes dark', () => {
    const detained = applyRegionalChange(graph([human(), signal()]), {
      kind: 'detain-npc',
      npc: 'npc:ada',
    });
    expect(verifyRegion(detained).solvable.size).toBe(0);
    const dark = applyRegionalChange(
      graph([human(), signal({ edge: 'intercept', node: 'chan:radio' })]),
      { kind: 'channel-outage', channel: 'chan:radio' },
    );
    expect(verifyRegion(dark).solvable.size).toBe(0);
  });
});
