/**
 * Archive, Officer, Known Enemies and Campaign End (campaign-career task 13.2).
 *
 * Each screen renders a view the Campaign API already returns. The archive
 * case file is read-only. A legend is marked burned only when that view says
 * the player observed the burn. Load failures name the reason and leave the
 * open career untouched.
 */

import type { ReactElement } from 'react';
import { Box, Text } from 'ink';
import type {
  ArchiveView,
  CampaignLoadError,
  KnownEnemyView,
  ManifestDifference,
  OfficerView,
} from '@tradecraft/player-view';

export interface CampaignEndSummary {
  readonly kind: 'retirement' | 'death' | 'disgrace' | 'defection';
  readonly year: number;
  readonly posting: number;
  readonly cause: string;
  readonly rank: string;
}

export type CampaignScreenError =
  | CampaignLoadError
  | { readonly kind: 'manifest-mismatch'; readonly differing: readonly ManifestDifference[] };

const END_LABELS: Readonly<Record<CampaignEndSummary['kind'], string>> = {
  retirement: 'Retirement',
  death: 'Death',
  disgrace: 'Disgrace',
  defection: 'Defection',
};

function skillLines(skills: OfficerView['skills']): readonly string[] {
  return Object.entries(skills)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, skill]) => `${id}  level ${skill.level}  xp ${skill.xp}`);
}

function debriefLines(archive: ArchiveView): readonly string[] {
  const lines: string[] = [];
  for (const entry of archive.timeline) {
    for (const section of entry.debrief.sections) {
      for (const item of section.items) {
        if (item.kind === 'shown') {
          lines.push(`${section.id}: ${item.item.text}`);
        } else {
          lines.push(`${section.id}: [redacted ${item.ref}]`);
        }
      }
    }
  }
  return lines;
}

function caseFileLines(archive: ArchiveView): readonly string[] {
  const lines: string[] = [];
  for (const entry of archive.timeline) {
    const file = entry.caseFile;
    lines.push(`Case file ${file.ref}`);
    for (const person of file.identified) {
      lines.push(`  ${person.name}`);
    }
    for (const person of file.unidentified) {
      lines.push(`  ${person.descriptor}`);
    }
    for (const claim of file.heldClaims) {
      lines.push(`  ${claim.text}`);
    }
    for (const note of file.notes) {
      lines.push(`  ${note.text}`);
    }
  }
  return lines;
}

function revealLines(archive: ArchiveView): readonly string[] {
  if (!archive.revealed || archive.debriefs === undefined) {
    return [];
  }
  const lines: string[] = [];
  for (const debrief of archive.debriefs) {
    lines.push(`${debrief.outcome} (${debrief.cause})`);
    for (const section of debrief.sections) {
      lines.push(`${section.id}: ${section.text}`);
    }
  }
  return lines;
}

export function ArchiveScreen({ archive }: { readonly archive: ArchiveView }): ReactElement {
  const timeline = archive.timeline.map(
    (entry) =>
      `Posting ${entry.index + 1}  ${entry.city}  ${entry.year}  ${entry.rank}  ${entry.legend}  ${entry.outcome}`,
  );
  return (
    <Box flexDirection="column">
      <Text bold>Archive</Text>
      <Box flexDirection="column" marginTop={1}>
        {timeline.length === 0 ? <Text>No postings yet.</Text> : null}
        {timeline.map((line) => (
          <Text key={line}>{line}</Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Debrief</Text>
        {debriefLines(archive).map((line) => (
          <Text key={line}>{line}</Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Case file</Text>
        {caseFileLines(archive).map((line) => (
          <Text key={line}>{line}</Text>
        ))}
      </Box>
      {archive.revealed ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Full reveal</Text>
          {revealLines(archive).map((line) => (
            <Text key={line}>{line}</Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

export function OfficerScreen({ officer }: { readonly officer: OfficerView }): ReactElement {
  const skills = skillLines(officer.skills);
  const traits = [...officer.traits].sort((left, right) => left.localeCompare(right));
  const factions = [...officer.factions].sort((left, right) => left.faction.localeCompare(right.faction));
  return (
    <Box flexDirection="column">
      <Text bold>
        {officer.name}  {officer.rank}
      </Text>
      <Text>Standing {officer.careerStanding}</Text>
      <Text>Stress {officer.stress}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Skills</Text>
        {skills.length === 0 ? <Text>No skills.</Text> : null}
        {skills.map((line) => (
          <Text key={line}>{line}</Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Traits</Text>
        {traits.length === 0 ? <Text>No traits.</Text> : null}
        {traits.map((trait) => (
          <Text key={trait}>{trait}</Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Legends</Text>
        {officer.legends.length === 0 ? <Text>No legends.</Text> : null}
        {officer.legends.map((legend) => (
          <Text key={legend.id}>
            {legend.name}  {legend.cover}  posting {legend.posting}
            {legend.official ? '  official' : '  non-official'}
            {legend.burned ? '  burned' : ''}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Reputation</Text>
        {factions.map((row) => (
          <Text key={row.faction}>
            {row.faction}  {row.band}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

export function KnownEnemiesScreen({
  enemies,
}: {
  readonly enemies: readonly KnownEnemyView[];
}): ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Known enemies</Text>
      <Box flexDirection="column" marginTop={1}>
        {enemies.length === 0 ? <Text>No known enemies.</Text> : null}
        {enemies.map((enemy) => (
          <Text key={enemy.person}>
            {enemy.label}  {enemy.kind}
            {enemy.apparentAffiliation === undefined ? '' : `  ${enemy.apparentAffiliation}`}
            {enemy.contacts.length === 0
              ? ''
              : `  ${enemy.contacts.map((contact) => `${contact.city} ${contact.year}`).join(', ')}`}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

export function CampaignEndScreen({
  end,
  archive,
}: {
  readonly end: CampaignEndSummary;
  readonly archive: ArchiveView;
}): ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Campaign end  {END_LABELS[end.kind]}</Text>
      <Text>Final rank {end.rank}</Text>
      <Text>
        {end.year}, after posting {end.posting}
      </Text>
      <Text>{end.cause}</Text>
      <Box marginTop={1}>
        <ArchiveScreen archive={archive} />
      </Box>
    </Box>
  );
}

export function loadErrorText(error: CampaignScreenError): string {
  if (error.kind === 'campaign-version') {
    return `This save is version ${error.saved}. This career reads version ${error.supported}.`;
  }
  if (error.kind === 'migration-failed') {
    const issues = error.issues.length === 0 ? 'The save could not be migrated.' : error.issues.join(' ');
    return `Migration from version ${error.from} failed. ${issues}`;
  }
  if (error.kind === 'hash-mismatch') {
    return `The save file ${error.file} does not match its recorded hash.`;
  }
  if (error.kind === 'manifest-mismatch') {
    const packs = error.differing
      .map((row) => `${row.id} (saved ${row.saved ?? 'absent'}, loaded ${row.loaded ?? 'absent'})`)
      .join('; ');
    return `The posting was saved under different content. ${packs}`;
  }
  return `The save file ${error.file} could not be read.`;
}

export function CampaignLoadErrorScreen({ error }: { readonly error: CampaignScreenError }): ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Career not loaded</Text>
      <Text>{loadErrorText(error)}</Text>
      <Text dimColor>The open career is unchanged.</Text>
    </Box>
  );
}
