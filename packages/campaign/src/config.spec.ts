import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  formatCampaignConfigIssues,
  loadCampaignConfig,
  parseCampaignConfig,
} from './config.js';

const FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'config',
  'campaign.yaml',
);

const BASE = readFileSync(FILE, 'utf8');

describe('config/campaign.yaml', () => {
  it('validates the shipped default', () => {
    const loaded = loadCampaignConfig(FILE);
    expect(loaded.ok, loaded.ok ? '' : formatCampaignConfigIssues(loaded.issues)).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.savePath).toBe('saves/campaigns');
    expect(loaded.value.notorietyDecay).toBe(0.1);
    expect(loaded.value.archiveReveal).toBe('at-end');
    expect(loaded.value.review.dismissalFloor).toBe(-8);
    expect(loaded.value.mole.threshold).toBe(3);
  });

  it('reports a bad decay, an unknown reveal mode and a low mole threshold with their paths', () => {
    const text = BASE.replace('notorietyDecay: 0.1', 'notorietyDecay: 2')
      .replace('archiveReveal: at-end', 'archiveReveal: always')
      .replace('threshold: 3', 'threshold: 0');
    const parsed = parseCampaignConfig(text, 'config/campaign.yaml');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    const lines = formatCampaignConfigIssues(parsed.issues);
    expect(parsed.issues.map((issue) => issue.path).sort()).toEqual([
      'archiveReveal',
      'mole.threshold',
      'notorietyDecay',
    ]);
    for (const issue of parsed.issues) {
      expect(issue.file).toBe('config/campaign.yaml');
      expect(lines).toContain(`config/campaign.yaml: ${issue.path}: ${issue.message}`);
    }
  });
});
