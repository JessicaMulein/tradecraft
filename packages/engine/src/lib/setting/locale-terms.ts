/**
 * Wiring the selected city's Locale Local Terms and allowed names into the help
 * glossary and the Specifics Guard (content-expansion task 3.6; Req 8.5, 8.6).
 *
 * A city {@link Locale} carries two prose lists the slice's player-facing
 * surfaces consume:
 *
 * - **Local Terms** (`terms`): period- and city-specific vocabulary — a tram
 *   line, a checkpoint, a local newspaper's nickname — each with a definition.
 *   The design routes these into the help glossary (Req 8.5), so the Help view
 *   lists them alongside the core game and tradecraft terms. {@link
 *   glossaryWithLocalTerms} folds them into the Content Set's glossary map,
 *   keyed by term exactly as the loader keys authored glossary entries, so the
 *   Help view projection reads one definition per term with no change of its
 *   own.
 * - **Allowed names** (`allowNames`): names the Specifics Guard must not flag as
 *   invented proper nouns — the city's own place and institution names the
 *   Narrator may use freely (Req 8.6). The design adds both `allowNames` *and*
 *   the Local Terms' terms to the Guard's allowed-name set. {@link
 *   specificsAllowedNames} returns that combined list, ready to pass as the
 *   Specifics Guard's `allowedWords`.
 *
 * Both functions are pure. They read the chosen city's Locale (through the
 * resolved {@link LocaleContext}'s chain or a passed Locale) and the slice
 * glossary, and never mutate their inputs: {@link glossaryWithLocalTerms}
 * returns a fresh map. The Core City has no City Pack and so no city Locale, in
 * which case the glossary is returned unchanged and the allowed-name list is
 * empty — the slice behaviour.
 *
 * These produce the data the generator (task 3.8) stores on the Content Set and
 * the dialogue layer passes to the guards; they do not reach into the
 * player-view or dialogue packages themselves, keeping the wiring one-way and
 * this module inside the setting package's dependency budget.
 */

import type { GlossaryTerm, Locale } from '@tradecraft/content';

import { type LocaleContext } from './locale-render.js';

/**
 * The first (most specific) city-or-era Locale in a {@link LocaleContext}'s
 * chain, or `undefined` when the chain is empty (a Core City with no Era Pack).
 * The city Locale is first when a City Pack is selected; otherwise the era
 * Locale leads. The Local Terms and allowed names belong to the selected city,
 * so the leading Locale is the one whose `terms` and `allowNames` are wired in.
 */
function leadingLocale(ctx: LocaleContext): Locale | undefined {
  return ctx.locales[0];
}

/**
 * Return a new glossary map that adds the city Locale's Local Terms to the
 * slice glossary (Req 8.5). The input map is left untouched; the result is a
 * fresh {@link Map} with every base entry plus one entry per Local Term, keyed
 * by `term`.
 *
 * A Local Term whose `term` already names a base glossary entry overrides it,
 * matching the loader's own "a later pack's definition replaces an earlier one"
 * rule for authored glossary entries — the city voice wins for a term the city
 * defines. The Help view reads the returned map exactly as it reads the Content
 * Set's glossary, so no projection change is needed.
 *
 * With no city Locale (the Core City, or a chain with no leading Locale) the
 * base glossary is returned as a fresh copy, so the caller always owns the
 * result.
 */
export function glossaryWithLocalTerms(
  base: ReadonlyMap<string, GlossaryTerm>,
  ctx: LocaleContext,
): Map<string, GlossaryTerm> {
  const merged = new Map(base);
  const locale = leadingLocale(ctx);
  if (locale === undefined) {
    return merged;
  }
  for (const term of locale.terms) {
    merged.set(term.term, { term: term.term, definition: term.definition });
  }
  return merged;
}

/**
 * The names the Specifics Guard must allow for the selected city (Req 8.6): the
 * city Locale's `allowNames` plus every Local Term's `term`. Returned as a
 * de-duplicated list in a stable order — `allowNames` in authored order, then
 * the Local Terms in authored order, each first occurrence kept — so the result
 * is a pure function of the Locale and feeds the Guard's `allowedWords`
 * directly.
 *
 * With no city Locale (the Core City) the list is empty, so the Specifics Guard
 * keeps its slice behaviour: only the verbatim Fact Line / scene-descriptor
 * tokens and the pack's own allowlist are permitted.
 */
export function specificsAllowedNames(ctx: LocaleContext): string[] {
  const locale = leadingLocale(ctx);
  if (locale === undefined) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (name: string): void => {
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  };
  for (const name of locale.allowNames) {
    add(name);
  }
  for (const term of locale.terms) {
    add(term.term);
  }
  return out;
}
