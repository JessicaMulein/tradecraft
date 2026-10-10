# Street ops

Street ops puts the player in a car. It is off unless a scenario sets
`streetOps.enabled` to `true`. With it off, generation, saves and the golden
replays stay as they are without the add-on.

The shipped graph is the hand-authored Inner Court in
`packages/content/packs/street-ops-core`. It is original geometry for the demo
and the tests. A larger city is built on your machine from a named source and
is not committed.

## Enabling it

In the scenario file:

```yaml
streetOps:
  enabled: true
```

Turning the flag on loads `street-ops-core` and the city packs it needs, when
those directories are in the checkout. The default `config/scenario.yaml`
leaves the add-on off, so a normal game never loads them.

The player keeps the Core City start. Inner Court is pinned to that place, and
the station issues one pool car: the staff saloon, or the covered van when the
cover is a commercial warehouse job. Other cars can be hired at a curb. A built
graph's attribution is listed in Help.

`ticksPerPhase` defaults to 360. `sightRangeM` defaults to 250. A lost tail
drops after `lostTimeoutPhases` (default 2). A navigation aid stays off unless
`navigationAid` is set on the runtime that loaded the graph.

## Content kinds

The pack registers these kinds through the content loader. A game that does not
pass them never reads the files.

| Kind | What it is |
| --- | --- |
| `street-graph` | Junctions, segments, frontages and checkpoints |
| `vehicle` | A car the player can take, with hiding spots |
| `evasion-maneuver` | A turn that can lose a tail |
| `surveillance-method` | How a service follows |
| `tail-profile` | A service's team size and discipline |
| `checkpoint-kind` | What a post searches and how hard |
| `street-story` | A cover story told at a checkpoint |
| `composure-table` | How steady a passenger stays |
| `map-document` | A map sold at a location, which can be wrong |

## Fetching street data

Sources are named only in `config/street-sources.yaml`. The fetch command prints
the licence and writes under `data/street-sources/`, which git ignores. It
refuses to run until you accept that source by name.

```sh
pnpm content street-data fetch --source openstreetmap --city city-vienna/vienna \
  --area 48.18,16.33,48.23,16.40 --accept-licence openstreetmap
pnpm content street-graph build --data data/street-sources/openstreetmap/city-vienna/vienna \
  --city city-vienna/vienna
```

`street-graph period` follows predecessor names for a year and writes a report
when two names overlap. `street-graph review-sheets` writes one markdown sheet
per tile of the verified area, listing the modern segments and the period map
layers. The built pack lands in `packs/street-ops-local/`, also git-ignored,
with `ATTRIBUTION.md` beside the graph.

## Period fidelity

A graph is `modern-base` (a modern extract with no period review),
`period-checked` (the verified area has no unchecked street) or
`period-authored` (drawn for the period). The Inner Court graph is
period-authored. The linter warns when a `modern-base` graph was retrieved
after the city's period window.

Modern maps of a 1950s city such as Vienna do not match the period. Traffic
directions, bridges, rebuilt blocks, street names and the occupation boundaries
differ. The period-name pass and the imagery sheets are how those differences
become cited overrides. A street outside the verified area loads as unmapped:
it is not offered as a turn and it is not drawn.

A 1953 pass for the Ring around the Rathaus and the Danube Canal bridges is
written under `packs/street-ops-local/` and `data/street-sources/`. Neither
directory is committed. Inside the verified area the period report has no
unchecked street. Leopold-Figl-Gasse is Regierungsgasse. Josef-Meinrad-Platz
is not yet named. Universitätsring is left unmapped: in 1953 the record
overlaps Dr.-Karl-Lueger-Ring and Ring des 12. November, and the pass does
not pick one. The 1938 and 1956 aerials show the canal bridges and the Ring;
they do not label streets. The war-damage plan and the 1912 plan named in
the source file are not on the current city map service.

## Calibrated rates

These are the shipped figures, pinned by the engine budget test.

- A lead tail vehicle follows one segment behind. The other vehicles in the
  team follow two segments behind.
- Notice uses base 0.45. A regular innocent vehicle is drawn at rate 0.35.
  On a street with traffic level 2, a tail of discipline 0.7 and
  conspicuousness 0.5 is noticed less than 3% of the time. Ordinary traffic
  of conspicuousness 0.5 is noticed more often than that tail.
- A sector-line search (thoroughness 0.6, interior search, suspicion 0.2,
  hiding difficulty 0.4, composure 0.5) finds that hiding place a bit more
  than two times in three. A document halt (thoroughness 0.3, visual search,
  the same cargo) finds it less often.
- One model-free drive step on the shipped graph is budgeted at 50 ms on the
  reference machine. Continuous integration allows eight times that.
