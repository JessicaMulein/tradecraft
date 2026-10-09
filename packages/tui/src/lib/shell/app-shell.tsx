/**
 * The App Shell — the TUI's top-level Ink component that holds the shell state,
 * routes between the existing screens, and streams turns from the {@link
 * EngineApi} into the pure {@link reduceShell} reducer (slice-integration task
 * 13.2; design, "TUI: App Shell"; Requirements 19.1, 19.2, 19.3, 19.6, 19.7,
 * 19.8).
 *
 * ## What the shell owns
 *
 * - **The shell state** (`./shell.ts`): which {@link Screen} is on display, the
 *   turn transcript, whether a turn is streaming, the status-bar alerts and the
 *   hint toasts. The component holds it with {@link useReducer} over the pure
 *   {@link reduceShell}, so all routing, chunk handling and the streaming input
 *   lock live in one unit-tested place.
 * - **The global key map** (`./key-map.ts`): the component listens with {@link
 *   useInput} and dispatches a `key` event per press; the reducer maps it to a
 *   screen (navigation), the help overlay, the save/load screen or quit. While a
 *   turn streams the reducer refuses turn-starting keys (Req 19.11), and the
 *   component refuses to start a fresh turn while `state.streaming` is true.
 * - **The turn stream**: every turn method on the {@link EngineApi} — `act`,
 *   `say`, `endScene`, `retry` — returns a {@link TurnStream}. The component
 *   consumes it with `for await`, dispatching `turn-start` first and then one
 *   `chunk` event per {@link TurnChunk}, so the reducer folds the stream into the
 *   transcript, the alerts, the toasts and the screen (endpoint-error on
 *   `paused`, game-over on `ended`).
 *
 * ## The flow (Req 19.2)
 *
 * `start` → `newGame` → `brief`. The brief screen shows the Starting Brief Cable
 * and the offer "Meet the Chief of Station in person? (y/n)"; `y` acts `talk`
 * with the Chief and `n` goes straight to the `scene`. From the scene the player
 * navigates with the global key map, opens the action menu with Enter, and acts;
 * in a Talk Scene a typed line goes to `say` and `Esc` to `endScene` (Req 19.8).
 * On `paused` the endpoint-error screen offers retry and save-and-quit (Req
 * 19.6); on `ended` the game-over screen offers the debrief (Req 19.7).
 *
 * ## Boundary (Req 13.5, 19.1)
 *
 * `AppShell` takes only an {@link EngineApi} and the start defaults. Every type
 * it touches is a view-safe `@tradecraft/player-view` shape or a derived view
 * type, and every call into the simulation goes through the facade. Nothing
 * truth-bearing is reachable, and the TUI imports only `@tradecraft/player-view`.
 */

