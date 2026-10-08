/**
 * Ambient load checks that the content schema does not express: era-denylist
 * terms, and ambient predicates that declare arrest implications
 * (ambient-world Req 22.4).
 */

export interface AmbientIssue {
  readonly pack: string;
  readonly file: string;
  readonly path: string;
  readonly message: string;
}

const ERA_DENYLIST = [
  'smartphone',
  'internet',
  'email',
  'laptop',
  'gps',
  'drone',
  'twitter',
  'covid',
] as const;

/** Report era-denylist terms anywhere in a content value, with a field path. */
export function scanDenylist(
  value: unknown,
  pack: string,
  file: string,
  path = '',
): AmbientIssue[] {
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    const hit = ERA_DENYLIST.find((term) => lower.includes(term));
    return hit === undefined
      ? []
      : [{ pack, file, path, message: `era denylist term "${hit}"` }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      scanDenylist(item, pack, file, `${path}[${index}]`),
    );
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      scanDenylist(child, pack, file, path === '' ? key : `${path}.${key}`),
    );
  }
  return [];
}

export interface AmbientCatalogue {
  readonly stories: ReadonlySet<string>;
  readonly notices: ReadonlySet<string>;
  readonly tags: ReadonlySet<string>;
}

/** Ids that appear twice in one file. The second occurrence carries the path. */
export function duplicateIdIssues(
  items: readonly { readonly id?: unknown }[],
  pack: string,
  file: string,
): AmbientIssue[] {
  const seen = new Map<string, number>();
  const issues: AmbientIssue[] = [];
  items.forEach((item, index) => {
    if (typeof item.id !== 'string') {
      return;
    }
    if (seen.has(item.id)) {
      issues.push({
        pack,
        file,
        path: `[${index}].id`,
        message: `duplicate id "${item.id}"`,
      });
      return;
    }
    seen.set(item.id, index);
  });
  return issues;
}

function tagIssues(
  query: unknown,
  path: string,
  tags: ReadonlySet<string>,
  pack: string,
  file: string,
): AmbientIssue[] {
  if (!Array.isArray(query)) {
    return [];
  }
  return query.flatMap((tag, index) => {
    if (typeof tag === 'string' && tags.has(tag)) {
      return [];
    }
    const shown = typeof tag === 'string' ? tag : String(tag);
    return [
      {
        pack,
        file,
        path: `${path}[${index}]`,
        message: `unknown tag "${shown}"`,
      },
    ];
  });
}

function opIssues(
  op: unknown,
  path: string,
  catalogue: AmbientCatalogue,
  pack: string,
  file: string,
): AmbientIssue[] {
  if (op === null || typeof op !== 'object') {
    return [];
  }
  const record = op as Record<string, unknown>;
  const issues: AmbientIssue[] = [];
  if (record.op === 'news-development' && !catalogue.stories.has(String(record.story))) {
    issues.push({
      pack,
      file,
      path: `${path}.story`,
      message: `unknown story "${String(record.story)}"`,
    });
  }
  if (record.op === 'post-notice' && !catalogue.notices.has(String(record.template))) {
    issues.push({
      pack,
      file,
      path: `${path}.template`,
      message: `unknown notice "${String(record.template)}"`,
    });
  }
  const at = record.at;
  if (at !== null && typeof at === 'object' && 'query' in at) {
    issues.push(
      ...tagIssues((at as { query: unknown }).query, `${path}.at.query`, catalogue.tags, pack, file),
    );
  }
  const route = record.route;
  if (route !== null && typeof route === 'object' && 'query' in route) {
    issues.push(
      ...tagIssues(
        (route as { query: unknown }).query,
        `${path}.route.query`,
        catalogue.tags,
        pack,
        file,
      ),
    );
  }
  return issues;
}

/**
 * Cross-references the schema accepts as strings: story and notice ids inside
 * effect ops, and tag queries against the loaded vocabulary.
 */
export function checkAmbientRefs(
  events: readonly { readonly when?: { readonly districtQuery?: unknown }; readonly stages?: readonly { readonly ops?: readonly unknown[] }[] }[],
  incidents: readonly { readonly locQuery?: unknown }[],
  catalogue: AmbientCatalogue,
  pack: string,
  eventsFile: string,
  incidentsFile: string,
): AmbientIssue[] {
  const issues: AmbientIssue[] = [];
  events.forEach((event, eventIndex) => {
    if (event.when?.districtQuery !== undefined) {
      issues.push(
        ...tagIssues(
          event.when.districtQuery,
          `[${eventIndex}].when.districtQuery`,
          catalogue.tags,
          pack,
          eventsFile,
        ),
      );
    }
    event.stages?.forEach((stage, stageIndex) => {
      stage.ops?.forEach((op, opIndex) => {
        issues.push(
          ...opIssues(
            op,
            `[${eventIndex}].stages[${stageIndex}].ops[${opIndex}]`,
            catalogue,
            pack,
            eventsFile,
          ),
        );
      });
    });
  });
  incidents.forEach((incident, index) => {
    issues.push(
      ...tagIssues(
        incident.locQuery,
        `[${index}].locQuery`,
        catalogue.tags,
        pack,
        incidentsFile,
      ),
    );
  });
  return issues;
}

/** Ambient predicates stay out of the arrest-evidence implication table. */
export function checkAmbientPredicate(
  definition: { readonly implication?: unknown },
  pack: string,
  file: string,
  path: string,
): AmbientIssue[] {
  if (definition.implication === undefined) {
    return [];
  }
  return [
    {
      pack,
      file,
      path,
      message: 'ambient predicates must not declare implication rules',
    },
  ];
}
