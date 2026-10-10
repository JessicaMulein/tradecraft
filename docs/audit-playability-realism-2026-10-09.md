# Tradecraft audit: playability, enjoyability, realism

Oct 9, 2026 · @Jessica Mulein

## Verdict

Tradecraft has an unusually strong engine, but a human player can't win the game it currently ships. The simulation, the plots and the fairness rules are solid. Most of what fails is in what reaches the player.

- **Arrests come only from codebreaking.** A bot that sees only what a player sees, but breaks every intercept perfectly, wins 12 of 12 standard games. The same bot without codebreaking wins 0 of 12 and never gets one point of evidence on the cell leader.
- **Even the all-knowing test bot fails without it.** It knows the leader, his schedule and every plot event, and still ends 6 of 6 games with zero evidence when it skips decryption.
- **The codebreaking can't be done by a person.** Keys are random letters, the decrypted text is internal computer IDs rather than words, and a winning game takes 20 to 60 breaks.
- **The terminal menu hides its targets.** `pnpm play` lists thirty travel rows like "travel — 0 phases", each with a cost but no destination.

On realism, the occupation sectors and the plot ideas are right. The shipped city puts real Vienna landmarks in the wrong districts. The opposition's radio traffic looks nothing like a 1952 service's. The officer's working life is mostly missing: colleagues, paperwork, a demanding HQ, and fear of the Soviet sector. Most fixes are small. Three decisions are yours, set out under What to do next.

## How it was tested

I played the current working tree, including uncommitted changes, through the same facade both shells use, with the repo's offline stand-ins for the models. The work ran on a copy, so your repo is unchanged. Four kinds of player ran the CI seeds (`calibration-0` to `-11` on standard, `-0` to `-2` on easy):

