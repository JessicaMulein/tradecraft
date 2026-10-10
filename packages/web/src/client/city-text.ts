/**
 * Plain text for the web shell's city aids. The browser turns these lines into
 * elements; tests snapshot the lines themselves.
 */

export interface CityEventLine {
  readonly id: string;
  readonly name: string;
}

export interface StoryLine {
  readonly title: string;
  readonly status: string;
  readonly articles: readonly { readonly title: string }[];
}

export interface DutyLine {
  readonly template: string;
  readonly day: number;
  readonly status: string;
  readonly mandatory: boolean;
}

export interface MapPlaceLine {
  readonly name: string;
  readonly status?: string;
}

const DUTY_KINDS = new Set(['cover-duty-due', 'cover-duty-missed', 'cover-employer-message']);

export function cityLines(events: readonly CityEventLine[]): readonly string[] {
  if (events.length === 0) {
    return ['Nothing you have heard about yet.'];
  }
  return events.map((event) => event.name);
}

export function storiesLines(stories: readonly StoryLine[]): readonly string[] {
  if (stories.length === 0) {
    return ['No story you have read.'];
  }
  return stories.flatMap((story) => [
    `${story.title} (${story.status})`,
    ...story.articles.map((article) => `  ${article.title}`),
  ]);
}

export function dutiesLines(band: string, standing: number, duties: readonly DutyLine[]): readonly string[] {
  const head = `Standing ${band} (${standing})`;
  if (duties.length === 0) {
    return [head, 'No duties this week.'];
  }
  return [
    head,
    ...duties.map(
      (duty) => `${duty.template} · day ${duty.day} · ${duty.status}${duty.mandatory ? ' · mandatory' : ''}`,
    ),
  ];
}

/** Status the player has learned, or an em dash when they have not. */
export function mapStatus(place: MapPlaceLine): string {
  return place.status === undefined || place.status.length === 0 ? '—' : place.status;
}

export function hereStatus(status: string | undefined): string | undefined {
  if (status === undefined || status.length === 0) {
    return undefined;
  }
  return `Status: ${status}`;
}

/**
 * The place never offers this action. The quote is a list of internal action
 * names, which is not something to show. A closed café or a cable that has to
 * be sent from the Station keeps its own reason.
 */
export function placeWithholds(reason: string | undefined): boolean {
  return reason !== undefined && reason.includes(' allows only:');
}

/** Notice fact lines are the ones the travel resolver prints for a posted notice. */
export function isNoticeFact(line: string): boolean {
  return line.toLowerCase().includes('notice');
}

export function isDutyAlert(kind: string | undefined): boolean {
  return kind !== undefined && DUTY_KINDS.has(kind);
}

export function statusLine(
  status: {
    readonly day: number;
    readonly phase: string;
    readonly location: string;
    readonly budget: number;
    readonly standing: number;
    readonly date?: string;
    readonly followed?: string;
  },
  dutyAlert?: string,
): string {
  const when = status.date === undefined ? `Day ${status.day}` : status.date;
  const followed =
    status.followed === undefined || status.followed.length === 0 ? '' : ` · ${status.followed}`;
  const base = `${when}, ${status.phase} · ${status.location} · budget ${status.budget} · standing ${status.standing}${followed}`;
  if (dutyAlert === undefined || dutyAlert.length === 0) {
    return base;
  }
  return `${base} · Duty: ${dutyAlert}`;
}
