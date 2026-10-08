/**
 * The Era kinds (content-expansion task 1.5).
 *
 * An Era Pack supplies the period: the `era` record, the `technology` list
 * with years of introduction, the `cipher-conventions` (limited to the slice
 * cipher kinds), the `anachronisms`, the Real-Person `blocklist`, the
 * `style-guide`, the `sensitivity` term list and the `public-text` corpus (with
 * provenance). This module replaces the task 1.2 stub schemas with the real Zod
 * schemas from the design's "Era Pack content" section and fills in each kind's
 * Field Declarations (text, Year Ranges, names) so the loader and Pack Linter
 * can walk them (design, "Content Kind Registry"; Requirements 5.1–5.5, 12.1,
 * 12.4, 12.5, 17.1).
 */

import { z } from 'zod';

import { ContentIdSchema, ContentRefSchema, TagIdSchema } from '../lib/common.js';
import { CIPHER_KINDS } from '../lib/difficulty.js';
import { DOCUMENT_KINDS } from '../lib/kinds.js';
import type { ContentKindRegistration } from '../lib/registry.js';
import { CONTENT_EXPANSION_OWNER } from './stub.js';

// --- shared period primitives ----------------------------------------------

/**
 * A year, as written in a pack: a four-digit-plus integer. Years of
 * introduction, anachronism earliest-years and Year Range bounds all use it.
 */
export const YearSchema = z
  .number()
  .int('a year must be a whole number')
  .min(1, 'a year must be positive');

/**
 * An inclusive Year Range `[from, to]`. A kind that applies only to part of the
 * Period Window (a District sector, a Culture Weight entry, a public text) is
 * scoped with one of these; the loader's year filter keeps an item only when
 * the Game Year lies inside it. The schema rejects an inverted range so a bad
 * pack fails at load.
 */
export const YearRangeSchema = z
  .object({
    from: YearSchema,
    to: YearSchema,
  })
  .strict()
  .refine((r) => r.from <= r.to, {
    message: 'Year Range from must be <= to',
    path: ['from'],
  });
export type YearRange = z.infer<typeof YearRangeSchema>;

/**
 * A City id, as referenced by a city-scoped Anachronism Entry or public text.
 * The linter compares it with the loaded City Definition id, which is
 * `<pack>/<name>` (for example `city-berlin/berlin`). A bare id is still
 * accepted. (Tag ids, referenced by an Era's default climate Tag and a
 * technology item, use the shared {@link TagIdSchema} from `../lib/common.js`.)
 */
export const CityIdSchema = ContentRefSchema;

// --- Era --------------------------------------------------------------------

/**
 * The era record: its id, its Period Window and the default climate Tag the
 * descriptor generator falls back to when a city names none.
 */
export const EraSchema = z
  .object({
    id: ContentIdSchema,
    period: YearRangeSchema,
    climateDefault: TagIdSchema.optional(),
  })
  .strict();
export type Era = z.infer<typeof EraSchema>;

// --- TechnologyItem ---------------------------------------------------------

/**
 * One technology item with its year of introduction, checked by the linter's
 * CE-ANACH rule: a document that names the item before `introduced` is an
 * anachronism. `aliases` carry the other surface forms the text matcher looks
 * for, and `tags` place the item in the vocabulary.
 */
export const TechnologyItemSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1, 'a technology item needs a name'),
    aliases: z.array(z.string().min(1)).default([]),
    category: z.string().min(1, 'a technology item needs a category'),
    introduced: YearSchema,
    tags: z.array(TagIdSchema).default([]),
  })
  .strict();
export type TechnologyItem = z.infer<typeof TechnologyItemSchema>;

// --- CipherConventions ------------------------------------------------------

/**
 * The Cipher Engine owners whose traffic the era weights. Each weights a subset
 * of the slice {@link CIPHER_KINDS} closed set; `makeIntercept` reads these in
 * place of its built-in defaults (Requirement 5.6).
 */
export const CIPHER_OWNERS = [
  'hostile',
  'diplomatic',
  'commercial',
  'criminal',
  'station',
] as const;
export const CipherOwnerSchema = z.enum(CIPHER_OWNERS);

/**
 * A partial weighting over the slice cipher kinds for one owner. Only cipher
 * kinds in the closed {@link CIPHER_KINDS} set may be named (Requirement 5.2);
 * every weight is a non-negative number. `.partial()` keeps it a subset so an
 * owner may weight only the ciphers it uses.
 */
export const CipherWeightsSchema = z
  .object(
    Object.fromEntries(
      CIPHER_KINDS.map((kind) => [
        kind,
        z.number().nonnegative('a cipher weight must not be negative'),
      ]),
    ) as Record<(typeof CIPHER_KINDS)[number], z.ZodNumber>,
  )
  .partial()
  .strict();

/**
 * The one-time-pad group format: five-letter groups (the slice fixes the group
 * size at five) and the groups-per-line the broadcast lays out.
 */