| Player | What it knows | Codebreaking |
| --- | --- | --- |
| Expert bot (the repo's own probe) | Hidden truth: the leader, schedules, where and when plot events happen | Perfect, by reading the true key |
| Honest player, codebreaker | Only what the screens show | Perfect (a generous stand-in for a human) |
| Honest player, no codebreaking | Only what the screens show | None |
| Expert, no codebreaking | Hidden truth | None |

I also rendered the terminal screens frame by frame and read all 38 newspaper editions of one game. I decrypted intercepts to see their plain text, compared city layouts across seeds, and checked history against sources.

**Not tested: the live model voices.** The Linux workspace on your Mac can't reach LM Studio. The repo has also never recorded a live session: every metrics line comes from the ambient simulator, and the replay recordings are empty. Talk scenes, NPC voices and the Narrator are therefore unjudged. The honest bots don't talk to anyone. The expert bot does recruit informants, and still gets no evidence without codebreaking.

## Playability

As shipped, a person can start a game but can't realistically win one. The arrest gate opens only for players who break ciphers, and the ciphers can't be broken by hand.

| Player (standard preset) | Wins | Evidence on the leader at the end | Codebreaks per game |
| --- | --- | --- | --- |
| Expert bot, knows the truth | 12 of 12 | 7 to 10 | every breakable intercept |
| Honest player, perfect codebreaker | 12 of 12 | 7 to 8 | 19 to 61 (median 42) |
| Honest player, no codebreaking | 0 of 12 | 0 in every game | 0 |
| Expert bot, no codebreaking | 0 of 6 | 0 in every game | 0 |

On easy the pattern is identical (3 of 3, 3 of 3, 0 of 3). The honest codebreaker wins about as early as the expert, around day 24 of a 40–to–50‑day operation. That means omniscience adds nothing: codebreaking decides the game, and field work contributes nothing.

1. **Field work never produces evidence.** An arrest needs facts confirmed by two independent sources about the same moment. Surveillance and informants report sightings and meetings, but in 18 test games without codebreaking, no other field source ever confirmed one, so none of it became evidence. Meanwhile each intercept counts as its own source, so two messages from the same radio operator confirm each other. *Fix:* let a watched meeting confirm an informant's or a document's account of it. Treat one channel's traffic as one voice, as HQ already is.
2. **The codebreaking can't be done by a person.** Vigenère and columnar keys are random 4–7 letter strings: a code comment says "pronounceable", but the code draws any letters. Decrypted text is engine notation, for example `MO npc:tamara-panov-4 org:hostile`. Letter-frequency analysis, the Workbench's main tool, therefore doesn't work. Each wrong guess costs a phase and says only "The key does not produce readable text." *Fix:* keys from a period word list and messages in short German telegraphese. Add a key-length finder and a free trial-decrypt preview to the Workbench. Send fewer, more important messages.
3. **Intercepts name their senders.** A callsign is the first four letters of the sender's first name, such as JOHA for Johann Aichinger or NIKO for Nikolai Kalugin. Fact lines print the channel as `chan:johann-aichinger-2/signal`, and background traffic is signed NOIS. The web decrypt menu shows the intercept id, which reads "Cell tx chan nikolai kalugin 4 signal 5". *Fix:* random callsigns, neutral channel labels such as "Station 3, 6.2 Mc/s", and opaque ids.
4. **The terminal menu never names a target.** At the start it shows 30 travel rows such as "travel — 0 phases" with no destination, six "read — 1 phase" rows with no titles, and 26 identical rows of "cable — you can only send a Cable from the Station". It has always shown only the action kind. The web shell labels these properly. *Fix:* reuse the web labels in the terminal, and fold disallowed options into one line per kind.
5. **The Case File speaks engine.** Terminal rows read `document doc:cable/hq-dit1 · npc:friedrich-pichler-0 MEMBER_OF org:cell`. The web Case File shows only `claim:1 | MEMBER_OF`. Fact lines print "Friedrich Pichler MEETS\_AT lean and stooped, clean-shaven, a loden coat…": a predicate code, then a costume instead of the name the dossier just gave. *Fix:* one plain-sentence renderer, used by fact lines, the Case File and the Journal.
6. **You can't meet your own people on purpose.** The engine has `arrange-meeting`, but neither menu offers it. Each person is somewhere public about three phases a week, and schedules aren't visible. The Chief of Station is at the Station one morning a week. Answering "Meet the Chief of Station in person?" with yes talks to whoever is standing nearby. At the Augarten start that is nobody, so nothing happens. *Fix:* offer meetings with known contacts, keep the Station staffed in office hours, and make the briefing a real scene.
7. **Dossiers don't let you recognise anyone.** A dossier gives a name but no description, and strangers in the street appear only as descriptions. After reading Ernst Edelmann's dossier, the fact lines call him "lean and stooped…", and he never appears under People. *Fix:* a physical description, or "photograph attached", on some dossiers. Real files had both.
8. **Blank reports buy Standing.** Four empty report cables raised Standing from 0 to 4, and every funds request was approved. *Fix:* score a report on the new Claims it carries, and let HQ query or refuse money.
9. **The default game isn't the calibrated game.** The terminal start screen turns the internal mole on, while calibration runs with it off. In a 6-seed check with the mole on, the honest codebreaker still won 5. *Fix:* calibrate the default you ship, or default the mole off.
10. **Being burned comes fast.** In a reckless run, hidden cover suspicion went from 0.45 to burned within one game day. The only warning was "You sense you may have been followed" tacked onto arrival lines. *Fix:* a visible "tailed" flag in the status bar.

What already works: save and load, the help overlay and glossary, first-time hints, opening hours, the countersurveillance route choice, and the end-of-game debrief.

## Enjoyability

The best material, meaning the plots, the cover stories and the opposition's tricks, is in the files but rarely reaches the screen. A session currently feels like desk work.

1. **The winning loop is a desk job.** The honest codebreaker's winning game on `calibration-0` was 61 decrypts, 33 document reads, 14 radio sweeps, 7 trips and 1 arrest. It never watched a place, followed anyone or spoke to anyone. A no-codebreaking game on seed calibration-4 was 58 trips and 55 stakeouts over 40 days, and it lost with nothing to show for them.
2. **The story appears only in the debrief.** The plot templates have good prose, such as "A watcher logs the liaison officer's café habits across three mornings…". During play that becomes field codes and fact lines. The player first reads it after the game is over.
3. **The newspaper never changes.** All 38 editions in one game had the same text. The masthead prints the template id `newspaper-wiener-tagblatt-city`, and the title reads "Day 1, Day 1, morning". The lead says "from the the city that The day stood quiet…", and it reports fair weather on snow days. Each plot template carries ready-written public articles (`publicTraceArticles`), but no code reads them.
4. **The opening has no hook.** The brief cable says only "ASSUME COVER AND REPORT TO STATION STOP WORK THE LEADS ON FILE". It gives no target, no stakes and no deadline. The player starts alone in a Soviet-sector park, with five dossiers and no one to talk to. A strong opening names a threat and puts the Chief in the room.
5. **Big events happen off-stage.** Walk-ins arrive as "X has made contact.", and then nothing follows: no scene and no choice. In one game the walk-ins included a clerk from your own Station and the cell's own radio operator. A walk-in, genuine or a dangle, is one of spy fiction's best moments and deserves a scene.
6. **HQ is a vending machine.** A trace comes back within a few hours as a copy of the dossier you already had. An empty report gets "YOUR REPORT IS RECEIVED STOP CONTINUE AS INSTRUCTED". Two full test games, 28 and 40 days long, received no Directives at all. An HQ desk officer with opinions, impatient, sceptical and sometimes wrong, would add both pressure and character.
7. **People blur together.** Descriptions stack pieces that contradict each other: one woman is "clean-shaven, a swagger coat over a day dress… a well-pressed tunic without visible insignia", and others wear two coats. Surname pools are small, so one seed had two unrelated Novaks, Zehetners, Schobers and Aichingers. In a mystery that reads as a family link that isn't there. Two cafés in one city were both called Café Mohnblume.
8. **Replays get repetitive quickly.** The shipped game has 3 plots and 4 side threads. The 20-plot library is switched off.

The ingredients for fun are already there. The three core plots are good spy stories: a liaison officer compromised through a debt, a cipher component lifted from a registry, and an émigré snatched across the sector line. HQ can be wrong about your own contact. The opposition runs dangles, NPCs keep their cover stories straight, and the debrief shows what was real.

## Historical realism

The occupation map is right. The shipped city's geography and the missing dangers of the occupation are the main gaps.

**Right.** The core city puts districts 2, 4, 10 and 20 in the Soviet sector, 3 in the British, 6 in the French, 9 in the American, and the Inner City under four-power rotation. That matches the record ([Wien Geschichte Wiki](https://www.geschichtewiki.wien.gv.at/Besatzungszeit)). Legations rather than embassies, the Prater wheel, groschen prices and checkpoint papers are all period-true.

**Wrong: the shipped city scatters landmarks.** The core pack drops each place into a random district every game. Three seeds produced these:

| Place | Placed in | Actually in |
| --- | --- | --- |
| the Station (your HQ) | Wieden, Soviet sector | a Western sector or the Inner City |
| Nordbahnhof | Wieden (4th) | Leopoldstadt (2nd) |
| Franz-Josefs-Bahnhof | Innere Stadt (1st) | Alsergrund (9th) |
| Südbahnhof | Brigittenau (20th) | Favoriten (10th) |
| Augarten | Brigittenau (20th) | Leopoldstadt (2nd) |
| Rathauspark | Wieden (4th) | Innere Stadt (1st) |
| Viktor-Adler-Markt | Innere Stadt (1st) | Favoriten (10th) |
| Brunnenmarkt | Alsergrund (9th) | Ottakring (16th) |
| Buschenschank Kahlenberg, a vineyard tavern | Mariahilf, the shopping street | the Döbling hills (19th) |
| Bezirksbücherei Alsergrund | Brigittenau, Innere Stadt | Alsergrund, as its name says |

The `city-vienna` pack already fixes all of this. It pins every place to its proper district, with the Augarten in Leopoldstadt, the Naschmarkt in Wieden and the Station in the Inner City. Shipping it is your call (see What to do next).

**Missing: the occupation's menace.**

- *Vienna was an island.* The city sat inside the Soviet zone of Lower Austria, so every road west crossed Soviet checkpoints. The game has no sense of being surrounded.
- *Abductions.* The Soviet service terrified the Viennese with kidnappings: 704 cases are documented in Vienna, and only about 40% of those taken came back ([Wien Geschichte Wiki](https://www.geschichtewiki.wien.gv.at/Sowjetisch-%C3%B6sterreichische_Beziehungen_im_Nachkriegs-Wien)). A ministry official was stopped in the street by a man in Soviet uniform and three soldiers. Others were summoned to a Kommandantur and did not come home for years ([BMI](https://www.bmi.gv.at/magazinfiles/2022/05_06/20_zeitgeschichte_verschleppte.pdf)). In the game, the Soviet sector's danger is only a higher risk number.
- *Real anchors.* The Soviets ran Vienna from the Hotel Imperial on the Ring, and the Inter-Allied Kommandatura sat in the Justizpalast. Both are better scene settings than invented hotels.
- *A calendar.* The core game has no dates, so it has no Sundays, holidays or changing seasons. The paper says "published daily except Sundays" and appears every day.

**Names.**

- Russian women carry men's surname forms, such as Larisa Serov, Tamara Panov and Antonina Travkin. The pack comment says this was "for simplicity". The correct forms are Serova, Panova and Travkina.
- The Soviet name pool includes Serov and Kalugin, the surnames of a KGB chairman and a famous KGB general. Readers who know the field will catch them.
- One Station mixes American and British staff, for example Basil Pemberton, Cedric Fenwick and Dale Whitfield. A real station belonged to one service.

## Tradecraft realism

The game's instincts are right: grade your sources, corroborate, protect your cover, and expect dangles. Its signals and arrest rules follow puzzle-game logic rather than how services worked in 1952.

1. **Case officers didn't break enemy ciphers.** National codebreakers did, and Soviet agent traffic resisted them. The VIC hand cipher defeated the NSA from 1953 until its user defected in 1957 ([VIC cipher](https://en.wikipedia.org/wiki/VIC_cipher)). Caesar, Vigenère and simple columnar ciphers belong to amateurs. Your rule that a one-time pad falls only when an operator reuses it is exactly how such traffic was actually broken.
2. **Vienna's real signals war was telephone taps.** British intelligence ran Operation Silver from 1948 to 1951. It tunnelled from a police post to the cable linking Soviet headquarters at the Imperial to the Schwechat airfield, and "garnered a rich trove of message traffic" ([Peter Lunn](https://en.wikipedia.org/wiki/Peter_Lunn)). Tap transcripts would suit this game well: guarded phone calls, cover names, and "the uncle" bringing "the parcel". The puzzle becomes interpretation, which a person can do and which suits model-voiced text.
3. **The opposition radios its own roster.** Decrypted messages say who belongs to which network, repeated for days under different ciphers. Real traffic was operational: meeting times, money and tasks. A cell in one city also had little need for radio when the Soviet sector was a tram ride away. Couriers, dead drops and meetings carried local business.
4. **Real cases were built across disciplines.** The US Army's 430th Counter Intelligence Corps watched two Soviet agents in Vienna for over two and a half years and wrote about 2,000 top-secret reports. It arrested them on 14 January 1953 ([National Archives](https://www.archives.gov/iwg/declassified-records/rg-263-cia-records/rg-263-krichbaum.html)). Your rule that HQ's own files are one voice is excellent. Extend it so one radio channel is one voice, and let a watched meeting and an informant confirm each other.
5. **Station officers didn't arrest anyone.** That case shows who did: the Army's Counter Intelligence Corps, or the Austrian police. No Western authority could arrest anyone in the Soviet sector. In the game, an arrest is a request that works on anyone, anywhere. Routing it through the police-liaison contact, and allowing it only outside the Soviet sector, makes the endgame about luring the leader across the line.
6. **Recruitment takes weeks, not one conversation.** The real cycle runs spot, assess, develop, request traces, get HQ approval, pitch, then test the new agent. The game allows two reassuring lines and then a pitch. The first-recruitment hint tells players to "read their MICE profile", which the game never shows. Walk-ins were real and valuable: the GRU officer Pyotr Popov volunteered in Vienna in 1953 by dropping a letter into a US diplomat's parked car ([Popov](https://en.wikipedia.org/wiki/Pyotr_Semyonovich_Popov)).
7. **Commercial cover and daily Station visits don't mix.** The default cover is an import-export agent, yet the winning loop goes to the Station every day or two. The cover rules already treat the Station as the wrong place for a commercial cover, but the penalty is too small to notice: the winning codebreaker spent most of its game at the Station without trouble. A commercial-cover officer would meet colleagues in a safe flat. Cover-job duties exist only in the ambient pack, which is off.
8. **Cables and files look like film props.** "STOP" is commercial-telegram style, and a "DESTROY AFTER READING" line on every routine cable is more film than file. CIA traffic used cryptonyms with area prefixes and numbered agents, such as LICOZY-3 ([CIA cryptonym](https://en.wikipedia.org/wiki/CIA_cryptonym)). Real dossiers held birth details, address, employer, a physical description and graded source reports. Yours hold a name, an affiliation and a boilerplate paragraph with a missing full stop.
9. **Surveillance detection is half there.** The countersurveillance route and "You sense you may have been followed" are realistic. Real officers then chose whether to abort the meeting. Offering that choice when a tail is sensed would complete the loop.

Keep these, because they are right: Admiralty grading (A–F, 1–6), HQ holding false beliefs, covers that fit some places and not others, hostile watchers at risky places, dangles, chickenfeed passed through doubled agents, and the mole.

## Spy life

The player is a case officer with no office, no colleagues, no paperwork and no private life. Those are the parts that made the job a life, and they are also where a text game shines.

- **The Station is empty most of the week.** Schedules put the Chief in the office one morning a week and the cipher clerk three phases a week. A real station kept office hours, with a duty officer, a registry of card indexes, a code room and gossip. One CIA officer's memoir of his first tour, in nearby Trieste, says he "spent most of my time in the Branch doing name traces" ([A Case Officer's First Tour](https://cia.gov/resources/csi/static/case-officers-first-tour.pdf)).
- **Paperwork was the job.** Every meeting produced a contact report, and every schilling paid needed a receipt. The same memoir describes a colleague who fell ill and "had left no recoverable records of future meeting times and places with his agents". In the game the report cable is blank and payments are never accounted for. A short contact report after each meeting could double as the way Claims get filed.
- **The week ran on agent meetings.** Each agent had a standing slot, such as every second Thursday at the flat on Berggasse, plus a fallback time and an emergency signal like a chalk mark. The game's weekly NPC schedules could carry this directly, and it would also fix the problem of never finding your own people.
- **A cover job takes hours.** Commercial cover means real time at the Donau Handelskontor, with a boss who notices absences. Cover duties exist in the ambient pack, which is off.
- **The Soviet sector felt different.** Patrols, papers checks and a car slowing beside you should change how a night in Leopoldstadt reads, not just a risk number.
- **Ordinary life in a hungry city.** A flat, a landlady, a regular café, black-market coffee and cigarettes, the PX. The penicillin racket side thread already nods to this world.
- **Colleagues need faces before betrayal can sting.** The mole is one of the Station staff, and the player may never have spoken to them, because staff are in the office only a few phases a week. A mole hunt works only if the player knows the suspects.

## What to do next

Fix playability first, because nothing else matters until a person can win. Three choices below are yours. Everything else is engineering that Kiro can take as written. Items marked *(asks you first)* touch the stop-and-ask list in `AGENTS.md`.

**Decisions for you**

1. *What role should codebreaking play?* I recommend making it a bonus skill rather than the only road. Field work (watching, tailing, running agents) would build the case, and ciphers would give leads and the occasional clincher. The alternative is to keep it central but make it humane, with word keys, real messages and Workbench tools.
2. *Should the authored Vienna (`city-vienna`) become the default city?* I recommend yes. It fixes every geography error above. It needs a balance re-measure before it ships.
3. *Whose station is it?* I recommend American, since most staff names already are, and the counterintelligence arrests and the Popov-style walk-in fit. Tap transcripts can arrive from a British liaison partner.

**Priority 1: a person can win**

- [x] Terminal menu names every target (reuse the web shell's labels), and folds disallowed options into one line per kind.
- [x] One plain-sentence renderer for Claims, used by fact lines, both Case Files and the Journal. No ids or predicate codes on screen.
- [x] Field evidence counts: a watched meeting plus an informant's or a document's account of it confirm each other, and one radio channel is one voice. *(asks you first if golden replays change)*
- [x] Add a truth-blind "honest player" to calibration, so CI measures what a person can do and not only the all-knowing bot. The audit's bot is a starting point.
- [x] Arrange-meeting in both menus, the Station staffed in office hours, and the opening briefing as a real scene with the Chief.
- [x] Random callsigns, neutral channel labels and opaque intercept ids.
- [ ] The live playtest (slice-integration task 20): three full games on `pnpm play:web` with recording on.

**Priority 2: it's fun**

- [x] An opening cable with a named threat and a deadline, with the player starting at the Station.
- [x] Plot articles (`publicTraceArticles`) printed in the paper as stages execute. Fix the masthead, title and doubled words, and take the weather from the day.
- [x] Walk-ins as scenes at the Station, drawn from a plausible pool that excludes your own staff.
- [x] HQ as a character: traces that add something new, reports scored on content, and regular Directives.
- [x] Descriptions with one garment per slot and no contradictions. Unique surnames and place names per game, unless a link is intended. *(asks you first: changes generated worlds)*
- [ ] Consider switching on the plot library, which already holds the calibration bands. *(asks you first)*

**Priority 3: it's real**

- [ ] Ship `city-vienna` (decision 2). *(asks you first)*
- [x] Never put the Station in the Soviet sector. Staff each Station from one service.
- [x] Feminine forms for Russian women's surnames, and drop Serov and Kalugin from the pool. *(asks you first: changes generated worlds)*
- [x] A real start date in late 1952, so Sundays, holidays and seasons exist.
- [x] Arrests requested through the police-liaison contact, and impossible in the Soviet sector.
- [x] Operational telegraphese as intercept plain text, plus tap transcripts as a Station source.
- [x] Dossiers with descriptions and history. Cables with numbered paragraphs and cryptonyms.
- [x] Recruitment over several meetings with a trace and HQ approval. Fix or remove the MICE hint.
- [x] Abduction risk, patrols and checkpoint scenes in the Soviet sector.

## Where things live

File pointers for Kiro, one row per finding. Paths are relative to the repo root.

| Finding | Where |
| --- | --- |
| What counts as arrest evidence; what counts as an independent source | `packages/player-view/src/lib/casefile/evidence.ts` (`evidenceCount`), `casefile.ts` (`originKey`) |
| Random cipher keys, cipher choice, callsigns | `packages/engine/src/lib/cipher/intercept.ts` (`drawKeyword`, `drawSpec`, `callsignOf`) |
| Intercept plain text in engine notation | `packages/engine/src/lib/cipher/field-message.ts` |
| A decrypt costs a phase, right or wrong | `packages/engine/src/lib/action/decrypt.ts` (`DECRYPT_PHASE_COST`) |
| Terminal menu shows only the action kind | `packages/tui/src/lib/here/action-menu.tsx`, `packages/player-view/src/lib/street/phrasebook.ts`; working labels in `packages/web/src/client/labels.ts` |
| Case File display | `packages/tui/src/lib/casefile/`, `packages/web/src/client/aids.ts` (`caseFile`) |
| No arrange-meeting in the menu | `packages/player-view/src/lib/api/action-catalogue.ts` |
| "Meet the Chief" talks to anyone present | `packages/tui/src/lib/shell/app-shell.tsx` (`chiefTalkAction`) |
| Staff schedules, mixed US/UK staff | `packages/content/packs/core/archetypes.yaml` |
| Blank reports raise Standing | `packages/engine/src/lib/station/cables.ts` (`REPORT_STANDING_DELTA`) |
| Newspaper text; unused plot articles | `packages/content/packs/core/documents.yaml`; `publicTraceArticles` in `core/plots.yaml` |
| Walk-ins | `packages/engine/src/lib/clock/schedules.ts` |
| Random city geography vs authored Vienna | `packages/content/packs/core/city.yaml` vs `packages/content/packs/city-vienna/locations/` |
| Soviet-sector patrols, papers and the car | `packages/engine/src/lib/city/occupation.ts` |
| Russian surname forms | `packages/content/packs/core/personas/soviet.yaml` |
| Mole on by default | `packages/tui/src/lib/start/start-screen.tsx` |

**Sources**

- [Besatzungszeit](https://www.geschichtewiki.wien.gv.at/Besatzungszeit), Wien Geschichte Wiki: sector districts, Inter-Allied patrol
- [Sowjetisch-österreichische Beziehungen im Nachkriegs-Wien](https://www.geschichtewiki.wien.gv.at/Sowjetisch-%C3%B6sterreichische_Beziehungen_im_Nachkriegs-Wien), Wien Geschichte Wiki: abductions, Hotel Imperial
- [Verschleppte Österreicher](https://www.bmi.gv.at/magazinfiles/2022/05_06/20_zeitgeschichte_verschleppte.pdf), Austrian Interior Ministry: abduction cases and methods
- [Peter Lunn](https://en.wikipedia.org/wiki/Peter_Lunn), Wikipedia: Operation Silver
- [VIC cipher](https://en.wikipedia.org/wiki/VIC_cipher), Wikipedia
- [Pyotr Semyonovich Popov](https://en.wikipedia.org/wiki/Pyotr_Semyonovich_Popov), Wikipedia
- [RG 263: Wilhelm Krichbaum](https://www.archives.gov/iwg/declassified-records/rg-263-cia-records/rg-263-krichbaum.html), National Archives: the Ponger–Verber case and the 430th CIC
- [CIA cryptonym](https://en.wikipedia.org/wiki/CIA_cryptonym), Wikipedia
- [A Case Officer's First Tour](https://cia.gov/resources/csi/static/case-officers-first-tour.pdf), CIA Center for the Study of Intelligence
