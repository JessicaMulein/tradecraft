/**
 * The Locale and Template Variant kinds (content-expansion task 1.7).
 *
 * A `locale` fixes date, money, honorific and address formatting plus Local
 * Terms and allowed names; a `template-variant` replaces a base template,
 * scoped to one City Definition or Era Pack. A Locale may live in an Era Pack
 * (the era default) or a City Pack (the city override); a Template Variant is
 * era-scoped or city-scoped. Task 1.7 replaces the stub schemas with the Locale
 * and Template Variant schemas (design, "Locale and Template Variants"),
 * implements the pure formatters (`../locale`) and fills in Field Declarations.
 *
 * A city-scoped Locale or Template Variant is City-Scoped Content; the loader
 * applies the ownership check only to the instances a City Pack defines, so the
 * registration lists both roles and is marked `cityScoped: true`.
 */

import { z } from 'zod';

import { ContentRefSchema, TemplateStringSchema } from '../lib/common.js';
import type { ContentKindRegistration } from '../lib/registry.js';
import { CONTENT_EXPANSION_OWNER } from './stub.js';

/**
 * The scope of a Locale or Template Variant: exactly one City Definition or one
 * Era Pack (design, Req 8.1). A city-scoped record is City-Scoped Content owned
 * by that City Pack; an era-scoped record is the era-wide default the city
 * record falls back to. The two forms are a closed union so a record cannot
 * name both at once.
 */
export const LocaleScopeSchema = z.union([
  z.object({ city: ContentRefSchema }).strict(),
  z.object({ era: ContentRefSchema }).strict(),
]);
export type LocaleScope = z.infer<typeof LocaleScopeSchema>;

/**
 * The date part of a Locale: the long and short patterns plus the month and
 * weekday name lists the patterns draw from. Output is English in local order
 * (design): `months` is January→December (indices 0–11) and `weekdays` is the
 * seven weekday names in the order the Locale names a date's weekday with. The
 * patterns name the `{weekday}`, `{day}`, `{month}` and `{year}` slots the date
 * formatter fills (design, "Locale and Template Variants"; Property 12).
 */
export const LocaleDateSchema = z
  .object({
    long: TemplateStringSchema,
    short: TemplateStringSchema,
    months: z
      .array(z.string().min(1))
      .length(12, 'a Locale must name all twelve months'),
    weekdays: z
      .array(z.string().min(1))
      .length(7, 'a Locale must name all seven weekdays'),
  })
  .strict();
export type LocaleDate = z.infer<typeof LocaleDateSchema>;

/**
 * The currency part of a Locale: the pattern money renders through, e.g.
 * `"{amount} {symbol}"`. The amount, symbol, subunit and rounding of the city's
 * currency come from the City Definition's `currency`; the Locale only fixes
 * how they are laid out, so an era Locale can supply a default pattern a city
 * Locale overrides (design, `formatMoney`).
 */
export const LocaleCurrencySchema = z
  .object({
    pattern: TemplateStringSchema,
  })
  .strict();
export type LocaleCurrency = z.infer<typeof LocaleCurrencySchema>;

/**
 * The honorifics of a Locale, split by gender (design: "Frau"/"Herr",
 * "Senhora"/"Senhor"). A Naming Rule's `formal` form draws its honorific from
 * here; each list is non-empty so every gender has a title to render.
 */
export const LocaleHonorificsSchema = z
  .object({
    f: z.array(z.string().min(1)).min(1, 'a Locale needs a female honorific'),
    m: z.array(z.string().min(1)).min(1, 'a Locale needs a male honorific'),
  })
  .strict();
export type LocaleHonorifics = z.infer<typeof LocaleHonorificsSchema>;

/**
 * A Local Term and its definition. The selected city's Local Terms join the
 * help glossary (Req 8.5) and the Specifics Guard allowed-name set (Req 8.6).
 */
export const LocalTermSchema = z
  .object({
    term: z.string().min(1),
    definition: z.string().min(1),
  })
  .strict();
export type LocalTerm = z.infer<typeof LocalTermSchema>;

/**
 * A Locale: the date, currency, honorific and address formatting of one city or
 * era, plus the Local Terms and the names the Specifics Guard allows (design,
 * "Locale and Template Variants"). The `address` pattern names the `{street}`,
 * `{number}` and `{district}` slots the address formatter fills, e.g.
 * `"{street} {number}, {district}"`.
 *
 * Formatting follows the city-then-era fallback chain: `formatDate` and
 * `formatMoney` take the city Locale's fields where they are defined and the
 * era Locale's fields otherwise (design, Req 8.4; Property 12).
 */
export const LocaleSchema = z
  .object({
    scope: LocaleScopeSchema,
    date: LocaleDateSchema,
    currency: LocaleCurrencySchema,
    honorifics: LocaleHonorificsSchema,
    address: TemplateStringSchema,
    terms: z.array(LocalTermSchema).default([]),
    allowNames: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type Locale = z.infer<typeof LocaleSchema>;

/**
 * A Template Variant: a replacement for a base template, scoped to one City
 * Definition or Era Pack (Req 8.1). At load the variant is compiled and its
 * slot set is compared with the base template's; a mismatch is a `ContentError`
 * (Req 8.3, task 2.2). Resolution order is city, then era, then base (Req 8.2).
 */
export const TemplateVariantSchema = z
  .object({
    id: ContentRefSchema,
    base: ContentRefSchema,
    scope: LocaleScopeSchema,
    template: TemplateStringSchema,
  })
  .strict();
export type TemplateVariant = z.infer<typeof TemplateVariantSchema>;

/**
 * The `locale` registration. A Locale lives in an Era Pack (the era default) or
 * a City Pack (the city override) and is City-Scoped when a City Pack defines
 * it. Its `terms` and `allowNames` are prose the text Lint Rules scan; it names
 * no Tags, Tag Queries, Year Ranges, templates or cross-references.
 */
export const localeKind: ContentKindRegistration = {
  kind: 'locale',
  dir: 'locale',
  schema: LocaleSchema,
  roles: ['era', 'city'],
  cityScoped: true,
  owner: CONTENT_EXPANSION_OWNER,
  fields: {
    text: ['items[].terms[].term', 'items[].terms[].definition'],
    names: ['items[].allowNames[]'],
  },
};

/**
 * The `template-variant` registration. Each variant replaces a base template
 * with a localised `template` field, so the text Lint Rules and the Template
 * Variant checks (CE-VARIANT, task 2.2) read it through the `templates`
 * declaration. The `base` link is not a generic cross-reference: a base may be
 * a Document, newspaper or Rumour template of any kind, and the variant
 * compiler (task 2.2) resolves it against the compiled templates and compares
 * slot sets, so it is deliberately left out of the `refs` declaration.
 */
export const templateVariantKind: ContentKindRegistration = {
  kind: 'template-variant',
  dir: 'template-variants',
  schema: TemplateVariantSchema,
  roles: ['era', 'city'],
  cityScoped: true,
  owner: CONTENT_EXPANSION_OWNER,
  fields: {
    templates: [{ path: 'items[].template', style: 'other' }],
  },
};

/** Every Locale/Template Variant kind registered by this module. */
export const LOCALE_KINDS = [localeKind, templateVariantKind];
