/**
 * Unit and snapshot tests for the App Shell component (slice-integration task
 * 13.5; design, "TUI: App Shell"; Requirements 19.2, 19.3, 19.4, 19.5, 19.6,
 * 19.7, 19.8, 19.9). The pure reducer is covered by `shell.spec.ts` (task 13.1)
 * and the streaming input lock by the shell-input-lock property (task 13.4);
 * this file drives the real {@link AppShell} Ink component with
 * `ink-testing-library` and a scripted stub {@link EngineApi}, so the wiring the
 * reducer cannot see — the `newGame` → brief → scene flow, the y/n briefing
 * offer, the navigation keys, consuming a `TurnStream` into the transcript, and
 * the `paused` → endpoint-error and `ended` → game-over transitions — is
 * exercised end to end.
 *
 * The stub drives the component with view-safe fakes only (the shell may import
 * only `@tradecraft/player-view`), and each turn method returns a scripted
 * {@link TurnStream} over a fixed chunk list, so every frame is deterministic.
 * The inline-snapshot style mirrors `feed/feed-composer.snapshot.spec.tsx`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type {
  ActionOption,
  DebriefView,
  DocumentView,
  EngineApi,
  GameView,
  HelpView,
  HereView,
  JournalView,
  MapView,
  NewGameOptions,
  PeopleView,
  SceneView,
  StatusView,
  TurnChunk,
  TurnStream,
} from '@tradecraft/player-view';

import { AppShell } from './app-shell.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** Terminal escape sequences ink decodes into `useInput` key presses. */
const KEY = {
  enter: '\r',
  esc: '\u001B',
} as const;