export const PadFormatSchema = z
  .object({
    groupSize: z.literal(5),
    groupsPerLine: z
      .number()
      .int('groupsPerLine must be a whole number')
      .positive('groupsPerLine must be positive'),
  })
  .strict();

/** The numbers-station broadcast format: the call-up, the group count and the repeat. */
export const NumbersFormatSchema = z
  .object({
    callup: z.string().min(1, 'a numbers broadcast needs a call-up'),
    groups: z
      .number()
      .int('groups must be a whole number')
      .positive('groups must be positive'),
    repeat: z
      .number()
      .int('repeat must be a whole number')
      .positive('repeat must be positive'),
  })
  .strict();

/**
 * The era's cipher conventions, read by the Cipher Engine's `makeIntercept`:
 * the per-owner cipher weights, the intercept `headers` (template strings; a
 * tradecraft-error "fixed header" is drawn from these), the pad format and the
 * numbers-broadcast format (Requirements 5.2, 5.6).
 */
export const CipherConventionsSchema = z
  .object({
    ownerWeights: z
      .object(
        Object.fromEntries(
          CIPHER_OWNERS.map((owner) => [owner, CipherWeightsSchema]),
        ) as Record<(typeof CIPHER_OWNERS)[number], typeof CipherWeightsSchema>,
      )
      .strict(),
    headers: z
      .array(z.string().min(1))
      .min(1, 'cipher conventions need at least one header'),
    padFormat: PadFormatSchema,
    numbersFormat: NumbersFormatSchema,
  })
  .strict();
export type CipherConventions = z.infer<typeof CipherConventionsSchema>;

// --- AnachronismEntry -------------------------------------------------------

/**
 * One Anachronism Entry: a `term` and the `pattern` the text matcher uses, the
 * `earliest` year the term is period-correct, an optional `city` scope (for a
 * term that only became anachronistic in one city, such as a later Berlin
 * border term) and an explanatory `note` (Requirements 12.1, 12.5).
 */
export const AnachronismEntrySchema = z
  .object({
    term: z.string().min(1, 'an anachronism entry needs a term'),
    pattern: z.string().min(1, 'an anachronism entry needs a pattern'),
    earliest: YearSchema,
    city: CityIdSchema.optional(),
    note: z.string().min(1, 'an anachronism entry needs a note'),
  })
  .strict();
export type AnachronismEntry = z.infer<typeof AnachronismEntrySchema>;

// --- BlocklistEntry ---------------------------------------------------------

/**
 * One Real-Person Blocklist entry: a notable period individual's `name` whose
 * use the linter's CE-REALPERSON rule rejects. `familyOnly` marks an entry
 * whose family name alone is distinctive enough to reject; `note` records who
 * it is (Requirement 12.4).
 */
export const BlocklistEntrySchema = z
  .object({
    name: z.string().min(1, 'a blocklist entry needs a name'),
    familyOnly: z.boolean().optional(),
    note: z.string().min(1, 'a blocklist entry needs a note'),
  })
  .strict();
export type BlocklistEntry = z.infer<typeof BlocklistEntrySchema>;

// --- StyleRule --------------------------------------------------------------

/**
 * The template styles a Style Rule applies to: a Fact Line or a Document of one
 * of the slice {@link DOCUMENT_KINDS}. This mirrors the registry's
 * {@link import('../lib/registry.js').TemplateStyle} minus `other`, so a rule
 * targets exactly the surfaces the linter renders.
 */
export const STYLE_RULE_TARGETS = [
  'fact-line',
  ...DOCUMENT_KINDS.map((kind) => `document:${kind}` as const),
] as const;
export const StyleRuleTargetSchema = z.enum(
  STYLE_RULE_TARGETS as unknown as [string, ...string[]],
);

/**
 * The mechanical and manual checks a Style Rule may carry (design, StyleRule
 * `check`). The mechanical checks (`max-words` … `headline-words`) are run by
 * the linter's CE-STYLE rule; `manual` rules are listed as review reminders and
 * never fail the lint.
 */
export const STYLE_RULE_CHECKS = [
  'max-words',
  'terminal-stop',
  'no-exclamation',
  'no-first-person',
  'hedging',
  'spelling',
  'upper-case',
  'headline-words',
  'manual',
] as const;
export const StyleRuleCheckSchema = z.enum(STYLE_RULE_CHECKS);

/**
 * One Style Guide rule: the surfaces it `appliesTo`, the `check` it runs, an
 * optional `value` (a number for `max-words`, a word list for `hedging` or
 * `spelling`) and the `message` the finding carries (Requirement 12.1).
 */
export const StyleRuleSchema = z
  .object({
    id: ContentIdSchema,
    appliesTo: z
      .array(StyleRuleTargetSchema)
      .min(1, 'a style rule must apply to at least one surface'),
    check: StyleRuleCheckSchema,
    value: z
      .union([z.number(), z.array(z.string().min(1))])
      .optional(),
    message: z.string().min(1, 'a style rule needs a message'),
  })
  .strict();
export type StyleRule = z.infer<typeof StyleRuleSchema>;

