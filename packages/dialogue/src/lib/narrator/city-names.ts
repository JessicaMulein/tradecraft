/**
 * City names the Specifics Guard may treat as allowed names (Requirement 17.5).
 *
 * A regional world publishes every city's name. Slice worlds have no region, so
 * the list is empty and the guard's allowlist is unchanged.
 */

export function knownCityNames(state: {
  readonly region?: {
    readonly order: readonly string[];
    readonly cities: Readonly<Record<string, { readonly name?: string } | undefined>>;
  };
}): readonly string[] {
  const region = state.region;
  if (region === undefined) {
    return [];
  }
  const names: string[] = [];
  for (const id of region.order) {
    const name = region.cities[id]?.name?.trim();
    if (name !== undefined && name.length > 0) {
      names.push(name);
    }
  }
  return names;
}
