/**
 * Locale and Template Variant wiring for the slice's rendering paths
 * (content-expansion task 3.6; design, "Locale and Template Variants").
 *
 * The slice renders player-facing text in four places this task touches — Fact
 * Lines, Documents (Dossiers, Cables, public texts), the daily newspaper and
 * the Notifications derived from them. The content-expansion spec adds a city
 * voice to each: dates, money, honorifics and addresses format through the
 * selected city's {@link Locale} (with the Era Pack Locale as fallback), and a
 * base template may be replaced by a city- or era-scoped {@link TemplateVariant}
 * (Req 8.2, 8.4). This module is the pure wiring the generator (task 3.8) hangs
 * those two steps on; it adds nothing to the slice `render` or `resolveTemplate`
 * contracts, only assembles their inputs from the chosen setting.
 *
 * Everything here is pure and deterministic. A {@link LocaleContext} is built
 * once per game from the Content Set and the chosen city, and the formatters
 * and the Locale-aware namer read only it and their arguments, so the same
 * setting always renders the same text (the determinism Property 14 requires of
 * the setting step). The module stays inside the setting package and depends
 * only on `@tradecraft/content`'s pure formatters and the engine's own model
 * types, so it adds no cross-package coupling.
 *
 * The design is explicit that the slice `render(ast, bindings, namer, rng)` is
 * unchanged: "Locale formatters are supplied through the existing bindings for
 * `{when}` on Documents and for amount and address slots. Fact Lines keep the
 * slice's weekday and phase phrasing." So this module does not rewrite the
 * composers' template language; it supplies:
 *
 * - a {@link LocaleContext} the composers read the Start Date, Locale chain and
 *   currency from;
 * - {@link formatWhen} / {@link formatAmount} / {@link formatAddressParts} /
 *   {@link honorific}, the four formatting entry points a composer binds its
 *   `{when}`, amount and address slots through; and
 * - {@link localeNamer}, a {@link Namer} wrapper that formats a bound
 *   {@link GameTime} through the city Locale (so a Document template that binds
 *   a raw date renders it in the city's voice) while delegating every other
 *   value to the slice's player namer.
 *
 * Variant resolution ({@link resolveVariantText}) is the thin bridge to the
 * content package's pure {@link resolveTemplate}: it hands back the compiled
 * template source a composer should render for a `(base, city)`, so Fact Line,
 * Document, newspaper and Notification composers all resolve the city-then-era
 * variant through one call.
 */

import {
  formatAddress,
  formatDate,
  formatHonorific,
  formatMoney,
  resolveTemplate,
  type AddressParts,
  type Currency,
  type Locale,
  type Namer,
} from '@tradecraft/content';

import { type GameTime } from '../model/core.js';
import {
  type CitySelector,
  type ContentSetV2,
} from './content-set-v2.js';
import { type IsoDate } from './setting.js';

/**
 * The Locale, Start Date and currency the rendering paths read, resolved once
 * per game for the chosen city (design: "resolved once per game"). It carries:
 *
 * - `city`: the chosen {@link CitySelector}, so variant resolution keys on it;
 * - `startDate`: the game's Start Date (game day 0), so a {@link GameTime}'s
 *   `day` maps to a calendar date for {@link formatDate};
 * - `locales`: the Locale fallback chain, most specific first — the city Locale
 *   then the era Locale (Req 8.4). The content formatters walk this list and
 *   take the first Locale that supplies each field;
 * - `currency`: the chosen city's currency (name, symbol, subunit, format,
 *   `rounding`, `budgetScale`), the City Definition's `currency`. The Core City
 *   has no City Pack, so it carries the era's conventions and a neutral
 *   currency the generator supplies.
 */
export interface LocaleContext {
  readonly city: CitySelector;
  readonly startDate: IsoDate;
  /** The Locale chain, most specific first (city, then era). */
  readonly locales: readonly Locale[];
  readonly currency: Currency;
}

/**
 * The Core City's neutral currency, used when no City Pack is selected. The
 * Core City keeps the slice's abstract "credits" ledger: an integer-rounded
 * unit with a `budgetScale` of 1, so currency scaling (task 3.6, {@link
 * scaleBudget}) is the identity on the Core City and the slice's money numbers
 * are unchanged. The symbol and names are plain so a Core City Document that
 * renders money through the era Locale's pattern reads sensibly.
 */
export const CORE_CITY_CURRENCY: Currency = {
  name: 'credits',
  symbol: 'cr',
  subunit: 'cr',
  format: '{whole}',
  rounding: 1,
  budgetScale: 1,
};

/**
 * Build the {@link LocaleContext} for a game from the merged Content Set, the
 * chosen city and the Start Date (design: "resolved once per game"). The Locale
 * chain is the city Locale (when a City Pack is selected and defines one) then
 * the era Locale (when an Era Pack is loaded), in that order, so the formatters
 * fall back city → era (Req 8.4). The currency is the chosen city's; the Core
 * City uses {@link CORE_CITY_CURRENCY}.
 *
 * Pure: a function of its arguments only. Called once by the generator (task
 * 3.8) after the setting step fixes the city and Start Date.
 */