import {
  useCallback,
  useReducer,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type {
  ActionOption,
  DocumentView,
  EngineApi,
  FeedItem,
  GameView,
  KeySubmission,
  NewGameOptions,
  TurnStream,
  CaseFileFilter,
} from '@tradecraft/player-view';
import { TALK_TUTORIAL, tutorialSuggestion } from '@tradecraft/player-view';

/**
 * The engine action a turn is taken on. `player-view` re-exports the action
 * options but not the bare `Action` union, so the shell derives it from an
 * {@link ActionOption}'s `action` field — the same view-safe shape the facade's
 * `act` accepts — rather than reaching into the engine (Req 13.5).
 */
type Action = ActionOption['action'];

import { StartScreen } from '../start/start-screen.js';
import { CableReader } from '../start/cable-reader.js';
import { ScenePane } from '../scene/scene-pane.js';
import { StatusBar } from '../scene/status-bar.js';
import { HerePane } from '../here/here-pane.js';
import { ActionMenu } from '../here/action-menu.js';
import { CaseFileBrowser } from '../casefile/case-file-browser.js';
import { DocumentsPane } from '../documents/documents.js';
import { Workbench } from '../workbench/workbench.js';
import {
  CarriagePane,
  CityPane,
  DeparturesPane,
  DutiesPane,
  JournalPane,
  MapPane,
  PapersPane,
  PeoplePane,
  RegionMapPane,
  StoriesPane,
} from '../views/index.js';
import { FeedComposer } from '../feed/feed-composer.js';
import type { ComposeOptions } from '../feed/feed.js';
import { SaveLoadScreen } from '../save-load/save-load-screen.js';
import { EndpointErrorScreen } from '../endpoint-error/endpoint-error-screen.js';
import { GameOverScreen } from '../game-over/game-over-screen.js';
import { Debrief } from '../debrief/debrief.js';
import { HelpOverlay } from '../overlay/help-overlay.js';
import type {
  AdmiraltyGrade,
  ClaimId,
  EntityId,
} from '../casefile/case-file.js';
import { initialShellState, reduceShell, type ShellState } from './shell.js';
import type { InterceptId, Screen } from './screen.js';

/** The start defaults the launcher threads in (design `AppShell({ defaults })`). */
export interface AppShellDefaults {
  /** A seed to pre-fill on the start screen (Req 1.6); omitted means random. */
  readonly seed?: string;
}

/** Props for {@link AppShell}. */
export interface AppShellProps {
  /** The only surface the shell drives — the player-view facade (Req 19.1). */
  readonly api: EngineApi;
  /** The start defaults (the launcher's `--seed`); optional. */
  readonly defaults?: AppShellDefaults;
}

/**
 * Build the compose-form option lists for the Feed composer from the facade's
 * People view. The composer only needs the known entities to constrain the
 * subject/object fields; predicates and places are left empty here (the composer
 * handles empty option lists by refusing to stage an incomplete Proposition), so
 * the shell can offer the Claim-picking mode without reaching past the facade.
 */
function composeOptions(api: EngineApi): ComposeOptions {
  const people = api.views.people().people;
  const entities = people.map((person) => ({
    value: person.id as EntityId,
    label: person.label,
  }));
  return {
    predicates: [],
    subjects: entities,
    objects: entities,
    places: [],
  };
}

/**
 * The `talk` action for the Chief of Station briefing offer (Req 19.2), or
 * `undefined` when no one is present to talk to. The facade's `actions()` lists
 * a `talk` option per visible NPC with the correctly-typed handle; the shell
 * takes the first so "yes" opens a Talk Scene without the shell having to name
 * the Chief itself.
 */
function chiefTalkAction(api: EngineApi): Action | undefined {
  const talk = api.actions().find((option) => option.action.kind === 'talk');
  return talk?.action;
}

/**
 * The App Shell. Holds the shell state, renders the active {@link Screen}, owns
 * the global key map, and streams every turn method's {@link TurnStream} into the
 * reducer. See the module doc for the flow and the boundary.
 */
export function AppShell({ api, defaults }: AppShellProps): ReactElement {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reduceShell, initialShellState);

  // The game view `newGame`/`load` returned, held so the brief screen and the
  // game-over screen can read the opening status and the brief Cable. `null`
  // until the game starts.
  const [game, setGame] = useState<GameView | null>(null);

  // The NPC of the open Talk Scene, or `null` when no scene is open. The shell
  // tracks it so a typed line routes to `say` and `Esc` to `endScene` (Req 19.8);
  // it is set when a `talk`/`approach` turn opens a scene and cleared on
  // `endScene`. A ref mirrors it so the stream consumer reads the live value.
  const [talkNpc, setTalkNpc] = useState<EntityId | null>(null);
  const talkNpcRef = useRef<EntityId | null>(null);
  talkNpcRef.current = talkNpc;

  // The typed line being composed in a Talk Scene (Req 19.8).
  const [line, setLine] = useState('');

  // Whether the action menu is open on the scene screen (Enter opens it).
  const [menuOpen, setMenuOpen] = useState(false);

  // A live ref to `state.streaming` so the stream-starting callbacks can refuse
  // a second turn without re-subscribing to state on every render.
  const streamingRef = useRef(state.streaming);
  streamingRef.current = state.streaming;

  /**
   * Consume one {@link TurnStream}: dispatch `turn-start`, then one `chunk`
   * event per {@link TurnChunk}. Refuses to start while a turn already streams,
   * enforcing the streaming input lock at the stream boundary (Req 19.11); the
   * reducer enforces it a second time for turn-starting keys.
   */
  const consume = useCallback(
    async (open: () => TurnStream): Promise<void> => {
      if (streamingRef.current) {
        return; // A turn is already streaming; ignore the request (Req 19.11).
      }
      streamingRef.current = true;
      dispatch({ type: 'turn-start' });
      try {
        for await (const chunk of open()) {
          dispatch({ type: 'chunk', chunk });
        }
      } finally {
        // Refresh the game view after a turn so the status bar and views reflect
        // the committed state. `status()` is a cheap pure read.
        setGame((prev) =>
          prev === null ? prev : { ...prev, status: api.status() },
        );
      }
    },
    [api],
  );

  // --- The turn starters, each a facade turn method fed through `consume`. ---

  const act = useCallback(
    (action: Action): void => {
      // Opening a Talk Scene is tracked so later lines route to `say`.
      if (action.kind === 'talk' || action.kind === 'approach') {
        setTalkNpc(action.npc as EntityId);
      }
      void consume(() => api.act(action));
    },
    [api, consume],
  );

  const say = useCallback(
    (text: string, offer?: number): void => {
      void consume(() =>
        api.say(text, offer === undefined ? undefined : { offer }),
      );
    },
    [api, consume],
  );

  const endScene = useCallback((): void => {
    setTalkNpc(null);
    void consume(() => api.endScene());
  }, [api, consume]);

  const retry = useCallback((): void => {
    void consume(() => api.retry());
  }, [api, consume]);

  // --- Navigation helpers. ---

  const navigate = useCallback((screen: Screen): void => {
    dispatch({ type: 'navigate', screen });
  }, []);

  /**
   * Start a new game from the gathered options, then show the brief. `newGame`
   * mints a seed when none was given and returns the opening {@link GameView}.
   */
  const onStart = useCallback(
    (opts: NewGameOptions): void => {
      void (async (): Promise<void> => {
        const view = await api.newGame(opts);
        setGame(view);
        navigate({ kind: 'brief', view });
      })();
    },
    [api, navigate],
  );

  // --- The global key map. Dispatched as `key` events for the reducer; the
  // scene-local Enter/Esc and the brief offer are handled here directly, since
  // they are not global bindings. ---

  useInput((input, key) => {
    const screen = state.screen;

    // The brief screen's in-person-briefing offer (Req 19.2): y acts talk with
    // the Chief, n goes to the scene.
    if (screen.kind === 'brief') {
      if (input === 'y' || input === 'Y') {
        navigate({ kind: 'scene' });
        const chief = chiefTalkAction(api);
        if (chief !== undefined) {
          act(chief);
        }
        return;
      }
      if (input === 'n' || input === 'N') {
        navigate({ kind: 'scene' });
        return;
      }
      return;
    }

    // The scene screen's local keys (not global bindings).
    if (screen.kind === 'scene') {
      // In a Talk Scene, type a line and send it to `say`; Esc ends the scene
      // (Req 19.8). The streaming lock blocks both while a turn streams.
      if (talkNpc !== null) {
        if (key.escape) {
          endScene();
          return;
        }
        if (key.return) {
          if (!state.streaming && line.trim() !== '') {
            say(line.trim());
            setLine('');
          }
          return;
        }
        if (key.backspace || key.delete) {
          setLine((prev) => prev.slice(0, -1));
          return;
        }
        if (input !== '' && !key.ctrl && !key.meta) {
          setLine((prev) => prev + input);
          return;
        }
        return;
      }

      // Outside a Talk Scene, Enter toggles the action menu (Req 19.3). Esc
      // closes it.
      if (key.return) {
        setMenuOpen((prev) => !prev);
        return;
      }
      if (key.escape) {
        setMenuOpen(false);
        return;
      }
    }

    // Esc returns to the scene from any standalone view (Req 19.8: "back to
    // scene"). The game-over and endpoint-error screens own their own menus.
    if (
      key.escape &&
      screen.kind !== 'scene' &&
      screen.kind !== 'endpoint-error' &&
      screen.kind !== 'game-over' &&
      screen.kind !== 'debrief'
    ) {
      navigate({ kind: 'scene' });
      return;
    }

    // Quit (confirmed): `q` on the scene screen exits the app.
    if (input === 'q' && screen.kind === 'scene' && !menuOpen) {
      exit();
      return;
    }

    // Everything else is a global binding routed through the reducer.
    if (input !== '') {
      dispatch({ type: 'key', key: input });
    }
  });

  return (
    <Box flexDirection="column">
      <ScreenView
        state={state}
        game={game}
        api={api}
        talkNpc={talkNpc}
        line={line}
        menuOpen={menuOpen}
        defaults={defaults}
        onStart={onStart}
        onAct={act}
        onRetry={retry}
        onNavigate={navigate}
        onExit={exit}
      />
      {state.overlay === 'help' && (
        <HelpOverlay help={api.views.help()} visible />
      )}
      {state.toasts.length > 0 && (
        // The shell's reducer already folds each `hint` chunk into a toast,
        // firing each hint once (Req 19.10); render the live toasts as a strip.
        <Box flexDirection="column" marginTop={1}>
          {state.toasts.map((toast) => (
            <Text key={toast.id} color="yellow">
              💡 {toast.text}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

/** Props the screen router threads to the active screen. */
interface ScreenViewProps {
  readonly state: ShellState;
  readonly game: GameView | null;
  readonly api: EngineApi;
  readonly talkNpc: EntityId | null;
  readonly line: string;
  readonly menuOpen: boolean;
  readonly defaults?: AppShellDefaults;
  readonly onStart: (opts: NewGameOptions) => void;
  readonly onAct: (action: Action) => void;
  readonly onRetry: () => void;
  readonly onNavigate: (screen: Screen) => void;
  readonly onExit: () => void;
}

/**
 * Render the screen for the active {@link Screen} variant, each wired to the
 * matching existing screen component with its facade-backed view. This is the
 * router half of the shell: it reads the current screen and the live facade
 * views and renders exactly one screen, so the shell never shows two at once.
 */
function ScreenView({
  state,
  game,
  api,
  talkNpc,
  line,
  menuOpen,
  defaults,
  onStart,
  onAct,
  onRetry,
  onNavigate,
  onExit,
}: ScreenViewProps): ReactElement {
  const screen = state.screen;
  switch (screen.kind) {
    case 'start':
      return <StartScreen defaults={defaults} onStart={onStart} />;

    case 'brief':
      return (
        <Box flexDirection="column">
          <Text bold>Briefing Cable</Text>
          <Box marginTop={1}>
            <CableReader document={screen.view.brief} />
          </Box>
          <Box marginTop={1}>
            <Text>Meet the Chief of Station in person? (y/n)</Text>
          </Box>
        </Box>
      );

    case 'scene':
      return (
        <SceneScreen
          api={api}
          state={state}
          talkNpc={talkNpc}
          line={line}
          menuOpen={menuOpen}
          onAct={onAct}
        />
      );

    case 'case-file':
      return <RegionalCaseFile api={api} />;

    case 'documents': {
      const list = api.views.documents();
      const openId = screen.open;
      const selected =
        openId === undefined
          ? -1
          : list.documents.findIndex((entry) => entry.id === openId);
      const document: DocumentView | undefined =
        openId === undefined ? undefined : api.views.document(openId);
      return (
        <DocumentsPane view={list} selected={selected} document={document} />
      );
    }

    case 'workbench': {
      const id = screen.intercept ?? api.views.intercepts().intercepts[0]?.id;
      if (id === undefined) {
        return (
          <Box flexDirection="column">
            <Text bold>Workbench</Text>
            <Text dimColor>No Intercepts collected yet.</Text>
          </Box>
        );
      }
      return (
        <Workbench
          view={api.views.workbench(id as InterceptId)}
          onSubmit={(submission: KeySubmission) =>
            onAct({ kind: 'decrypt', intercept: id as InterceptId, submission })
          }
        />
      );
    }

    case 'journal':
      return <JournalPane journal={api.views.journal()} />;

    case 'map':
      return <MapPane map={api.views.map()} />;

    case 'city':
      return <CityPane view={api.views.city()} />;

    case 'stories':
      return <StoriesPane view={api.views.stories()} />;

    case 'duties':
      return <DutiesPane view={api.views.duties()} />;

    case 'people':
      return <PeoplePane view={api.views.people()} selected={-1} />;

    case 'region':
      return <RegionMapPane view={api.views.region()} />;

    case 'departures':
      return <DeparturesPane view={api.views.departures()} />;

    case 'papers':
      return <PapersPane papers={api.views.papers()} />;

    case 'carriage':
      return <CarriagePane view={api.views.carriage()} />;

    case 'feed':
      return (
        <FeedComposer
          claims={api.caseFile.list({})}
          options={composeOptions(api)}
          validateFeed={(items: readonly FeedItem[]) => api.validateFeed(items)}
          onSubmit={(items: readonly FeedItem[]) =>
            onAct({
              kind: 'feed',
              asset: screen.asset,
              items: [...items],
            } as Action)
          }
        />
      );

    case 'save-load':
      return (
        <SaveLoadScreen
          saves={api.saves.list()}
          onLoad={(name: string) => {
            void (async (): Promise<void> => {
              const result = await api.saves.load(name);
              if (result.ok) {
                onNavigate({ kind: 'scene' });
              }
            })();
          }}
          onSave={(name: string) => {
            void api.saves.save(name);
          }}
          onCancel={() => onNavigate({ kind: 'scene' })}
        />
      );

    case 'endpoint-error':
      return (
        <EndpointErrorScreen
          error={screen.error}
          onRetry={onRetry}
          onSaveAndQuit={() => onNavigate({ kind: 'save-load', mode: 'save' })}
        />
      );

    case 'game-over':
      return (
        <GameOverScreen
          outcome={String(screen.outcome)}
          endedAt={game?.status.time ?? { day: 1, phase: 0 }}
          onDebrief={() => onNavigate({ kind: 'debrief' })}
          onSave={() => onNavigate({ kind: 'save-load', mode: 'save' })}
          onQuit={onExit}
        />
      );

    case 'debrief':
      return <Debrief view={api.views.debrief()} />;

    default: {
      // Exhaustive over the `Screen` union.
      const _never: never = screen;
      return _never;
    }
  }
}

function RegionalCaseFile({ api }: { readonly api: EngineApi }): ReactElement {
  const [filter, setFilter] = useState<CaseFileFilter>({});
  const cities = (api.views.region()?.cities ?? []).map((city) => city.id);
  return (
    <CaseFileBrowser
      claims={api.caseFile.list(filter)}
      cities={cities}
      onFilter={setFilter}
      onGrade={(id: ClaimId, grade: AdmiraltyGrade) => api.caseFile.grade(id, grade)}
      onLink={(a: ClaimId, b: ClaimId) => api.caseFile.link(a, b)}
      onUnlink={(a: ClaimId, b: ClaimId) => api.caseFile.unlink(a, b)}
    />
  );
}

/** Props for the scene screen (the main gameplay view). */
interface SceneScreenProps {
  readonly api: EngineApi;
  readonly state: ShellState;
  readonly talkNpc: EntityId | null;
  readonly line: string;
  readonly menuOpen: boolean;
  readonly onAct: (action: Action) => void;
}

/**
 * The scene screen: the status bar, the Scene pane with the turn transcript, the
 * Here pane, and — when open — the action menu. In a Talk Scene it shows the
 * typed line and a hint that Esc ends the scene (Req 19.8).
 */
function SceneScreen({
  api,
  state,
  talkNpc,
  line,
  menuOpen,
  onAct,
}: SceneScreenProps): ReactElement {
  const options: readonly ActionOption[] = menuOpen ? api.actions() : [];
  const suggestion =
    talkNpc !== null ? TALK_TUTORIAL : tutorialSuggestion(api)?.text;
  const latestAlert = state.alerts.at(-1);
  const dutyAlert = [...state.alerts]
    .reverse()
    .find(
      (alert) =>
        alert.kind === 'cover-duty-due' ||
        alert.kind === 'cover-duty-missed' ||
        alert.kind === 'cover-employer-message',
    );
  return (
    <Box flexDirection="column">
      <StatusBar status={api.status()} dutyAlert={dutyAlert?.factLine} />
      {latestAlert !== undefined && (
        <Box>
          <Text color="yellow">{latestAlert.factLine}</Text>
        </Box>
      )}
      <Box flexDirection="row" marginTop={1}>
        <Box flexDirection="column" marginRight={2}>
          <ScenePane scene={api.views.scene()} lines={state.transcript.lines} />
        </Box>
        <Box flexDirection="column">
          <HerePane here={api.views.here()} />
        </Box>
      </Box>
      {suggestion !== undefined && (
        <Box marginTop={1}>
          <Text color="yellow">{suggestion}</Text>
        </Box>
      )}
      {talkNpc !== null && (
        <Box marginTop={1} flexDirection="column">
          <Text>
            {'> '}
            {line}
            {state.streaming ? '' : '_'}
          </Text>
          <Text dimColor>
            Type a line, Enter to say it · Esc to end the scene
          </Text>
        </Box>
      )}
      {menuOpen && talkNpc === null && (
        <Box marginTop={1}>
          <ActionMenu
            options={options}
            onChoose={(option) => {
              if (option.quote.allowed) {
                onAct(option.action);
              }
            }}
          />
        </Box>
      )}
    </Box>
  );
}
