/**
 * A small in-memory `EngineApi` for the web package's own tests. The real
 * engine is exercised by the integration tests in `packages/app`; this fake
 * only has to behave like the facade does at the HTTP boundary.
 */

import type { ActionOption, EngineApi, TurnChunk } from '@tradecraft/player-view';

export interface FakeEngine {
  readonly api: EngineApi;
  /** Methods called on the engine, in order. */
  readonly calls: string[];
  /** Turns the engine has fully committed. */
  committed: number;
  /** When set, turns wait for `release()` before finishing. */
  hold: boolean;
  release(): void;
  /** Make the next turn pause with this endpoint error. */
  pauseNext: boolean;
  notify(n: unknown): void;
  subscribers: number;
}

export function fakeActions(): ActionOption[] {
  return [
    { action: { kind: 'wait', phases: 1 }, quote: { allowed: true, phases: 1, money: 0 } as never },
    { action: { kind: 'wait', phases: 2 }, quote: { allowed: true, phases: 2, money: 0 } as never },
    { action: { kind: 'pay', npc: 'npc:viktor', amount: 0 }, quote: { allowed: true, phases: 0, money: 0 } as never },
    { action: { kind: 'wait', phases: 4 }, quote: { allowed: false, reason: 'too tired', phases: 4, money: 0 } as never },
  ];
}

export function createFakeEngine(): FakeEngine {
  const calls: string[] = [];
  let releaseFn: (() => void) | undefined;
  const subscribers = new Set<(n: unknown) => void>();

  const fake: FakeEngine = {
    calls,
    committed: 0,
    hold: false,
    pauseNext: false,
    subscribers: 0,
    release: () => releaseFn?.(),
    notify: (n) => subscribers.forEach((f) => f(n)),
    api: undefined as unknown as EngineApi,
  };

  async function* turn(name: string): AsyncGenerator<TurnChunk> {
    calls.push(name);
    yield { kind: 'fact', text: `fact from ${name}` };
    if (fake.hold) {
      await new Promise<void>((resolve) => {
        releaseFn = resolve;
      });
    }
    if (fake.pauseNext) {
      fake.pauseNext = false;
      yield { kind: 'paused', error: { endpoint: 'fast', message: 'unreachable' } };
      return;
    }
    yield { kind: 'flavour', text: 'the rain falls' };
    fake.committed += 1;
    yield { kind: 'done' };
  }

  const api = {
    newGame: async () => {
      calls.push('newGame');
      return { status: api.status(), seed: 's', preset: 'p', brief: { id: 'doc:brief' } };
    },
    status: () => ({ time: { day: 1, phase: 'morning' }, location: { id: 'loc:a', name: 'A' }, budget: 10, standing: 5, ended: false }),
    actions: () => fakeActions(),
    quote: (a: unknown) => {
      calls.push('quote');
      const hit = fakeActions().find((o) => JSON.stringify(o.action) === JSON.stringify(a));
      return hit?.quote ?? { allowed: true, phases: 1, money: 0 };
    },
    act: (a: unknown) => turn(`act:${JSON.stringify(a)}`),
    say: (line: string) => turn(`say:${line}`),
    endScene: () => turn('endScene'),
    retry: () => turn('retry'),
    validateFeed: () => ({ ok: true, value: undefined }),
    caseFile: {
      list: () => [],
      grade: () => calls.push('grade'),
      link: () => calls.push('link'),
      unlink: () => calls.push('unlink'),
      evidence: () => 0,
    },
    notes: { add: () => calls.push('notes') },
    views: {
      scene: () => ({
        location: { id: 'loc:a', name: 'A', type: 'kaffeehaus', tags: ['sector:american', 'type:kaffeehaus'], district: { id: 'district:1', name: 'Inner' }, description: 'A room.', atmosphere: ['smoky'], risk: 1 },
        time: { day: 1, phase: 'morning' },
        weather: 'clear',
        crowd: 'quiet',
        visible: [{ id: 'unk:1', label: 'a man in a grey coat' }],
      }),
      here: () => ({
        location: { id: 'loc:a', name: 'A', type: 'kaffeehaus', tags: ['sector:american', 'type:kaffeehaus'], district: { id: 'district:1', name: 'Inner' }, atmosphere: ['smoky'], risk: 1, public: true },
        crowd: 'quiet',
        weather: 'clear',
        visible: [{ id: 'unk:1', label: 'a man in a grey coat' }],
      }),
      journal: () => ({ days: [], entries: [], notes: [] }),
      map: () => ({ here: 'loc:a', districts: [], deadDrops: [] }),
      city: () => ({ events: [] }),
      stories: () => ({ stories: [] }),
      duties: () => ({ standing: 0, band: 'fair' as const, duties: [] }),
      people: () => ({ people: [] }),
      documents: () => ({ documents: [] }),
      document: (id: string) => (id === 'doc:real' ? { id, title: 'Real' } : undefined),
      intercepts: () => ({ intercepts: [] }),
      workbench: (id: string) => {
        if (id !== 'int:1') throw new Error('unknown');
        return { id };
      },
      help: () => ({ actions: [], glossary: [] }),
      debrief: () => null,
      region: () => null,
      departures: () => [],
      papers: () => [],
      carriage: () => null,
      street: () => null,
    },
    notifications: {
      list: () => [],
      dismiss: () => calls.push('dismiss'),
      subscribe: (fn: (n: unknown) => void) => {
        subscribers.add(fn);
        fake.subscribers = subscribers.size;
        return () => {
          subscribers.delete(fn);
          fake.subscribers = subscribers.size;
        };
      },
    },
    saves: {
      list: () => [],
      save: async (name: string) => ({ name }),
      load: async (name: string) =>
        name === 'good'
          ? { ok: true as const, value: { status: api.status(), seed: 's', preset: 'p', brief: { id: 'doc:brief' } } }
          : { ok: false as const, error: { kind: 'corrupt' as const } },
    },
  };
  (fake as { api: EngineApi }).api = api as unknown as EngineApi;
  return fake;
}
