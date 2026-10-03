/**
 * Shared rendering helpers for the Document composers.
 *
 * A content {@link DocumentTemplate} is a title pattern plus an ordered list of
 * named body sections, each a template string in the content template language
 * (`@tradecraft/content`'s `render`). Composing a Document means rendering the
 * title and every section against a set of bindings and the player-perspective
 * {@link import('./namer.js').playerNamer}, then joining the sections into one
 * `body` string. These helpers own that mechanical step so each composer can
 * concentrate on building the right bindings.
 *
 * The Document templates in the core pack use plain prose and declared slots
 * only — no `{pick:pool}` references (see `packs/core/documents.yaml`) — so a
 * trivial, deterministic rng (always pick the first item) suffices and no
 * flavour pools are needed. Rendering is therefore a pure function of the
 * template, the bindings and the namer.
 */

import {
  parseTemplate,
  render,
  type DocumentTemplate,
  type Namer,
  type TemplateBindings,
  type TemplateRng,
} from '@tradecraft/content';

/**
 * A deterministic rng for template rendering: it always picks the first item.
 * The Document templates make no `{pick:…}` draws, so this is never consulted;
 * it exists only to satisfy `render`'s signature with no randomness.
 */
export const FIRST_PICK_RNG: TemplateRng = {
  pick: <T>(items: readonly T[]): T => items[0],
};

/** Render a template string against bindings and the namer. */
export function renderString(
  source: string,
  bindings: TemplateBindings,
  namer: Namer,
): string {
  return render(parseTemplate(source), bindings, namer, FIRST_PICK_RNG);
}

/**
 * Render a Document template's title pattern against bindings and the namer.
 */
export function renderTitle(
  template: DocumentTemplate,
  bindings: TemplateBindings,
  namer: Namer,
): string {
  return renderString(template.titlePattern, bindings, namer);
}

/**
 * Render every section of a Document template and join them into one `body`
 * string, in authored order, separated by a blank line. Sections that render to
 * empty (an all-optional section with nothing bound) are dropped so the body has
 * no stray blank gaps.
 */
export function compileSections(
  template: DocumentTemplate,
  bindings: TemplateBindings,
  namer: Namer,
): string {
  const rendered: string[] = [];
  for (const section of template.sections) {
    const text = renderString(section.body, bindings, namer).trim();
    if (text.length > 0) {
      rendered.push(text);
    }
  }
  return rendered.join('\n\n');
}