// --- SensitivityTerm --------------------------------------------------------

/**
 * One Sensitivity Term: a `term` and the `pattern` the text matcher uses. The
 * linter's CE-SENSITIVE rule rejects any content that matches (Requirement
 * 12.1).
 */
export const SensitivityTermSchema = z
  .object({
    term: z.string().min(1, 'a sensitivity term needs a term'),
    pattern: z.string().min(1, 'a sensitivity term needs a pattern'),
  })
  .strict();
export type SensitivityTerm = z.infer<typeof SensitivityTermSchema>;

// --- PublicText -------------------------------------------------------------

/**
 * The kinds of public text an Era (or a City Pack) may ship: an almanac, a
 * timetable, a verse-and-prose anthology, a directory, a manual or a guide
 * (Requirement 5.4). Each is readable in-game and, crucially, is the key
 * material a BOOK CIPHER counts across.
 */
export const PUBLIC_TEXT_KINDS = [
  'almanac',
  'timetable',
  'anthology',
  'directory',
  'manual',
  'guide',
] as const;
export const PublicTextKindSchema = z.enum(PUBLIC_TEXT_KINDS);

/**
 * A public text's provenance: whether its body is `original` writing or
 * `public-domain` text, and an optional `source` naming where public-domain
 * text came from. This is the per-item provenance from the design's PublicText
 * shape, distinct from the file-envelope Provenance Record that marks a file as
 * model output.
 */
export const PublicTextProvenanceSchema = z
  .object({
    kind: z.enum(['original', 'public-domain']),
    source: z.string().min(1).optional(),
  })
  .strict();

/**
 * A public text content item: its id, title, kind, provenance and `body` (pages
 * of lines), with an optional `city` scope for a city-specific text such as a
 * local tram timetable. The body keeps the slice's book-cipher length rule
 * (checked elsewhere); here it must be a non-empty list of non-empty lines
 * (Requirements 5.4, 12.5).
 */
export const PublicTextSchema = z
  .object({
    id: ContentIdSchema,
    title: z.string().min(1, 'a public text needs a title'),
    kind: PublicTextKindSchema,
    provenance: PublicTextProvenanceSchema,
    body: z
      .array(z.string().min(1))
      .min(1, 'a public text needs at least one line of body'),
    city: CityIdSchema.optional(),
  })
  .strict();
export type PublicText = z.infer<typeof PublicTextSchema>;

// --- registrations ----------------------------------------------------------

/** Build an Era-Pack kind registration with its real schema and Field Declarations. */
function defineEraKind<T>(args: {
  readonly kind: string;
  readonly dir: string;
  readonly schema: z.ZodType<T>;
  readonly fields: ContentKindRegistration['fields'];
}): ContentKindRegistration<T> {
  return {
    kind: args.kind,
    dir: args.dir,
    schema: args.schema,
    roles: ['era'],
    cityScoped: false,
    fields: args.fields,
    owner: CONTENT_EXPANSION_OWNER,
  };
}

export const eraKind = defineEraKind({
  kind: 'era',
  dir: 'era',
  schema: EraSchema,
  fields: {
    tags: ['items[].climateDefault'],
    years: ['items[].period'],
  },
});

export const technologyKind = defineEraKind({
  kind: 'technology',
  dir: 'technology',
  schema: TechnologyItemSchema,
  fields: {
    text: ['items[].name', 'items[].aliases[]'],
    tags: ['items[].tags[]'],
  },
});

export const cipherConventionsKind = defineEraKind({
  kind: 'cipher-conventions',
  dir: 'cipher-conventions',
  schema: CipherConventionsSchema,
  fields: {
    templates: [{ path: 'items[].headers[]', style: 'other' }],
  },
});

export const anachronismsKind = defineEraKind({
  kind: 'anachronisms',
  dir: 'anachronisms',
  schema: AnachronismEntrySchema,
  fields: {
    text: ['items[].note'],
  },
});

export const blocklistKind = defineEraKind({
  kind: 'blocklist',
  dir: 'blocklist',
  schema: BlocklistEntrySchema,
  fields: {
    names: ['items[].name'],
    text: ['items[].note'],
  },
});

export const styleGuideKind = defineEraKind({
  kind: 'style-guide',
  dir: 'style-guide',
  schema: StyleRuleSchema,
  fields: {
    text: ['items[].message'],
  },
});

export const sensitivityKind = defineEraKind({
  kind: 'sensitivity',
  dir: 'sensitivity',
  schema: SensitivityTermSchema,
  fields: {},
});

export const publicTextKind = defineEraKind({
  kind: 'public-text',
  dir: 'public-texts',
  schema: PublicTextSchema,
  fields: {
    text: ['items[].title', 'items[].body[]'],
  },
});

/** Every Era kind registered by this module. */
export const ERA_KINDS = [
  eraKind,
  technologyKind,
  cipherConventionsKind,
  anachronismsKind,
  blocklistKind,
  styleGuideKind,
  sensitivityKind,
  publicTextKind,
];
