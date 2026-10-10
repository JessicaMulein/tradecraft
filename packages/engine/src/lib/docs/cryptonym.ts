/**
 * A station cryptonym for a person.
 *
 * The form is an area digraph, a pronounceable stem and a serial, in the shape
 * of a period file number. The digraph `QV` and the stems are fictional. The
 * same id always yields the same cryptonym, and the true name is not readable
 * from it.
 */

const STEMS = [
  'LANTERN',
  'HARBOR',
  'PACKET',
  'WINDOW',
  'CINDER',
  'MARTIN',
  'CLOVER',
  'BRIDGE',
  'NEEDLE',
  'WALNUT',
  'PIPER',
  'GARNET',
] as const;

/** `npc:ada-berger-1` → a stable cryptonym such as `QVLANTERN-4`. */
export function cryptonym(id: string): string {
  let n = 0;
  for (let i = 0; i < id.length; i += 1) {
    n = (n + id.charCodeAt(i) * (i + 1)) % 997;
  }
  const stem = STEMS[n % STEMS.length] ?? STEMS[0];
  const serial = (n % 9) + 1;
  return `QV${stem}-${serial}`;
}
