/**
 * The newspaper and seized-material Document composers (design, "Document
 * Generator"; Requirements 30.1, 30.2).
 *
 * This is task 9.1. It owns two pure composers over the shared Document render
 * helpers (`./render.ts`, `./namer.ts`, `./document.ts`), plus the clock
 * day-boundary hook adapter that mints the daily edition.
 *
 * ## The daily newspaper (Requirement 30.2)
 *
 * Each day the Sim mints a `newspaper`-kind {@link Document} — the daily edition
 * (design: "At each day start, 3–6 articles are chosen on the daily stream.
 * Candidates are city events, public Plot traces, Side Thread traces,
 * Rumours"). The composer draws 3–6 articles from a pool of **newspaper
 * material** gathered from four sources:
 *
 * - **city events** — the day's weather and the ordinary life of the city (a
 *   deterministic "around the city" item built from the day's {@link
 *   import('../city/city.js').Weather} summary), the mundane filler every
 *   edition carries;
 * - **public Plot traces** — the *public* traces an executed Plot stage left
 *   (task 7.2 classifies a stage's traces; a public trace is one a correspondent
 *   could witness). A Plot-trace article asserts the Proposition(s) the trace is
 *   *about*, so a reader who files the edition seeds a true lead into the Case
 *   File (Requirement 30.1);
 * - **Side Thread traces** — the watchable activity a Side Thread emits (task
 *   6.2's {@link SideThreadTrace}). Also true, but noise — a lead that goes
 *   nowhere;
 * - **Rumours** — false beliefs circulating among Background NPCs (task 6.3's
 *   {@link Rumour}). A rumour article asserts the rumour's **false**
 *   Proposition, so reading the edition can *also* seed a false Claim.
 *
 * Because a newspaper mixes TRUE public/side-thread traces with FALSE rumours,
 * the Propositions a composed edition `asserts` are a *mix of true and false*
 * Propositions. That is deliberate and matches the design's rule that a Document
 * is a source of Claims, not of truth (design, `./document.ts`): reading the
 * edition seeds the Case File (Requirement 30.1) with everything the edition
 * printed, and the player must corroborate which lines are real. The composer
 * never filters by truth — it asserts exactly what each selected article is
 * about.
 *
 * ## Selection, and the thin-day floor
 *
 * The material pool is gathered id-sorted (so the order is a pure function of
 * the inputs regardless of record order) and the edition draws its articles from
 * the daily {@link Prng} — the daily stream the design PRNG registry assigns to
 * "newspaper selection" (`derive(seed, 0x20000 + day)`). The composer draws a
 * target article count in `[MIN_ARTICLES, MAX_ARTICLES]` = `[3, 6]`, then draws
 * that many distinct items from the pool (a shuffled prefix). When the day's
 * material is **thin** — fewer than `MIN_ARTICLES` items available — the edition
 * composes as many articles as the pool offers (its floor is the pool size, not
 * 3), down to and including an empty edition when there is no material at all.
 * This keeps the composer total: a quiet day still mints a (short) edition
 * rather than throwing.
 *
 * ## Seized material (Requirement 30.1)
 *
 * {@link composeSeizedDocument} composes a `seized`-kind Document from material
 * the player captured — a courier's papers, a notebook taken in an arrest, the
 * contents of a hostile dead drop (design, "Seized. Contents of hostile drops
 * and items from arrests"). It asserts the source material's Propositions, so
 * reading the seized Document seeds the Case File with the facts the captured
 * material carried. It is a thin composer over the render helpers, exactly like
 * the Dossier and Cable composers.
 *
 * ## Determinism
 *
 * Both composers are pure. The newspaper draws every choice from the passed
 * daily {@link Prng} in a fixed order over id-sorted lists; the seized composer
 * makes no draws. Same inputs ⇒ identical Documents (Requirement 1.2).
 */

