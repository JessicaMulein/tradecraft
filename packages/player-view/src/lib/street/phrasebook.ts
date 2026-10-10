/**
 * Player-facing words for street actions. The terminal menu and the web shell
 * use these phrases, so a drive reads the same way in both.
 */

export function describeStreetAction(action: {
  readonly kind: string;
  readonly vehicle?: string;
  readonly relative?: string;
  readonly street?: string;
  readonly id?: string;
  readonly mode?: string;
  readonly npc?: string;
  readonly spot?: string;
  readonly loc?: string;
  readonly template?: string;
}): string | undefined {
  if (action.kind === 'street-ops.drive') {
    if (action.vehicle === undefined) return 'drive';
    return `drive the ${plain(action.vehicle)}`;
  }
  if (action.kind === 'street-ops.turn') {
    const relative = action.relative ?? 'turn';
    if (action.street === undefined) return relative;
    return `${relative} onto ${action.street}`;
  }
  if (action.kind === 'street-ops.park') return 'park';
  if (action.kind === 'street-ops.look') return action.mode === 'check-mirror' ? 'check the mirror' : 'look around';
  if (action.kind === 'street-ops.maneuver') {
    if (action.id === undefined) return 'maneuver';
    return `take the ${plain(action.id)}`;
  }
  if (action.kind === 'street-ops.pickup') {
    const who = action.npc === undefined ? 'a passenger' : plain(action.npc);
    if (action.mode === 'concealed') return `hide ${who}`;
    return `take ${who} in the car`;
  }
  if (action.kind === 'street-ops.dropoff') {
    const who = action.npc === undefined ? 'a passenger' : plain(action.npc);
    return `let ${who} out`;
  }
  if (action.kind === 'street-ops.bluff') {
    if (action.template === undefined) return 'give a story';
    return `tell the ${plain(action.template)} story`;
  }
  if (action.kind === 'street-ops.read-map') return 'read the map';
  if (action.kind === 'street-ops.navigate') return 'consult a navigation aid';
  if (action.kind === 'street-ops.hire') {
    if (action.vehicle === undefined) return 'hire a car';
    return `hire the ${plain(action.vehicle)}`;
  }
  if (action.kind === 'street-ops.return') {
    if (action.vehicle === undefined) return 'return a car';
    return `return the ${plain(action.vehicle)}`;
  }
  if (action.kind === 'street-ops.swap-plate') return 'change the plates';
  return undefined;
}

/** The row both shells show. Street phrases stay detailed; other kinds get a short name. */
export function describeCatalogueAction(action: {
  readonly kind: string;
  readonly vehicle?: string;
  readonly relative?: string;
  readonly street?: string;
  readonly id?: string;
  readonly mode?: string;
  readonly npc?: string;
  readonly spot?: string;
  readonly loc?: string;
  readonly template?: string;
  readonly country?: string;
}): string {
  const street = describeStreetAction(action);
  if (street !== undefined) return street;
  if (action.kind === 'attend-duty') return 'attend duty';
  if (action.kind === 'depart') return 'depart';
  if (action.kind === 'request-papers') return 'request papers';
  if (action.kind === 'apply-visa') {
    return action.country === undefined ? 'apply for a visa' : `apply for a visa to ${plain(action.country)}`;
  }
  if (action.kind === 'liaison-request') return 'ask a liaison';
  if (action.kind === 'liaison-share') return 'share with a liaison';
  if (action.kind === 'exfiltrate') return 'exfiltrate an asset';
  return action.kind;
}

/** The street phrases natural-language commands confirm before a risky one. */
export const STREET_PHRASES = ['drive', 'turn', 'park', 'look around', 'check the mirror', 'maneuver', 'take', 'hide', 'let', 'tell'] as const;

function plain(id: string): string {
  const tail = id.slice(id.lastIndexOf('/') + 1).replace(/-/g, ' ').trim();
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}
