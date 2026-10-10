# Working on Tradecraft

Kiro, Cursor and other agents read this file on every task. The detailed rules are in `.kiro/steering/`, which is the single source of truth. The Cursor rules in `.cursor/rules/` point to those files. Architecture, commands and status are in `README.md`, and specs are in `.kiro/specs/<name>/`.

## Who decides what

The project owner, Jessica, directs the work and decides intent and taste. She is not a prompt designer or a game designer, and she does not hand-write content, prompts or tuning numbers. Agents do that work and prove it with the repo's own checks.

- **Do the design work yourself.** Write the content, prompts, tuning values and spec text. Never hand her YAML, prompt text or numbers to fill in.
- **Ask only about intent and taste.** Frame it as a short choice with your recommendation first. Decide everything else, and say what you decided.
- **Check before you show.** Run the checks that apply (see `.kiro/steering/content-authoring.md` for content, and the task's own tests for code) before presenting work. Show the results, not the process.
- **Report in plain language.** Say what changes for a player, what you checked, and what is left. Use internal ids only when she needs them to find something.
- **Translate feedback yourself.** "Too modern", "too dark" or "the Soviet sector should feel scarier" are instructions to you. Work out the concrete change, make it, and show a before and after.

## Stop and ask before

- bumping `GENERATOR_VERSION` or re-recording golden replays (existing seeds would produce different games);
- removing or renaming content ids in a released pack (old saves and the baseline check depend on them);
- adding packs to, or turning on `plotSelection.enabled`, `ambient.enabled` or add-ons in, the shipped `config/scenario.yaml`;
- changing the calibration bands in `packages/app/src/lib/playability.calibration.spec.ts`;
- promoting model-written content into a pack (this needs her sign-off; see the authoring steering file);
- turning on any `living` surface or proposals in the shipped `config/scenario.yaml`, or adding a surface to `config/scenario-living.yaml`'s defaults before it passes its release gate;
- changing the Variety bands in `living.variety.bands.ts`;
- turning on any picture kind in `config/frames.yaml`, marking an image model as shippable in `config/image-model-licences.yaml`, or promoting pictures into a Frame_Pack (she reviews and signs off every picture).

## Never break

These hold across every spec:

- The engine owns every fact. Truth never crosses into `player-view` projections.
- Model output never writes a fact directly and never reveals hidden truth. Models may write live text from engine Fact Sheets, and propose world changes from a closed engine-built menu, only in the ways the `living-world` spec allows. A proposal becomes a fact only when the engine verifies and commits it.
- World generation is deterministic for a given seed. Replay is deterministic for a given seed plus its recorded log: actions, model replies and accepted proposals.
- Every Plot Stage stays solvable through two independent discovery paths.
- All people and organisations are fictional. Real places are allowed only with a cited source.
- Content kinds (templates, archetypes, predicates, cities, style sheets) come only from committed, reviewed pack files. Live text must pass the `living-world` gates or fall back to authored text, and is never shown unchecked.
- Packs hold data only. New mechanics (action, channel or cipher kinds, new content kinds) are code, and they need a spec task.
