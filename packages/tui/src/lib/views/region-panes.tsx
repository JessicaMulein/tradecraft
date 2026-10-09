/**
 * Regional screens (multi-city Requirement 17): the region map, the departures
 * board, held papers and the carriage.
 */

import type { ReactElement } from 'react';
import { Box, Text } from 'ink';
import type { CarriageView, DepartureView, PaperView, RegionMapView } from '@tradecraft/player-view';

import { formatTime } from '../scene/time.js';

function quoteLabel(quote: {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly phases: number;
} | undefined): string {
  if (quote === undefined) {
    return '';
  }
  if (quote.allowed) {
    return ` · quote ${quote.phases} phases`;
  }
  return ` · ${quote.reason ?? 'refused'}`;
}

export function RegionMapPane({ view }: { readonly view: RegionMapView | undefined }): ReactElement {
  if (view === undefined) {
    return (
      <Box flexDirection="column">
        <Text bold>Region</Text>
        <Text dimColor>This game is a single city.</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text bold>Region · {view.template}</Text>
      {view.cities.map((city) => (
        <Box key={city.id} flexDirection="column">
          <Text color={city.id === view.here ? 'cyan' : undefined}>
            {city.id === view.here ? '> ' : '  '}
            {city.name}
            {city.country === undefined ? '' : ` · ${city.country}`}
          </Text>
          {city.locations.map((loc) => (
            <Text key={loc.id} dimColor>
              {'    '}
              {loc.name}
            </Text>
          ))}
        </Box>
      ))}
      <Text bold>Routes</Text>
      {view.routes.length === 0 ? (
        <Text dimColor>No intercity routes.</Text>
      ) : (
        view.routes.map((route) => (
          <Text key={route.id}>
            {route.fromName} → {route.toName} · {route.mode} · {route.duration} phases · {route.fare}
            {route.borders.length === 0 ? '' : ` · ${route.borders.join(', ')}`}
          </Text>
        ))
      )}
    </Box>
  );
}

export function DeparturesPane({ view }: { readonly view: readonly DepartureView[] }): ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Departures</Text>
      {view.length === 0 ? (
        <Text dimColor>No departure from here.</Text>
      ) : (
        view.map((row) => (
          <Text key={row.route}>
            {row.mode} → {row.destination} · {formatTime(row.at)} · {row.duration} phases · {row.fare}
            {row.borders.length === 0 ? '' : ` · ${row.borders.join(', ')}`}
            {quoteLabel(row.quote)}
          </Text>
        ))
      )}
    </Box>
  );
}

export function PapersPane({ papers }: { readonly papers: readonly PaperView[] }): ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Papers</Text>
      {papers.length === 0 ? (
        <Text dimColor>No papers in hand.</Text>
      ) : (
        papers.map((paper) => (
          <Box key={paper.id} flexDirection="column">
            <Text>
              {paper.kind} · {paper.holder} · {paper.issuedBy.kind} {paper.issuedBy.id}
            </Text>
            <Text dimColor>
              {paper.valid === undefined
                ? 'validity unset'
                : `${formatTime(paper.valid.from)} – ${formatTime(paper.valid.to)}`}
              {paper.satisfies.length === 0 ? '' : ` · ${paper.satisfies.join(', ')}`}
            </Text>
          </Box>
        ))
      )}
    </Box>
  );
}

export function CarriagePane({ view }: { readonly view: CarriageView | undefined }): ReactElement {
  if (view === undefined) {
    return (
      <Box flexDirection="column">
        <Text bold>Carriage</Text>
        <Text dimColor>You are not in transit.</Text>
      </Box>
    );
  }
  const arrives = view.arrives === undefined ? 'arrival unset' : `arrives ${formatTime(view.arrives)}`;
  return (
    <Box flexDirection="column">
      <Text bold>
        Carriage → {view.destination} · {arrives}
      </Text>
      {view.travellers.map((who) => (
        <Text key={who}>{who}</Text>
      ))}
      <Text dimColor>Talk and observe from the scene.</Text>
    </Box>
  );
}
