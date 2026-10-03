/**
 * The optional write-only {@link UsageSink} (content-expansion task 3.8;
 * design, "Coverage Report").
 *
 * `generate` accepts an optional `UsageSink`. The sink is **write-only**: the
 * generator only ever calls `use(kind, id)` on it to record that it drew a
 * content item, and never reads anything back. Because the generator never
 * reads the sink, the generated world is byte-identical whether or not a sink
 * is passed (design, Property 14: "Passing a `UsageSink` does not change the
 * result"). The Coverage Report (task 5.11) passes a collecting sink to tally
 * how often each content item is drawn across many seeds; production generation
 * passes none.
 *
 * The sink is deliberately tiny — one method — so the generator can thread it
 * through the setting and naming steps with no coupling to the coverage
 * accounting that reads the tallies.
 */

/**
 * A write-only usage collector (design, `UsageSink`). The generator calls
 * `use(kind, id)` once for each content item it draws — a Culture Group, a
 * Descriptor Fragment, a Location, a Cover Identity — tagging the draw with the
 * item's kind and its namespaced id. The generator never reads the sink, so an
 * implementation is free to accumulate counts however it likes without
 * perturbing generation.
 */
export interface UsageSink {
  /** Record that the generator drew the content item `id` of kind `kind`. */
  use(kind: string, id: string): void;
}

/**
 * A no-op {@link UsageSink} the generator uses when a caller passes none. Its
 * `use` does nothing, so the default generation path carries no collection
 * overhead and stays identical to a run with a real sink (which the generator
 * also never reads).
 */
export const NO_USAGE_SINK: UsageSink = {
  use() {
    /* write-only and discarded: the default path collects nothing */
  },
};

/**
 * A simple collecting {@link UsageSink} for the Coverage Report and tests: it
 * tallies `use(kind, id)` calls into a `(kind, id) → count` map. Write-only
 * from the generator's point of view (the generator only calls `use`); the
 * `counts` read side is for the coverage accounting that owns the sink.
 */
export class CountingUsageSink implements UsageSink {
  private readonly tally = new Map<string, number>();

  use(kind: string, id: string): void {
    const key = `${kind}\u0000${id}`;
    this.tally.set(key, (this.tally.get(key) ?? 0) + 1);
  }

  /** The number of times `id` of kind `kind` was drawn. */
  count(kind: string, id: string): number {
    return this.tally.get(`${kind}\u0000${id}`) ?? 0;
  }

  /** Every recorded `(kind, id, count)` tuple, id-sorted for deterministic output. */
  entries(): { kind: string; id: string; count: number }[] {
    const out: { kind: string; id: string; count: number }[] = [];
    for (const [key, count] of this.tally) {
      const sep = key.indexOf('\u0000');
      out.push({ kind: key.slice(0, sep), id: key.slice(sep + 1), count });
    }
    return out.sort((a, b) =>
      a.kind !== b.kind
        ? a.kind < b.kind
          ? -1
          : 1
        : a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0,
    );
  }
}
