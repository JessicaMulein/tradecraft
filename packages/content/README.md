# content

Zod schemas and JSON Schema exports for Tradecraft Content Packs.

This package owns the shape of every content kind that packs may declare
(`pack.yaml`, archetypes, Location Types, Plot and Side Thread templates,
documents, personas, Cover Identities, Rumour templates, hints, Difficulty
Presets and predicate definitions). It depends only on `zod` and `yaml`.

## Building

Run `nx build content` to build the library.

## Running unit tests

Run `nx test content` to execute the unit tests via [Vitest](https://vitest.dev/).
