# Web shell

`pnpm play:web` runs the game in your browser instead of the terminal. It starts
the same models and the same game as `pnpm play`, then serves a page on
`127.0.0.1` only. Nothing is reachable from other machines, and there is no
setting to change that.

## Running it

```sh
pnpm install          # once, after pulling (Express is a new dependency)
pnpm play:web
```

The terminal prints one link of the form `http://127.0.0.1:<port>/launch?token=...`
and, if `openBrowser` is on, opens it for you. The link carries a random token
made fresh each time you start. Opening it sets a session cookie and redirects to
the game. Keep the link to yourself: anyone on this computer who has it can play
as you until you stop the program. Press Ctrl+C to stop; a turn in progress
finishes and saves first.

Scripts can use the same token as `Authorization: Bearer <token>`.

## Settings (`config/web.yaml`)

| key | default | meaning |
| --- | --- | --- |
| `port` | `0` | `0` picks any free port |
| `openBrowser` | `true` | open the launch link automatically |
| `soundtrackDir` | `soundtrack` | where the music and `cue-map.yaml` live |
| `audioFormats` | `[opus, mp3]` | preferred file formats, in order |

A `host` key is rejected on purpose.

## Music

`soundtrack/cue-map.yaml` says which track plays when; it is checked when the
server starts and errors name the file and rule. `soundtrack/take-meta.yaml`
holds per-take timing (for example the first 68 seconds of Burned used for the
"plot completes" ending). Files named `Café.mp3` and `Café 2.mp3` are two takes
of one cue; the player picks one at random, never the same twice in a row.

The browser plays MP3 by default. For smaller, loop-friendly files run
`pnpm soundtrack:encode` (needs `ffmpeg`), which writes Opus files to the
git-ignored `soundtrack/web/`. Browsers only start audio after you click or press
a key, so the title music begins on your first interaction.

The music reads only what you can already see on screen (screen, district,
location tags, phase, your last action). It cannot tell you anything the game has
not shown you.

## Scene images

Scene images are optional. With no image provider configured the shell runs
without them. A provider can be supplied through `SceneFrameProvider`; results are
cached under `.cache/frames/`, and a failure never affects play.

## Tests

`pnpm --filter @tradecraft/web test` covers security, the API and the audio
director. `pnpm --filter @tradecraft/app test` includes the launcher and a
parity check that every page the shell serves equals what the Player View
returns.
