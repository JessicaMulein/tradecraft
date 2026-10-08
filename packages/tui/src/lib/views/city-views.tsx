/**
 * City, Stories and Duties panes, and the notice lines posted at a Location
 * (ambient-world Req 14.7, 17.6, 20.4).
 */

import type { ReactElement } from 'react';
import { Box, Text } from 'ink';
import type { CityView, DutiesView, StoriesView } from '@tradecraft/player-view';

export function CityPane({ view }: { readonly view: CityView }): ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>City</Text>
      {view.events.length === 0 ? (
        <Text dimColor>Nothing you have heard about yet.</Text>
      ) : (
        view.events.map((event) => <Text key={event.id}>{event.name}</Text>)
      )}
    </Box>
  );
}

export function StoriesPane({ view }: { readonly view: StoriesView }): ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Stories</Text>
      {view.stories.length === 0 ? (
        <Text dimColor>No story you have read.</Text>
      ) : (
        view.stories.map((story) => (
          <Box key={story.id} flexDirection="column" marginTop={1}>
            <Text>
              {story.title} ({story.status})
            </Text>
            {story.articles.map((article) => (
              <Text key={article.doc} dimColor>
                {'  '}
                {article.title}
              </Text>
            ))}
          </Box>
        ))
      )}
    </Box>
  );
}

export function DutiesPane({ view }: { readonly view: DutiesView }): ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Cover duties</Text>
      <Text dimColor>
        Standing {view.band} ({view.standing})
      </Text>
      {view.duties.length === 0 ? (
        <Text dimColor>No duties this week.</Text>
      ) : (
        view.duties.map((duty) => (
          <Text key={duty.id}>
            {duty.template} · day {duty.day} · {duty.status}
            {duty.mandatory ? ' · mandatory' : ''}
          </Text>
        ))
      )}
    </Box>
  );
}

/** Fact lines for notices posted where the player is. */
export function NoticeLines({ lines }: { readonly lines: readonly string[] }): ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Notices</Text>
      {lines.length === 0 ? (
        <Text dimColor>No notices posted.</Text>
      ) : (
        lines.map((line) => <Text key={line}>{line}</Text>)
      )}
    </Box>
  );
}
