# content-tools

The Tradecraft content authoring tools. This is a **dev-only** package: it is run
through `pnpm content <command>` and no runtime package (`engine`, `dialogue`,
`llm`, `player-view`, `tui`) imports it (Req 16.1, enforced by the
`no-content-tools-in-runtime` dependency-cruiser rule).

`content-tools` may import `content`, `engine`, `player-view` and `llm`.

## Layout

- `src/cli.ts` — the `pnpm content` command dispatcher.
- `src/lint/` — the Pack Linter (tasks 5.2–5.4).
- `src/preview/` — the Preview CLI (task 5.9).
- `src/coverage/` — the Coverage Report (task 5.11).
- `src/author/` — the offline Authoring Aid and promotion (task 5.13).

The subcommands are stubbed here and fleshed out by tasks 5.2–5.13.

## Usage

```
pnpm content <lint|preview|coverage|author|promote> [options]
```

## Running unit tests

Run `nx test @tradecraft/content-tools` to execute the tests via
[Vitest](https://vitest.dev/).
