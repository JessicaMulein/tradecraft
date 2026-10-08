# Ambient + plot-library audit

Playability, tradecraft, expandability and multi-city readiness. Calibration re-measured 8 Oct 2026 on the same seed prefix as CI (`calibration-N`), 8 expert / 5 idle / 5 reckless seeds per preset per mode. Shipped scenario still loads `core` only; neither flag was turned on.



Not ready for multi-city

Core (the shipped path) still holds every band. Turning the plot library on collapses every operation to a five-day `plot-completed` — the expert never wins. Ambient alone keeps the ~40-day clock but drops standard/hard expert wins out of the CI bands. Retune those two before starting multi-city 1.1.

Yes

Shipped slice playable

No

Features-on calibrated

4

High findings

Hold

Multi-city 1.1

## Causes

The first pass named the band failures. This pass names the code.

Absolute day-5 deadlines

plot-library

Slice `generatePlot` accumulates each stage as start + Σ (draw(min, max) + slack). Core templates are five stages of 2–12 days, which lands around day 40.

Library `toPlot` (`library.ts`) sets `deadlineDay` to `stage.source.deadline?.max ?? 4` — an absolute day, no min, no slack. Every `coldwar-plots` stage is authored `min: 2, max: 5`, including later branch stages. `slicePlotOf` copies that day onto the slice plot the clock runs.

On day 5 every pending stage whose `requires` are already met executes in the same `advanceLibrary` tick. Failure conditions are `stage-completed` on the last work stage. The Primary resolves, `primaryEnded` fires, and the game ends. Design: “Deadlines. As in the slice, with preset slack.”

Even after that bug is fixed, a 2-stage 2–5 + slack-1 plot only spans about 6–12 days. Content windows have to grow (or stage counts) to match the core ~40-day operation.

Unattendable cover + harder caps

ambient-world

Duties spawn 2–4 per week (`cover.ts`). Missing a mandatory one applies `cover-suspicion-delta` of 0.02–0.03. Daily caps are 0.05 / 0.08 / 0.12. Burn threshold is 0.8.

`attend-duty` is implemented in the engine (`quoteAttendDuty` / `resolveAttendDuty`) and labelled in the TUI, but `action-catalogue.ts` never offers it. The expert cannot attend. Over a 40-day run that is a steady suspicion leak the core path never applies.

Hard allows one day of plot delay (`maxPlotDelayDays: 1`). Expert wins that still land do so late (median 84%, band ≤75%). Two of eight hard seeds burned; two more lost to `plot-completed`. Easy still holds — lower caps, more delay slack, arrest threshold 6.

Re-measure ambient at the CI 30/15 sample only after duties are actually playable. Until then the drift mixes a missing action with real coupling pressure.

### Deadline math (core vs library)

| Source                     | Stage windows                                          | How day is computed                                          | Typical last deadline                |
| :------------------------- | :----------------------------------------------------- | :----------------------------------------------------------- | :----------------------------------- |
| Core generatePlot          | 5 stages, ranges 2–12 (e.g. 4–8, 6–12, 5–10, 3–7, 4–9) | start + Σ (draw(min,max) + slack)                            | ~39–44 days (measured)               |
| Library toPlot (now)       | 2–3 stages, every one min 2 / max 5                    | deadlineDay = max (absolute)                                 | 5.0 days (24/24 library seeds)       |
| Library if slice rule only | Same 2–3 × (2–5) + slack 1                             | Accumulated, as in the slice                                 | ~6–18 days — still short of the band |
| Design (plot-library)      | Example [2,4] then [6,9]                               | As in the slice, plus slack; runtime alts relative to the branch | Staggered windows, not a shared max  |

