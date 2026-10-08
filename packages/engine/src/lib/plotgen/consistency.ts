/**
 * Cross-plot consistency (plot-library Req 9). Functional predicates may not
 * carry two objects for one subject in overlapping windows, and an NPC may
 * not be booked at two locations in one phase.
 */

export interface ConsistencyFact {
  readonly id: string;
  readonly predicate: string;
  readonly subject: string;
  readonly object: string;
  readonly from: number;
  readonly to: number;
}

export interface ScheduleEntry {
  readonly npc: string;
  readonly at: number;
  readonly place: string;
  readonly source: string;
  /** Lower sorts first: primary, then secondary, then side threads. */
  readonly precedence: number;
}

export type Conflict =
  | { readonly kind: 'functional'; readonly predicate: string; readonly subject: string; readonly a: string; readonly b: string }
  | { readonly kind: 'double-booked'; readonly npc: string; readonly at: number; readonly a: string; readonly b: string };

function overlaps(a: ConsistencyFact, b: ConsistencyFact): boolean {
  return a.from < b.to && b.from < a.to;
}

/** Functional conflicts and double-booked phases. */
export function checkConsistency(
  facts: readonly ConsistencyFact[],
  functional: ReadonlySet<string>,
  schedule: readonly ScheduleEntry[],
): Conflict[] {
  const conflicts: Conflict[] = [];
  const groups = new Map<string, ConsistencyFact[]>();
  for (const fact of facts) {
    if (!functional.has(fact.predicate)) {
      continue;
    }
    const key = `${fact.predicate}\u0000${fact.subject}`;
    const list = groups.get(key) ?? [];
    list.push(fact);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (a !== undefined && b !== undefined && a.object !== b.object && overlaps(a, b)) {
          conflicts.push({
            kind: 'functional',
            predicate: a.predicate,
            subject: a.subject,
            a: a.id,
            b: b.id,
          });
        }
      }
    }
  }

  const byNpcPhase = new Map<string, ScheduleEntry[]>();
  for (const entry of schedule) {
    const key = `${entry.npc}\u0000${entry.at}`;
    const list = byNpcPhase.get(key) ?? [];
    list.push(entry);
    byNpcPhase.set(key, list);
  }
  for (const list of byNpcPhase.values()) {
    const places = new Set(list.map((entry) => entry.place));
    if (places.size > 1) {
      const ordered = [...list].sort((a, b) => a.precedence - b.precedence || (a.source < b.source ? -1 : 1));
      const first = ordered[0];
      const second = ordered[1];
      if (first !== undefined && second !== undefined) {
        conflicts.push({
          kind: 'double-booked',
          npc: first.npc,
          at: first.at,
          a: first.source,
          b: second.source,
        });
      }
    }
  }
  return conflicts;
}

/**
 * Shift the later schedule entry to the nearest free phase inside
 * `[at, deadline]`. Returns the updated schedule, or undefined when no free
 * phase exists.
 */
export function reschedule(
  schedule: readonly ScheduleEntry[],
  conflict: Extract<Conflict, { kind: 'double-booked' }>,
  deadline: number,
): ScheduleEntry[] | undefined {
  const later = schedule
    .filter((entry) => entry.npc === conflict.npc && entry.at === conflict.at)
    .sort((a, b) => b.precedence - a.precedence)[0];
  if (later === undefined) {
    return undefined;
  }
  const occupied = new Set(
    schedule.filter((entry) => entry.npc === later.npc).map((entry) => entry.at),
  );
  for (let at = conflict.at + 1; at <= deadline; at += 1) {
    if (!occupied.has(at)) {
      return schedule.map((entry) => (entry === later ? { ...entry, at } : entry));
    }
  }
  return undefined;
}