/** Advance a tick (or a few) so ink flushes input-driven and async re-renders. */
async function tick(times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Strip ANSI colour escapes from a rendered frame. ink emits colour codes only
 * when the runner reports colour support, so the plain text is stable across the
 * direct `vitest` run and the `nx`/CI run.
 */
function plain(frame: string | undefined): string {
  // eslint-disable-next-line no-control-regex
  return (frame ?? '').replace(/\u001B\[[0-9;]*m/g, '');
}

/** A scripted {@link TurnStream} over a fixed chunk list. */
function stream(...chunks: readonly TurnChunk[]): TurnStream {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<TurnChunk> {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

/** A view-safe status bar fake. */
function statusView(): StatusView {
  return {
    time: { day: 1, phase: 0 },
    location: { id: 'loc:cafe' as never, name: 'The Café' },
    budget: 100,
    standing: 3,
    ended: false,
  };
}

/** A view-safe scene fake with one visible NPC. */
function sceneView(): SceneView {
  return {
    location: {
      id: 'loc:cafe' as never,
      name: 'The Café',
      type: 'kaffeehaus',
      tags: ['sector:american', 'type:kaffeehaus'],
      district: { id: 'district:inner', name: 'Innere Stadt' },
      description: 'A quiet café on the corner.',
      atmosphere: ['smoke', 'low chatter'],
      risk: 1,
    },
    time: { day: 1, phase: 0 },
    weather: 'cold and clear',
    crowd: 'sparse',
    visible: [{ id: 'npc:chief' as never, label: 'the Chief of Station' }],
  };
}

/** A view-safe here fake. */
function hereView(): HereView {
  return {
    location: {
      id: 'loc:cafe' as never,
      name: 'The Café',
      type: 'kaffeehaus',
      tags: ['sector:american', 'type:kaffeehaus'],
      district: { id: 'district:inner', name: 'Innere Stadt' },
      atmosphere: ['smoke'],
      risk: 1,
      public: true,
    },
    crowd: 'sparse',
    weather: 'cold and clear',
    visible: [{ id: 'npc:chief' as never, label: 'the Chief of Station' }],
  };
}

/** A view-safe People fake. */
function peopleView(): PeopleView {
  return {
    people: [{ id: 'npc:chief' as never, label: 'the Chief of Station' }],
    orgs: [],
    items: [],
  } as unknown as PeopleView;
}

/** A view-safe Help fake. */
function helpView(): HelpView {
  return {
    location: { id: 'loc:cafe' as never, name: 'The Café' },
    actions: [],
    glossary: [{ term: 'Asset', definition: 'A recruited source.' }],
  };
}

/** A view-safe brief Cable Document fake (shown on the brief screen). */
function briefCable(): DocumentView {
  return {
    id: 'doc:brief' as never,
    kind: 'cable' as never,
    title: 'Opening Brief',
    date: { day: 1, phase: 0 },
    dateLabel: 'Day 1, morning',
    body: 'Welcome to the station.',
    read: false,
  };
}

/** The {@link GameView} `newGame` returns. */
function gameView(): GameView {
  return {
    status: statusView(),
    seed: 'seed-1',
    preset: 'standard',
    brief: briefCable(),
  };
}

/** A `talk` option, so `chiefTalkAction` finds a target for the y/n offer. */
function talkOption(): ActionOption {
  return {
    action: { kind: 'talk', npc: 'npc:chief' as never },
    quote: { allowed: true, phases: 1, money: 0 },
  };
}

/** What a turn method's scripted stream should carry, per harness scenario. */
interface Scripts {
  readonly act?: TurnStream;
  readonly say?: TurnStream;
  readonly endScene?: TurnStream;
  readonly retry?: TurnStream;
}

/**
 * A stub {@link EngineApi} driven by scripted turn streams and view-safe fakes.
 * The turn methods return the stream the scenario supplies (defaulting to a
 * single `done` chunk), so a test fully controls what streams into the shell.
 */
function stubApi(scripts: Scripts = {}): EngineApi {
  const noop = (): void => undefined;
  return {
    newGame: async (_opts: NewGameOptions): Promise<GameView> => gameView(),
    status: statusView,
    actions: (): ActionOption[] => [talkOption()],
    quote: () => talkOption().quote,
    act: (): TurnStream => scripts.act ?? stream({ kind: 'done' }),
    say: (): TurnStream => scripts.say ?? stream({ kind: 'done' }),
    endScene: (): TurnStream => scripts.endScene ?? stream({ kind: 'done' }),
    retry: (): TurnStream => scripts.retry ?? stream({ kind: 'done' }),
    validateFeed: () => ({ ok: true, value: undefined }),
    caseFile: {
      list: () => [],
      grade: noop,
      link: noop,
      unlink: noop,
      evidence: () => 0,
    },
    notes: { add: noop },
    views: {
      scene: sceneView,
      here: hereView,
      journal: (): JournalView => ({ days: [], entries: [], notes: [] }),
      map: (): MapView => ({ districts: [], routes: [], deadDrops: [] }) as unknown as MapView,
      people: peopleView,
      documents: () => ({ documents: [] }) as never,
      document: () => undefined,
      intercepts: () => ({ intercepts: [] }) as never,
      workbench: () => ({ id: 'int:none' }) as never,
      help: helpView,
      debrief: (): DebriefView | null => null,
    },
    notifications: {
      list: () => [],
      dismiss: noop,
      subscribe: () => noop,
    },
    saves: {
      list: () => [],
      save: async () => ({}) as never,
      load: async () => ({ ok: true, value: gameView() }),
    },
  } as EngineApi;
}

/** Render the shell, start a game, and settle on the brief screen. */
async function renderOnBrief(
  api: EngineApi,
): Promise<ReturnType<typeof render>> {
  const app = render(<AppShell api={api} />);
  await tick();
  app.stdin.write(KEY.enter); // confirm the start screen -> newGame -> brief
  await tick(3); // let the async newGame resolve and the brief render
  return app;
}

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// The start → brief → scene flow (Req 19.2)
// ---------------------------------------------------------------------------

describe('AppShell start → brief flow (Req 19.2)', () => {
  it('opens on the start screen', () => {
    const { lastFrame } = render(<AppShell api={stubApi()} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "New Game

      > Seed: (random — generated on start)
        Difficulty: standard
        Internal mole: on
        Narration: full

      ↑/↓ move · ←/→ change · type a seed · Enter to start"
    `);
  });

  it('starts a game and shows the brief Cable with the y/n offer', async () => {
    const { lastFrame } = await renderOnBrief(stubApi());
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Briefing Cable

      Opening Brief
      cable · Day 1, morning

      Welcome to the station.

      Meet the Chief of Station in person? (y/n)"
    `);
  });
});

// ---------------------------------------------------------------------------
// The briefing offer (Req 19.2)
// ---------------------------------------------------------------------------

describe('AppShell briefing offer (Req 19.2)', () => {
  it('`n` goes straight to the scene screen', async () => {
    const { lastFrame, stdin } = await renderOnBrief(stubApi());
    stdin.write('n');
    await tick();
    const frame = plain(lastFrame());
    expect(frame).toContain('The Café');
    expect(frame).not.toContain('Meet the Chief of Station in person?');
  });

  it('`y` opens the scene and starts a talk turn with the Chief', async () => {
    // The talk turn streams one speech line so we can see it folded in.
    const api = stubApi({
      act: stream(
        { kind: 'speech', speaker: 'the Chief of Station', text: 'Good, you made it.' },
        { kind: 'done' },
      ),
    });
    const { lastFrame, stdin } = await renderOnBrief(api);
    stdin.write('y');
    await tick(3);
    const frame = plain(lastFrame());
    expect(frame).toContain('The Café');
    expect(frame).toContain('the Chief of Station: Good, you made it.');
    // In a Talk Scene the typed-line prompt is shown (Req 19.8).
    expect(frame).toContain('Esc to end the scene');
  });
});

// ---------------------------------------------------------------------------
// Navigation keys switching screens (Req 19.3)
// ---------------------------------------------------------------------------

describe('AppShell navigation keys (Req 19.3)', () => {
  async function onScene(api: EngineApi): Promise<ReturnType<typeof render>> {
    const app = await renderOnBrief(api);
    app.stdin.write('n'); // brief -> scene
    await tick();
    return app;
  }

  it('routes `j` to the Journal and Esc back to the scene', async () => {
    const { lastFrame, stdin } = await onScene(stubApi());
    stdin.write('j');
    await tick();
    expect(plain(lastFrame())).toContain('Journal');

    stdin.write(KEY.esc);
    await tick();
    expect(plain(lastFrame())).toContain('The Café');
  });

  it('routes `p` to the People screen', async () => {
    const { lastFrame, stdin } = await onScene(stubApi());
    stdin.write('p');
    await tick();
    expect(plain(lastFrame())).toContain('the Chief of Station');
  });

  it('toggles the help overlay with `?`', async () => {
    const { lastFrame, stdin } = await onScene(stubApi());
    stdin.write('?');
    await tick();
    const frame = plain(lastFrame());
    expect(frame).toContain('Help — The Café');
    expect(frame).toContain('Asset');
  });
});

// ---------------------------------------------------------------------------
// Streaming a turn's chunks into the transcript (Req 19.4)
// ---------------------------------------------------------------------------

describe('AppShell streams turn chunks into the transcript (Req 19.4)', () => {
  it('folds fact and flavour chunks into the scene transcript', async () => {
    const api = stubApi({
      say: stream(
        { kind: 'fact', text: 'You lean in.' },
        { kind: 'flavour', text: 'The chandelier hums.' },
        { kind: 'done' },
      ),
    });
    // Open the scene with a talk turn (y), then type a line and send it.
    const { lastFrame, stdin } = await renderOnBrief(api);
    stdin.write('y');
    await tick(3);
    stdin.write('hello');
    await tick();
    stdin.write(KEY.enter); // say("hello")
    await tick(3);
    const frame = plain(lastFrame());
    expect(frame).toContain('You lean in.');
    expect(frame).toContain('The chandelier hums.');
  });
});

// ---------------------------------------------------------------------------
// paused → endpoint-error and ended → game-over (Req 19.6, 19.7)
// ---------------------------------------------------------------------------

describe('AppShell turn-chunk transitions (Req 19.6, 19.7)', () => {
  it('routes a `paused` chunk to the endpoint-error screen (Req 19.6)', async () => {
    const api = stubApi({
      act: stream({
        kind: 'paused',
        error: { endpoint: 'narrator', message: 'connection refused' },
      }),
    });
    const { lastFrame, stdin } = await renderOnBrief(api);
    stdin.write('y'); // y acts talk -> the scripted act stream pauses
    await tick(3);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Endpoint unreachable
      The endpoint "narrator" could not be reached.
      connection refused

      The turn is paused. Choose how to continue:
      > Retry
        Save and Quit

      ↑/↓ choose · Enter to confirm"
    `);
  });

  it('retry from the endpoint-error screen re-runs the paused turn (Req 19.6)', async () => {
    // The act pauses; choosing Retry calls the facade's `retry()`. The retry
    // then re-pauses, so we can see the endpoint-error screen was reached again
    // from the retry path (the shell drives `retry()`, not another `act`).
    let retryCalls = 0;
    const api = stubApi({
      act: stream({
        kind: 'paused',
        error: { endpoint: 'narrator', message: 'down' },
      }),
    });
    (api as { retry: EngineApi['retry'] }).retry = (): TurnStream => {
      retryCalls += 1;
      return stream({
        kind: 'paused',
        error: { endpoint: 'narrator', message: 'still down' },
      });
    };
    const { lastFrame, stdin } = await renderOnBrief(api);
    stdin.write('y');
    await tick(3);
    expect(plain(lastFrame())).toContain('down');

    stdin.write(KEY.enter); // Retry is highlighted first
    await tick(3);
    expect(retryCalls).toBe(1);
    // The retry re-ran through the facade and re-paused with its own message.
    expect(plain(lastFrame())).toContain('still down');
  });

  it('routes an `ended` chunk to the game-over screen (Req 19.7)', async () => {
    const api = stubApi({
      act: stream({ kind: 'ended', outcome: 'success' as never }),
    });
    const { lastFrame, stdin } = await renderOnBrief(api);
    stdin.write('y'); // y acts talk -> the scripted act stream ends the game
    await tick(3);
    const frame = plain(lastFrame());
    expect(frame).toContain('Ended Day 1, morning');
    expect(frame).toContain('Cause: success');
    expect(frame).toContain('Open Debrief');
  });
});

// ---------------------------------------------------------------------------
// Status-bar alerts (Req 19.9)
// ---------------------------------------------------------------------------

describe('AppShell status-bar alerts (Req 19.9)', () => {
  it('shows a notification chunk as a status-bar alert on the scene', async () => {
    const api = stubApi({
      act: stream(
        {
          kind: 'notification',
          n: {
            id: 'notification:1',
            kind: 'cable',
            at: { day: 1, phase: 0 },
            dismissed: false,
            factLine: 'A Cable has arrived from the Station.',
          } as never,
        },
        { kind: 'done' },
      ),
    });
    const { lastFrame, stdin } = await renderOnBrief(api);
    stdin.write('y'); // y acts talk -> the scripted act stream raises a notice
    await tick(3);
    expect(plain(lastFrame())).toContain('A Cable has arrived from the Station.');
  });
});