import {
  type DocumentTemplate,
  type TemplateBindings,
} from '@tradecraft/content';
import {
  type GameTime,
  type Proposition,
  type PropId,
} from '../model/core.js';
import { type Prng, createPrng } from '../prng/prng.js';
import { type Weather as CityWeather } from '../city/city.js';
import { calendarLabel, type DayOff } from '../city/calendar.js';
import { weekdayForDay } from '../city/time-mapping.js';
import type { SimEvent } from '../model/state.js';
import {
  docId,
  slugify,
  type ComposedDocument,
  type Document,
} from './document.js';
import { playerNamer, formatDate, type NamerContext } from './namer.js';
import { compileSections, renderString, renderTitle } from './render.js';

// ---------------------------------------------------------------------------
// Article-count bounds (design: "3–6 articles")
// ---------------------------------------------------------------------------

/** The fewest articles a well-stocked edition carries (design: "3–6"). */
export const MIN_ARTICLES = 3;
/** The most articles an edition carries (design: "3–6"). */
export const MAX_ARTICLES = 6;

// ---------------------------------------------------------------------------
// Newspaper material
// ---------------------------------------------------------------------------

/**
 * One candidate article the newspaper may print, tagged by the source it was
 * drawn from. Each carries a stable `id` (for id-sorting the pool so selection
 * is deterministic), the Propositions the article asserts (true for a city /
 * plot / side-thread item, false for a rumour), and a short `headline` /
 * `summary` the composer renders the article's prose from.
 *
 * The caller (the Turn Pipeline / task 6.4 wiring) builds this pool from the
 * day's live sources; keeping the composer over this neutral shape means it
 * never reaches into the Plot/noise/clock modules and so takes on no import
 * cycle.
 */
export interface NewspaperItem {
  /** A stable id used to id-sort the pool, so the draw order is deterministic. */
  readonly id: string;
  /** Which of the four sources this item came from. */
  readonly source: NewspaperSource;
  /** A short headline phrase the article's lead renders from. */
  readonly headline: string;
  /** A one- or two-sentence detail the article body renders from. */
  readonly summary: string;
  /**
   * The Propositions this article asserts. True for a city/plot/side-thread
   * item, FALSE for a rumour — the edition asserts both, so a reader seeds the
   * Case File with the printed Claims and must corroborate which are real.
   */
  readonly asserts: readonly Proposition[];
}

/** The four sources a newspaper article is drawn from (design, Req 30.2). */
export type NewspaperSource =
  | 'city-event'
  | 'plot-trace'
  | 'side-thread'
  | 'rumour';

/**
 * The day's material pool, grouped by source. The composer flattens and
 * id-sorts it before drawing, so the grouping is only for the caller's
 * convenience and plays no part in determinism.
 */
export interface NewspaperMaterial {
  /** City-event items (weather, mundane city life). */
  readonly cityEvents: readonly NewspaperItem[];
  /** Public Plot-trace items (a correspondent could witness these). */
  readonly plotTraces: readonly NewspaperItem[];
  /** Side-Thread trace items (true, but noise). */
  readonly sideThreadTraces: readonly NewspaperItem[];
  /** Rumour items (false beliefs circulating among Background NPCs). */
  readonly rumours: readonly NewspaperItem[];
}

/** An empty material pool, the floor a quiet day falls back to. */
export const EMPTY_MATERIAL: NewspaperMaterial = {
  cityEvents: [],
  plotTraces: [],
  sideThreadTraces: [],
  rumours: [],
};

/**
 * Flatten a {@link NewspaperMaterial} into one id-sorted pool. The source order
 * (city, plot, side-thread, rumour) only disambiguates equal ids; the pool is
 * then sorted by `id` so a draw against it is a pure function of the inputs
 * regardless of how the caller grouped them.
 */
