/**
 * The Service Definition kind (content-expansion task 1.8).
 *
 * A Service Definition names an intelligence or security service — the
 * Station's own service, a hostile service, a local-security service or an
 * allied liaison. The shared services live in an Era Pack; a City Pack's
 * local-security service is City-Scoped. Task 1.8 replaces the stub schema with
 * `ServiceDefinition` and fills in its Field Declarations, following the
 * design's "Service Definitions" section.
 *
 * Because the kind is allowed in two roles with different scoping, it is
 * registered once with `roles: ['era', 'city']`; the loader applies the
 * City-Scoped ownership check only to the instances a City Pack defines. The
 * registration is marked `cityScoped: true` so the loader treats a City Pack's
 * services as owned by that city; era-pack services are shared and the loader's
 * city-scope check (task 2.1) exempts them by role.
 *
 * A `CityDefinition.services` entry references a Service Definition id; the
 * loader resolves that reference against this kind's registry so an unresolved
 * id is a located `ContentError` (Req 19.2).
 */

import { z } from 'zod';

import {
  AliasSchema,
  ContentIdSchema,
  ProbabilitySchema,
  TagIdSchema,
  YearRangeSchema,
} from '../lib/common.js';
import type { ContentKindRegistration } from '../lib/registry.js';

import { CONTENT_EXPANSION_OWNER } from './stub.js';

/**
 * What a service is to the Station: `own` is the player's own service, `hostile`
 * is an opposing service, `local-security` is the city's police/security
 * apparatus (City-Scoped when a City Pack defines it) and `liaison` is an
 * allied service the Station cooperates with (design, "Service Definitions").
 */
export const SERVICE_KINDS = [
  'own',
  'hostile',
  'local-security',
  'liaison',
] as const;
export const ServiceKindSchema = z.enum(SERVICE_KINDS);
export type ServiceKind = z.infer<typeof ServiceKindSchema>;

/**
 * A service's doctrine base: the slice Hostile Service doctrine dimensions
 * (`packages/engine` `hostile/doctrine.ts`), each a value in `[0, 1]`. It is a
 * `Partial<Doctrine>` — an author may fix none, some or all of the three
 * dimensions and leave the rest to the preset's ranges at draw time. The three
 * dimensions mirror the slice `Doctrine` interface so a fixed value feeds the
 * Hostile Service AI without conversion.
 */
export const DoctrineBaseSchema = z
  .object({
    /** Tolerance for Abort Pressure / leader suspicion, in `[0, 1]`. */
    riskTolerance: ProbabilitySchema.optional(),
    /** How hard the service hunts the player's network, in `[0, 1]`. */
    securityConsciousness: ProbabilitySchema.optional(),
    /** Taste for running deception over making arrests, in `[0, 1]`. */
    deceptionAppetite: ProbabilitySchema.optional(),
  })
  .strict();
export type DoctrineBase = z.infer<typeof DoctrineBaseSchema>;

/**
 * A Service Definition: a fictional intelligence or security service with a
 * stable id, its fictional `name` and `aliases` (Req 3.5), its `kind`, the
 * `country` it answers to, a `doctrineBase` slice of the Hostile Service
 * doctrine and optional `years` and `tags`. One service keeps one id across
 * cities, regions and campaigns, so follow-on specs (multi-city,
 * campaign-career) key their own records off it by `ServiceId` (Req 19.4).
 */
export const ServiceDefinitionSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1),
    aliases: z.array(AliasSchema).default([]),
    kind: ServiceKindSchema,
    country: z.string().min(1),
    doctrineBase: DoctrineBaseSchema.default({}),
    years: YearRangeSchema.optional(),
    tags: z.array(TagIdSchema).optional(),
  })
  .strict();
export type ServiceDefinition = z.infer<typeof ServiceDefinitionSchema>;

/**
 * The `service` kind registration. Allowed in Era Packs (shared services) and
 * City Packs (a City-Scoped local-security service), hence `roles: ['era',
 * 'city']` and `cityScoped: true`. Its Field Declarations name the fictional
 * `name` and `aliases` text the Lint Rules scan, the `tags` Tag field and the
 * optional `years` Year Range.
 */
export const serviceKind: ContentKindRegistration<ServiceDefinition> = {
  kind: 'service',
  dir: 'services',
  schema: ServiceDefinitionSchema,
  roles: ['era', 'city'],
  cityScoped: true,
  fields: {
    text: ['items[].name', 'items[].aliases[].text'],
    tags: ['items[].tags[]'],
    years: ['items[].years'],
  },
  owner: CONTENT_EXPANSION_OWNER,
};
