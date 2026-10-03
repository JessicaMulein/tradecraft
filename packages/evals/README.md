# evals

The Tradecraft eval harness.

## Golden replays (task 21.4; Req 17.4)

`replays/` holds small, checked-in golden replay sessions. Each fixture is a
directory with:

- `session.json` — the seed, the planned action log and the `models.yaml`
  config the session was recorded under.
- `recording.jsonl` — the recorded model calls the `ReplayGateway` serves from
  (one `CallRecord` per line). The current golden sessions are model-free
  (`wait`/`travel`), so their recordings are empty — the replay is still wired
  through a real `ReplayGateway`, which reaches no live model.
- `expected.json` — the golden artifact: the reproduced final `WorldState`, its
  stable hash and the reproduced action log.

`src/lib/replays/golden-replay.spec.ts` is the CI gate: it loads every fixture,
replays it end to end through the `ReplayGateway` (no endpoint), and asserts the
reproduced artifact deep-equals `expected.json`, failing loudly on any mismatch.

### Re-recording

Any intentional generator or core-pack change bumps `generatorVersion` or the
pack version and re-records the goldens:

```
pnpm --filter @tradecraft/evals exec <ts-runner> scripts/record-golden.ts
```

(The sessions are deterministic, so a re-record reproduces identical files
unless the world generator or core pack changed.)

## Running unit tests

Run `nx test @tradecraft/evals` to execute the tests via [Vitest](https://vitest.dev/).