export function newspaperPool(material: NewspaperMaterial): NewspaperItem[] {
  const all = [
    ...material.cityEvents,
    ...material.plotTraces,
    ...material.sideThreadTraces,
    ...material.rumours,
  ];
  return all.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Building a city-event item from the day's weather
// ---------------------------------------------------------------------------

/**
 * Build the day's single city-event item from the day's weather. Every edition
 * can carry this mundane "around the city" filler, so a day with no plot/side/
 * rumour material still has at least one article to print. It asserts nothing
 * (weather is not a lead), carries a stable id scoped to the day, and renders a
 * headline/summary from the weather's human label.
 *
 * `summary` is the `{ summary }` the clock's `day-start` event carries; when it
 * is empty (the clock's placeholder) a neutral phrase is used so the article
 * still renders.
 */
export function cityWeatherItem(day: number, summary: string): NewspaperItem {
  const label = summary.trim().length > 0 ? summary.trim() : 'quiet over the city';
  return {
    id: `city/weather/${day}`,
    source: 'city-event',
    headline: 'The city at large',
    summary: `the day stood ${label}; the markets and the ring trams kept their usual hours.`,
    asserts: [],
  };
}

/**
 * Convenience: the day's {@link NewspaperMaterial} assembled from the engine
 * weather and three pre-built item lists. A thin helper the Turn Pipeline / task
 * 6.4 wiring can use to assemble the pool without re-deriving the city-event
 * item itself.
 */
export function dailyMaterial(
  day: number,
  weather: CityWeather | { readonly summary?: string } | undefined,
  plotTraces: readonly NewspaperItem[],
  sideThreadTraces: readonly NewspaperItem[],
  rumours: readonly NewspaperItem[],
): NewspaperMaterial {
  const summary =
    weather === undefined
      ? ''
      : 'label' in weather && typeof weather.label === 'string'
        ? weather.label
        : 'summary' in weather && typeof weather.summary === 'string'
          ? weather.summary
          : '';
  return {
    cityEvents: [cityWeatherItem(day, summary)],
    plotTraces,
    sideThreadTraces,
    rumours,
  };
}

// ---------------------------------------------------------------------------
// composeNewspaper
// ---------------------------------------------------------------------------

/** Inputs {@link composeNewspaper} needs beyond the shared namer context. */
export interface NewspaperContext extends NamerContext {
  /** The game time the edition is dated (its day is the edition day). */
  readonly date: GameTime;
  /** The day's weather, in the words the paper prints. */
  readonly weather?: string;
  /** Game day 0's calendar date, so the masthead can name a real day. */
  readonly startDate?: string;
}

/**
 * The weekday an edition's masthead prints. With a start date it is the real
 * weekday of that calendar day. Without one, day 0 is Monday.
 */
function weekdayLabel(date: GameTime, startDate?: string): string {
  const name = weekdayForDay(date.day, startDate);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The date line: a calendar date when the game has one, otherwise `day N`. */
function editionDate(date: GameTime, startDate?: string): string {
  if (startDate === undefined) {
    return `day ${date.day}`;
  }
  return calendarLabel(startDate, date.day);
}

/** A paper's name, from the template id. The id itself is never printed. */
function mastheadName(templateId: string): string {
  const slash = templateId.lastIndexOf('/');
  const local = slash === -1 ? templateId : templateId.slice(slash + 1);
  if (local.includes('amtsblatt')) {
    return 'Amtsblatt';
  }
  if (local.includes('tagblatt')) {
    return 'Wiener Tagblatt';
  }
  return 'The city paper';
}

/**
 * Render one {@link NewspaperItem} into a short prose article (a headline line
 * and its detail), using the render helpers so the text stays fact-layer and
 * namer-resolved. The newspaper template's lead section uses the `{headline}`,
 * `{district}`, `{subject}` and `{detail}` slots; here each article is rendered
 * as a self-contained block so an edition can carry several of them.
 */
function renderArticle(item: NewspaperItem, ctx: NewspaperContext): string {
  const namer = playerNamer(ctx);
  // A tiny, slot-free template per article keeps rendering uniform and
  // namer-resolved without needing a bespoke content template per source.
  const headline = renderString(item.headline, {}, namer).trim();
  const body = renderString(item.summary, {}, namer).trim();
  return headline.length > 0 ? `${headline}. ${body}` : body;
}

/**
 * Select the articles for the edition from the pool, on the daily Prng.
 *
 * Draws a target count in `[MIN_ARTICLES, MAX_ARTICLES]`, clamps it to the pool
 * size (the thin-day floor), then draws that many distinct items as a shuffled
 * prefix of the id-sorted pool. The draw order is fixed (target, then shuffle),
 * so the selection is a pure function of the daily seed and the pool. An empty
 * pool yields no articles and draws nothing.
 */
export function selectArticles(
  pool: readonly NewspaperItem[],
  prng: Prng,
): NewspaperItem[] {
  if (pool.length === 0) {
    return [];
  }
  const target = prng.int(MIN_ARTICLES, MAX_ARTICLES);
  const count = Math.min(target, pool.length);
  return prng.shuffle(pool).slice(0, count);
}

/**
 * Compose the day's newspaper edition (Requirement 30.2).
 *
 * `template` must be a `newspaper`-kind Document template (the core pack ships
 * three — `newspaper-wiener-tagblatt-city`, `…-blotter`,
 * `newspaper-amtsblatt-notices`). `material` is the day's pool; `ctx` carries
 * the namer context and the edition date; `prng` must be built from the **daily
 * stream** seed for the edition's day (`derive(seed, 0x20000 + day)`), the
 * stream the design assigns to newspaper selection.
 *
 * The edition carries 3–6 articles drawn from the pool (fewer only when the
 * pool is thin), rendered into the template's lead/around-the-city sections.
 * Its `asserts` is the union of the selected articles' Propositions, in
 * selection order and de-duplicated by id — a **mix of true public/side-thread
 * traces and false rumours** (documented above), so reading the edition seeds
 * the Case File with every printed Claim (Requirement 30.1). The returned
 * {@link ComposedDocument} threads the full Propositions back for the read
 * action, exactly as the Dossier and Cable composers do.
 *
 * `obtainableAt` is left for the Turn Pipeline to fill from the city's kiosk/
 * café Locations (design: "obtainable at kiosks and cafés") — the composer does
 * not resolve Locations so it stays a pure function of its material.
 */
export function composeNewspaper(
  template: DocumentTemplate,
  material: NewspaperMaterial,
  ctx: NewspaperContext,
  prng: Prng,
): ComposedDocument {
  const namer = playerNamer(ctx);
  const pool = newspaperPool(material);
  const articles = selectArticles(pool, prng);

  // The articles' bodies, rendered and joined. The newspaper template declares
  // a `lead` section (headline/subject/detail) and an `around-the-city`
  // section; we render the template once for the masthead/title and fold the
  // selected articles into the body so an edition carries several.
  const articleBlocks = articles.map((item) => renderArticle(item, ctx));

  // The template's required slots, filled from the first article when present
  // so the authored lead section renders; the extra articles are appended after
  // the template body as additional blocks.
  const lead = articles[0];
  const bindings: TemplateBindings = {
    masthead: mastheadName(template.id),
    weekday: weekdayLabel(ctx.date, ctx.startDate),
    date: editionDate(ctx.date, ctx.startDate),
    edition: 'Daily',
    headline: lead?.headline ?? 'The city at large',
    district: 'Inner City',
    subject: lead?.summary ?? 'the ordinary business of the day',
    detail: lead?.summary ?? '',
    weather: ctx.weather ?? 'quiet',
    'official-office': 'sector authority',
    // Blotter / notices slots: bound to neutral values so a template that
    // declares them still renders. Optional `{?notice}` sections stay unbound.
    offence: 'a minor disturbance',
    place: 'the district',
    outcome: 'The matter was noted.',
    'effective-date': formatDate(ctx.date),
  };

  const templateBody = compileSections(template, bindings, namer);
  const title = renderTitle(template, bindings, namer);

  // Fold the remaining articles (beyond the lead the template already used)
  // into the body as extra blocks, so an edition reads as several items.
  const extraBlocks = articleBlocks.slice(lead !== undefined ? 1 : 0);
  const body = [templateBody, ...extraBlocks]
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .join('\n\n');

  // The asserted Propositions: the union of the selected articles', in
  // selection order, de-duplicated by id. True and false alike (documented).
  const propositions: Proposition[] = [];
  const seen = new Set<PropId>();
  for (const item of articles) {
    for (const prop of item.asserts) {
      if (!seen.has(prop.id)) {
        seen.add(prop.id);
        propositions.push(prop);
      }
    }
  }

  const document: Document = {
    id: docId('newspaper', `edition/${ctx.date.day}`),
    kind: 'newspaper',
    title,
    date: ctx.date,
    body,
    asserts: propositions.map((p) => p.id),
  };

  return { document, propositions };
}

/**
 * The edition for a Sunday or a public holiday. It names the day and carries
 * no articles, so the masthead's "except Sundays" is what the player finds.
 */
export function closedEdition(
  template: DocumentTemplate,
  date: GameTime,
  startDate: string,
  reason: DayOff,
): ComposedDocument {
  const label = calendarLabel(startDate, date.day);
  const weekday = weekdayLabel(date, startDate);
  const masthead = mastheadName(template.id);
  const title = `${masthead} — ${weekday}, ${label}`;
  const body =
    reason.kind === 'sunday'
      ? 'No edition. The paper does not publish on Sunday.'
      : `No edition. ${label} is ${reason.name}.`;
  const document: Document = {
    id: docId('newspaper', `edition/${date.day}`),
    kind: 'newspaper',
    title,
    date,
    body,
    asserts: [],
  };
  return { document, propositions: [] };
}

// ---------------------------------------------------------------------------
// composeSeizedDocument
// ---------------------------------------------------------------------------

/** The slots a composer may fill on a seized-material Document. */
export interface SeizedFields {
  /** A stable local tag for the Document id (`doc:seized/<tag>`). */
  readonly tag: string;
  /** Where the material was recovered (a Location name or free text). */
  readonly place: string;
  /** Who recovered it (the player's cover, a staffer). */
  readonly recoveredBy: string;
  /** A short description of the item (a notebook, a courier's papers). */
  readonly description: string;
  /** The legible, transcribed contents the material carried. */
  readonly contents: string;
  /** The condition of the item (optional; defaults to a neutral phrase). */
  readonly condition?: string;
  /** What the material appears to concern (optional subject line). */
  readonly subject?: string;
}

/** Inputs {@link composeSeizedDocument} needs. */
export interface SeizedContext extends NamerContext {
  /** The game time the material was seized / the Document is dated. */
  readonly date: GameTime;
  /**
   * The Propositions the seized material asserts — the facts the captured
   * courier's papers / notebook / drop contents carried. The read action turns
   * each into a Case File Claim (Requirement 30.1).
   */
  readonly asserts: readonly Proposition[];
}

/**
 * Compose a `seized`-kind Document from captured material (Requirement 30.1;
 * design: "Seized. Contents of hostile drops and items from arrests").
 *
 * `template` must be a `seized`-kind Document template (the core pack's
 * `seized-handwritten-note`). The Document asserts the Propositions in
 * `ctx.asserts` — the facts the captured material carried — so reading it seeds
 * the Case File. It carries no `obtainableAt` (seized material is held, not
 * obtained at a Location). A thin composer over the render helpers, mirroring
 * {@link import('./dossier.js').composeDossier} and
 * {@link import('./cable.js').composeCable}; it makes no random draws, so the
 * Document is a pure function of its fields, the asserted Propositions and the
 * content.
 */
export function composeSeizedDocument(
  template: DocumentTemplate,
  fields: SeizedFields,
  ctx: SeizedContext,
): ComposedDocument {
  const namer = playerNamer(ctx);
  const asserted = ctx.asserts;

  const bindings: TemplateBindings = {
    date: formatDate(ctx.date),
    place: fields.place,
    'recovered-by': fields.recoveredBy,
    description: fields.description,
    contents: fields.contents,
    condition: fields.condition ?? 'legible, lightly worn',
    ...(fields.subject !== undefined ? { subject: fields.subject } : { subject: 'the matter in hand' }),
  };

  const body = compileSections(template, bindings, namer);
  const title = renderTitle(template, bindings, namer);

  const document: Document = {
    id: docId('seized', `${slugify(fields.tag)}/${ctx.date.day}`),
    kind: 'seized',
    title,
    date: ctx.date,
    body,
    asserts: asserted.map((p) => p.id),
  };

  return { document, propositions: asserted };
}

// ---------------------------------------------------------------------------
// The clock newspaper day-boundary hook
// ---------------------------------------------------------------------------

/**
 * A mutable cell that captures the composed newspaper Document across a clock
 * `advance`. The clock's `newspaper` day-boundary hook returns events only (a
 * `newspaper` {@link SimEvent} naming the Document id), so to thread the
 * composed {@link Document} back out of an `advance` — for the Turn Pipeline to
 * register into `WorldState.documents` and `WorldState.newspapers[day]` — the
 * hook writes it here as a controlled side effect. This mirrors
 * {@link import('../clock/plot-execution.js').PlotStateCell}.
 *
 * The Turn Pipeline (task 6.4 wiring) creates one cell, builds a hook from it,
 * runs `advance`, then reads the editions the cell captured and folds each into
 * the world's documents/newspapers records. The composer here produces the
 * composer + hook; it does not touch `generate.ts` or the state records.
 */
export interface NewspaperCell {
  /** The composed editions captured during the advance, keyed by day. */
  readonly editions: Record<number, ComposedDocument>;
}

/** Create an empty {@link NewspaperCell}. */
export function newspaperCell(): NewspaperCell {
  return { editions: {} };
}

/** The minimal day-boundary hook context the newspaper hook reads. */
export interface NewspaperHookContext {
  readonly time: GameTime;
  readonly dailyStreamSeed: string;
}

/**
 * The world material the newspaper hook assembles each day's pool from. The
 * hook is handed a `materialFor(day)` callback rather than the live Plot/noise
 * state directly, so this module never imports the Plot or noise modules (no
 * import cycle): the Turn Pipeline closes the callback over the day's public
 * Plot traces, Side-Thread traces and Rumours it already has in hand, and over
 * the day's weather for the city-event item.
 */
export type NewspaperMaterialFor = (day: number) => NewspaperMaterial;

/**
 * Adapt {@link composeNewspaper} into the clock's `newspaper` day-boundary hook
 * (`ClockHooks.newspaper`). The returned hook, on each day boundary, builds the
 * daily {@link Prng} from the context's `dailyStreamSeed` (so the selection
 * rides the deterministic daily stream the design assigns to newspapers),
 * assembles the day's material via `materialFor`, composes the edition, writes
 * the composed {@link ComposedDocument} into `cell.editions[day]` for the Turn
 * Pipeline to register, and returns a single player-visible `newspaper`
 * {@link SimEvent} naming the Document id.
 *
 * `template` and `ctx` (the namer context) are closed over at build time (both
 * are read-only within a run); the edition date is taken from the hook context
 * each day. This keeps {@link composeNewspaper} a pure function while still
 * fitting the events-only hook contract the clock fixes (task 7.1).
 *
 * The returned event's `id` is a deterministic placeholder; the clock re-ids
 * every hook event when it appends it, so this id only needs to be unique and
 * deterministic within the day. The event carries only the Document id (no
 * Truth), matching the player-visible `newspaper` variant.
 *
 * @deprecated The events-only day-boundary adapter. The game path uses the
 * `newspaper` state reducer in `../clock/world-hooks.ts` (`buildWorldHooks`),
 * run by `advanceWorld` (`../clock/advance-world.ts`), which writes the
 * composed edition, its Propositions, `newspapers[day]` and the Document's
 * obtainable Locations to the Draft and not only its event. Kept for the
 * existing tests and golden replays.
 */
export function newspaperDayBoundaryHook(
  cell: NewspaperCell,
  template: DocumentTemplate,
  ctx: NamerContext,
  materialFor: NewspaperMaterialFor,
): (hookCtx: NewspaperHookContext) => readonly SimEvent[] {
  return (hookCtx) => {
    const prng = createPrng(hookCtx.dailyStreamSeed);
    const material = materialFor(hookCtx.time.day);
    const composed = composeNewspaper(
      template,
      material,
      { ...ctx, date: hookCtx.time },
      prng,
    );
    cell.editions[hookCtx.time.day] = composed;

    const event: SimEvent = {
      id: `news-evt:${hookCtx.time.day}` as SimEvent['id'],
      at: hookCtx.time,
      visibility: 'player',
      kind: 'newspaper',
      doc: composed.document.id,
    };
    return [event];
  };
}