Source: packages/engine/src/lib/city/plot.ts buildStages; packages/engine/src/lib/plotgen/library.ts toPlot; packages/content/packs/core/plots.yaml; packages/content/packs/coldwar-plots/plots/*.yaml.

## Outcome calibration

Bands: expert win ≥ 80%, median win fraction in [0.35, 0.75], very-early wins ≤ 15%, expert burned ≤ 10%. Idle always `failure-plot`. Reckless burned ≥ 60% on standard and ≥ 75% on hard. CI still measures core only.

### Expert win rate by difficulty (%)

0%50%100%100%100%Easy100%75%Standard100%50%HardCI min 80%

Core (shipped)

Ambient on

Plot library on

Both on

Source: /tmp/tc-audit/calibrate.mts · 8 Oct 2026 · 8 expert seeds per preset · seed prefix calibration-0…7. Value axis is win rate (%). Category axis is difficulty preset.

### Full band check

| Mode            | Easy expert                                  | Standard expert                                         | Hard expert                                                  | Idle                                                | Reckless std / hard |
| :-------------- | :------------------------------------------- | :------------------------------------------------------ | :----------------------------------------------------------- | :-------------------------------------------------- | :------------------ |
| Core (shipped)  | 100% · med 70% · 40.6d · holds · 8 win       | 100% · med 53% · 43.9d · holds · 8 win                  | 100% · med 71% · 38.9d · holds · 8 win                       | 5/5 failure-plot                                    | 100% / 100% · holds |
| Ambient on      | 100% · med 73% · 40.6d · holds · 8 win       | 75% · med 70% · 43.9d · fails · 6 win, 2 plot-completed | 50% · med 84% · 38.9d · fails · 4 win, 2 plot-completed, 2 burned | 5/5 failure-plot                                    | 100% / 100% · holds |
| Plot library on | 0% · med — · 5.0d · fails · 8 plot-completed | 0% · med — · 5.0d · fails · 8 plot-completed            | 0% · med — · 5.0d · fails · 8 plot-completed                 | 5/5 failure-plot (vacuous: everyone loses on day 5) | 0% / 0% · fails     |
| Both on         | 0% · med — · 5.0d · fails · 8 plot-completed | 0% · med — · 5.0d · fails · 8 plot-completed            | 0% · med — · 5.0d · fails · 8 plot-completed                 | 5/5 failure-plot (vacuous: everyone loses on day 5) | 0% / 20% · fails    |

Last 100-seed core measure (unchanged, still the README table): easy 100% / 41%, standard 90% / 53% + 87% reckless, hard 91% / 63% + 97% reckless. This 8-seed prefix is a drift check, not a replacement.

------

## Findings

| Sev  | Area              | Finding                                                      | Do now                                                       |
| :--- | :---------------- | :----------------------------------------------------------- | :----------------------------------------------------------- |
| High | Plot library      | Confirmed: toPlot uses deadline.max as an absolute day. Authored 2–5 on every stage. Last stage executes day 5; failure is stage-completed. Expert 0/24. | Accumulate deadlines like buildStages, then re-author windows/stage counts to a ~40-day operation. |
| High | Ambient           | Confirmed: missed mandatory duties add 0.02–0.03 suspicion and cannot be attended. Hard delay cap is 1 day. Standard 75% / hard 50% + 25% burned. | Catalogue attend-duty, then re-measure at 30/15 before touching caps. |
| High | Duties            | `attend-duty` exists in the engine resolver and TUI labels but is missing from the player-view action catalogue. Duties miss and notify; the player cannot attend. | Add the action before treating ambient as playable.          |
| High | Multi-city        | Starting 1.1 on top of an uncalibrated library clock and drifting ambient bands will bake the wrong durations into a Region. | Hold 1.1 until the two retunes above.                        |
| Med  | Plot library      | False-flag plants stay in twist metadata; inside-man does not rewrite NPC allegiance. Secondaries advance with hidden `stage-executed` and no slice traces. | Materialise twists into Documents/Rumours and give secondaries a player-visible trace before enjoyability review. |
| Med  | Plot library      | Authored stage text is two recycled boilerplate lines. ~8 of 16 full plots bind at rate 0 on the core city. Plot Lab oracle/passive can pass without a bind-and-play proof. | Author real traces; threshold bind rate; point Lab at a city the templates actually bind. |
| Med  | Ambient           | Listing the ambient pack in `packs.load` fails (“file does not correspond to any registered content kind”). Stories, holidays and recollections are unused. News titles are `gazette` / `herald` tokens. Stories view is empty. | Keep catalogue-from-disk. Do not add the pack to the shipped scenario. Wire leftover kinds or drop them from the pack. |
| Med  | Content-expansion | Launcher context has no cities, so a real `setting.city` fails as unknown at play time. City-pack ambient files cannot reach runtime. CE-PLOTBIND fails core plots on authored cities. | Resolve `setting.city` in the launcher before claiming shipped cities are playable. |
| Med  | Goldens           | Replays 01–05 fail: content hash `02fe241d…` → `781f677e…` (core `emigre-fixer` is now `mobile: true`) and 05 gained `ambient.gate.witnesses`. | Do not re-record. `generatorVersion` stays 0.7.0.            |
| Low  | CI                | Engine tsc errors (service-drop, memory, news, carry) and four content-tools lint-rule cycles are pre-existing. Release lint `selected: []` is a no-op. | Out of scope for this audit.                                 |
| Low  | Fidelity          | Ambient 5.1 contract walks 7 days with couplings. `AmbientState` is still one city blob. No `locationOf`, no `region-core` pack, no Region Generator. | Expected; those belong to multi-city 1–3.                    |

------

## Four lenses

Playable

Shipped yes

Default `pnpm play` is still the intended game: core city, slice plot, no ambient, no library. The 8-seed core prefix won 24/24 expert games, idle always lost to the plot, reckless always burned on standard/hard.

Features-on is a config edit, not a second product. Library-on is not a playable mystery — the Primary resolves before the expert has a case. Ambient-on is playable but the expert loses more and later, and cover duties cannot be performed.

Enjoyable

Thin when on

Ambient already ticks a city: Harvest fair, Football derby, Sector checkpoint, Night curfew, missed-duty notices, 120 townsfolk, 10 orgs, 2 outlets. That is the texture the spec promised.

The rest is stub. Newspapers are beat tokens. Stories view is empty. Library secondaries resolve off-map. Stage prose is two recycled lines. A player who turns the flags on gets a louder city and a plot that ends itself.

Tradecraft

Archetypes yes

Templates are the right jobs: border-network, scientist-recruitment, dangle, mole-hunt. Cover suspicion, watchers, Admiralty grading and the Hostile Service are still the spine of the shipped game.

The holes are tradecraft holes, not flavour holes. A cover job you cannot attend is not a cover. A false-flag that never hits the Case File is not a plant. An inside-man who never changes allegiance is a label.

Expandable

Data yes, path no

Packs, the Kind Registry, era, seven libraries and five authored cities are on disk. `generate()` can take a city bundle. Tag-binding and CE-PLOTBIND are the right extension joints.

The play path does not resolve `setting.city`. Ambient city files cannot ride a city pack into runtime. Listing the ambient pack crashes load. Content-expansion is expandable as data, not yet as a shipped city you can type into `scenario.yaml` and play.

------

## Multi-city readiness

Task 5.1 (the `AmbientSimulator` contract, week-long walk, couplings) is done. Tasks 1–4 and 6–15 are open. The next honest start is 1.1 / 2.1 — regional content and the region state model — after the calibration hold is lifted.

| Needed for 1.1+                                              | State                               |
| :----------------------------------------------------------- | :---------------------------------- |
| `region-core` pack, Region Generator, Regional Verifier      | Missing                             |
| `locationOf` / per-city ambient (`Record<CityId, AmbientCityState>`) | Missing — one blob with `cityId`    |
| Generalised services (not Vienna-shaped)                     | Missing                             |
| Slice goldens if `region` stays unset                        | Stay valid; do not re-record        |
| Single-city mode unchanged, debrief stays 8 sections         | Constraint still in force           |
| Library clock ~40 days, not ~5                               | Broken when `plotSelection.enabled` |
| Ambient expert bands on standard/hard                        | Drifting                            |

## Spec map

| Spec                      | Status                             | Shipped play                             |
| :------------------------ | :--------------------------------- | :--------------------------------------- |
| tradecraft                | Done                               | Default path                             |
| slice-integration         | Assembled; playtest (task 20) open | Default path                             |
| content-expansion         | Implemented                        | Core only; launcher ignores setting.city |
| plot-library              | Implemented, opt-in                | Off. Uncalibrated if on.                 |
| ambient-world             | Implemented, opt-in                | Off. Standard/hard drift if on.          |
| campaign-career           | Implemented                        | Separate career loop                     |
| multi-city                | 5.1 done; 1–4, 6–15 open           | Do not start 1.1 yet                     |
| web-shell                 | Spec; `pnpm play:web` exists       | Unchecked tasks                          |
| street-ops                | Spec only                          | —                                        |
| setting-generalization    | Spec only                          | —                                        |
| natural-language-commands | Spec only                          | —                                        |

README updated to match. Constraints kept: no commit, no PR, no `audit.md` edit, no golden re-record, no `generatorVersion` bump, no enable-by-default in `config/scenario.yaml`.

## Work before multi-city 1.1

| #    | Work                                                         | Why it blocks a Region                                       |
| :--- | :----------------------------------------------------------- | :----------------------------------------------------------- |
| 1    | Fix library toPlot to accumulate deadlines like city/plot.ts buildStages (min, max, slack). | A Region of 2–4 cities will inherit a five-day Primary if this stays. |
| 2    | Re-author coldwar-plots stage windows (or stage counts) to a ~40-day spine. Stop copying the same two trace lines. | Slice-rule accumulation on 2–5 × 2 stages is still only 6–12 days. |
| 3    | Add attend-duty to the player-view action catalogue.         | Cover jobs are tradecraft. A Region will keep bleeding suspicion otherwise. |
| 4    | Re-measure core / ambient / plots / features at the CI 30/15 sample. Update bands and the README table together if a deliberate move is accepted. | The 8-seed prefix is a reject, not a new band.               |
| 5    | Then start multi-city 1.1 / 2.1 (region-core, region state). 5.1 is already done. | Goldens stay valid if region stays unset. Do not re-record; generatorVersion stays 0.7.0. |



What this audit did not do

Bands were not retuned. Features were not enabled. Multi-city 1.1 was not started. Goldens were not re-recorded. The 8-seed prefix is enough to reject library-on (0/24) and to flag ambient drift; a 30/15 re-measure should follow the retune, not precede it.