export function buildLocaleContext(
  set: ContentSetV2,
  city: CitySelector,
  startDate: IsoDate,
): LocaleContext {
  const locales: Locale[] = [];
  let currency: Currency = CORE_CITY_CURRENCY;

  if (city !== 'core') {
    const bundle = set.cities[city];
    if (bundle !== undefined) {
      locales.push(bundle.locale);
      currency = bundle.def.currency;
    }
  }

  const eraLocale = set.era?.locale;
  if (eraLocale !== undefined) {
    locales.push(eraLocale);
  }

  return { city, startDate, locales, currency };
}

// --- formatting entry points ----------------------------------------------

/**
 * Format a {@link GameTime} as the calendar date the city Locale names it with
 * (Req 8.4). The Start Date is game day 0, so the formatter maps `t.day` onto a
 * date in the Locale's own month and weekday vocabulary and lays it out with the
 * Locale's long (or, when `style` is `'short'`, short) pattern. This is the
 * value a Document composer binds its `{when}` slot to.
 *
 * The slice's within-day phase (`t.phase`) does not change the calendar date,
 * so it does not reach the content formatter (whose `GameTime` reads only
 * `day`). Fact Lines keep the slice's own weekday-and-phase phrasing (design),
 * so they do not call this; it is the Document and newspaper date voice.
 */
export function formatWhen(
  ctx: LocaleContext,
  t: GameTime,
  style: 'long' | 'short' = 'long',
): string {
  return formatDate({ day: t.day }, ctx.startDate, ctx.locales, style);
}

/**
 * Format a money amount in the city currency's voice (Req 8.4). The amount is
 * rounded to the currency's `rounding` step and laid out through the Locale's
 * currency pattern. This is the value a composer binds an amount slot to — a
 * Cable's funds line, a Dossier's retainer figure. Scaling by `budgetScale`
 * happens once at preset resolution ({@link scaleBudget}); this renders an
 * already-scaled, single-currency amount, so the ledger stays single-currency
 * (design, "Currency").
 */
export function formatAmount(ctx: LocaleContext, amount: number): string {
  return formatMoney(amount, ctx.currency, ctx.locales);
}

/**
 * Format an address in the city Locale's voice (Req 8.4): a street, building
 * number and district laid out through the Locale's `address` pattern (e.g.
 * `"{street} {number}, {district}"`). This is the value a composer binds an
 * address slot to.
 */
export function formatAddressParts(
  ctx: LocaleContext,
  parts: AddressParts,
): string {
  return formatAddress(parts, ctx.locales);
}

/**
 * The honorific the city Locale uses for a gender (Req 8.4): "Frau"/"Herr",
 * "Senhora"/"Senhor". A Naming Rule's formal form and a Document that addresses
 * an NPC by title draw it from here.
 */
export function honorific(ctx: LocaleContext, gender: 'f' | 'm'): string {
  return formatHonorific(gender, ctx.locales);
}

// --- Locale-aware namer -----------------------------------------------------

/**
 * Wrap a slice {@link Namer} so a bound {@link GameTime} renders as the city
 * Locale's calendar date instead of the slice's `Day N, <phase>` form, while
 * every other value — entity ids, strings, numbers — is delegated unchanged to
 * the wrapped namer (design: the slice `render` and namer contract is otherwise
 * unchanged).
 *
 * This lets a Document template that binds a raw date (rather than a
 * pre-formatted `{when}` string) still render it in the city's voice, so a
 * composer can bind either the formatted string (via {@link formatWhen}) or the
 * `GameTime` itself and get the same localised date. The wrapper is pure: for
 * the same context and value it always yields the same text.
 */
export function localeNamer(ctx: LocaleContext, base: Namer): Namer {
  return (value: unknown): string => {
    if (isGameTime(value)) {
      return formatWhen(ctx, value);
    }
    return base(value);
  };
}

/** True when a value is a {@link GameTime} (`{ day, phase }`). */
function isGameTime(value: unknown): value is GameTime {
  return (
    typeof value === 'object' &&
    value !== null &&
    'day' in value &&
    'phase' in value &&
    typeof (value as { day: unknown }).day === 'number'
  );
}

// --- variant resolution -----------------------------------------------------

/**
 * The compiled template source a composer should render for a base template in
 * the chosen city: the city-scoped variant if one exists, else the era-scoped
 * variant, else the base itself (Req 8.2). Returns `undefined` only when `base`
 * names no loaded base template, so a caller can fall back to its own hard-coded
 * template as the slice does today.
 *
 * The returned object is the content package's {@link resolveTemplate} result —
 * the compiled AST and the slot set — so a composer renders the resolved AST
 * directly. Fact Line, Document, newspaper and Notification composers all route
 * their base template through this one call so they resolve the same way.
 */
export function resolveVariant(
  set: ContentSetV2,
  base: string,
  city: CitySelector,
): ReturnType<typeof resolveTemplate> {
  return resolveTemplate(set, base, city);
}
