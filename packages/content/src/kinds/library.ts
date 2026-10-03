/**
 * The Library kinds (content-expansion task 1.6).
 *
 * A Library Pack supplies the `culture-group` records (each with a Naming Rule
 * and gendered family names) and the `descriptor-fragment` pool. This module
 * replaces the task 1.2 stub schemas with the real `CultureGroup` and
 * `DescriptorFragment` Zod schemas from the design's "Library content" section
 * and fills in each kind's Field Declarations (text, Tags, Year Ranges, names)
 * so the loader and Pack Linter can walk them (design, "Content Kind
 * Registry"; Requirements 6.1, 6.2, 6.3, 17.1).
 */

import { z } from 'zod';

import {
  ContentIdSchema,
  TagIdSchema,
  YearRangeSchema,
} from '../lib/common.js';
import type { ContentKindRegistration } from '../lib/registry.js';
import { CONTENT_EXPANSION_OWNER } from './stub.js';

// --- NamingRule -------------------------------------------------------------

/**
 * The gendered forms of a part that differs by gender — the Russian patronymic
 * ending (`-ovich` / `-ovna`), for instance. Both forms are required so the
 * Naming Rule can render either gender.
 */
const GenderedFormsSchema = z
  .object({
    m: z.string().min(1, 'the masculine form must not be blank'),
    f: z.string().min(1, 'the feminine form must not be blank'),
  })
  .strict();

/**
 * A Culture Group's Naming Rule: the template strings the namer renders a drawn
 * name with. `display` is the everyday form (e.g. `"{given} {family}"`) and
 * `formal` the honorific form (e.g. `"{honorific} {family}"`, with the
 * honorific supplied by the Locale). `parts` turns on language-specific extras:
 * `family2` for an Iberian second surname and `patronymic` for a Russian-style
 * patronymic with its gendered endings (design, `NamingRule`).
 */
export const NamingRuleSchema = z
  .object({
    display: z.string().min(1, 'a naming rule needs a display pattern'),
    formal: z.string().min(1, 'a naming rule needs a formal pattern'),
    parts: z
      .object({
        family2: z.boolean().optional(),
        patronymic: GenderedFormsSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type NamingRule = z.infer<typeof NamingRuleSchema>;

// --- FamilyName -------------------------------------------------------------

/**
 * A family name, either a single invariant form or a pair of gendered forms for
 * a language that inflects the surname by gender (e.g. Czech Novák / Nováková).
 * The generator picks the form matching the drawn NPC's gender (design,
 * `FamilyName`).
 */
export const FamilyNameSchema = z.union([
  z.string().min(1, 'a family name must not be blank'),
  GenderedFormsSchema,
]);
export type FamilyName = z.infer<typeof FamilyNameSchema>;

// --- persona backgrounds ----------------------------------------------------

/**
 * One Year-ranged persona background a Culture Group offers: a line of cover
 * biography (`text`), the `tags` that place it in the vocabulary and an
 * optional Year Range so a background that only fits part of the Period Window
 * is filtered out by Effective Year Range (design, `CultureGroup.backgrounds`).
 */
export const PersonaBackgroundSchema = z
  .object({
    text: z.string().min(1, 'a persona background needs text'),
    tags: z.array(TagIdSchema).default([]),
    years: YearRangeSchema.optional(),
  })
  .strict();
export type PersonaBackground = z.infer<typeof PersonaBackgroundSchema>;

// --- CultureGroup -----------------------------------------------------------

/**
 * A Culture Group: the pool the NPC namer draws a culturally consistent name,
 * voice and background from. It carries the languages it speaks, its Naming
 * Rule, its given names (split by gender) and family names (with gendered forms
 * where the language has them), its voice traits and mannerisms, and its
 * Year-ranged persona backgrounds (Requirements 6.1, 7.1; design,
 * `CultureGroup`).
 */
export const CultureGroupSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1, 'a culture group needs a name'),
    languages: z
      .array(z.string().min(1))
      .min(1, 'a culture group must speak at least one language'),
    naming: NamingRuleSchema,
    given: z
      .object({
        f: z
          .array(z.string().min(1))
          .min(1, 'a culture group needs at least one feminine given name'),
        m: z
          .array(z.string().min(1))
          .min(1, 'a culture group needs at least one masculine given name'),
      })
      .strict(),
    family: z
      .array(FamilyNameSchema)
      .min(1, 'a culture group needs at least one family name'),
    voiceTraits: z.array(z.string().min(1)).default([]),
    mannerisms: z.array(z.string().min(1)).default([]),
    backgrounds: z.array(PersonaBackgroundSchema).default([]),
  })
  .strict();
export type CultureGroup = z.infer<typeof CultureGroupSchema>;

// --- DescriptorFragment -----------------------------------------------------

/**
 * The slots a Descriptor Fragment may fill — the parts of a one-line physical
 * description the generator assembles for an Unidentified Subject (design,
 * `DescriptorFragment.slot`).
 */
export const DESCRIPTOR_SLOTS = [
  'build',
  'age',
  'clothing',
  'headwear',
  'feature',
  'carried',
] as const;
export const DescriptorSlotSchema = z.enum(DESCRIPTOR_SLOTS);

/**
 * One Descriptor Fragment: a slot and the `text` that fills it, with optional
 * filters so the generator only draws fragments that fit the subject —
 * `gender`, a `climate` Tag list (a fur hat is drawn in a cold-climate city),
 * and a Year Range (period clothing). The namer appends `feature` fragments
 * until a descriptor is unique (Requirements 6.3, 6.4, 6.5; design,
 * `DescriptorFragment`).
 */
export const DescriptorFragmentSchema = z
  .object({
    id: ContentIdSchema,
    slot: DescriptorSlotSchema,
    text: z.string().min(1, 'a descriptor fragment needs text'),
    gender: z.enum(['f', 'm']).optional(),
    years: YearRangeSchema.optional(),
    climate: z.array(TagIdSchema).optional(),
  })
  .strict();
export type DescriptorFragment = z.infer<typeof DescriptorFragmentSchema>;

// --- registrations ----------------------------------------------------------

/** Build a Library-Pack kind registration with its real schema and Field Declarations. */
function defineLibraryKind<T>(args: {
  readonly kind: string;
  readonly dir: string;
  readonly schema: z.ZodType<T>;
  readonly fields: ContentKindRegistration['fields'];
}): ContentKindRegistration<T> {
  return {
    kind: args.kind,
    dir: args.dir,
    schema: args.schema,
    roles: ['library'],
    cityScoped: false,
    fields: args.fields,
    owner: CONTENT_EXPANSION_OWNER,
  };
}

export const cultureGroupKind = defineLibraryKind({
  kind: 'culture-group',
  dir: 'culture-groups',
  schema: CultureGroupSchema,
  fields: {
    text: [
      'items[].voiceTraits[]',
      'items[].mannerisms[]',
      'items[].backgrounds[].text',
    ],
    tags: ['items[].backgrounds[].tags[]'],
    years: ['items[].backgrounds[].years'],
  },
});

export const descriptorFragmentKind = defineLibraryKind({
  kind: 'descriptor-fragment',
  dir: 'descriptor-fragments',
  schema: DescriptorFragmentSchema,
  fields: {
    text: ['items[].text'],
    tags: ['items[].climate[]'],
    years: ['items[].years'],
  },
});

/** Every Library kind registered by this module. */
export const LIBRARY_KINDS = [cultureGroupKind, descriptorFragmentKind];
