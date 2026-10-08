/**
 * Headquarters phase (campaign-career task 13.1; Requirement 20.4).
 *
 * One screen for the whole between-posting sequence. The step view supplies
 * the debrief, review cable, capture, assets, arcs, offers and preparation,
 * and every option is shown with its quote. Choosing an allowed option calls
 * `onChoose` with that choice. The screen does not step the career itself.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CampaignChoice, HqOptionView, HqStepView } from '@tradecraft/player-view';

export interface HqScreenProps {
  readonly step: HqStepView;
  readonly options: readonly HqOptionView[];
  readonly officerName?: string;
  readonly year?: number;
  readonly alerts?: readonly string[];
  readonly onChoose: (choice: CampaignChoice) => void;
}

const TITLES: Readonly<Record<HqStepView['kind'], string>> = {
  creation: 'Creation',
  offers: 'Posting offers',
  prepare: 'Preparation',
  posting: 'Posting',
  debrief: 'Debrief',
  review: 'Review Board',
  capture: 'Capture',
  assets: 'Asset decisions',
  arcs: 'Arc events',
  'end-offers': 'End offers',
  ended: 'Campaign end',
};

function choiceLabel(choice: CampaignChoice, step: HqStepView): string {
  switch (choice.kind) {
    case 'create':
      return 'Create the career';
    case 'advance':
      return 'Continue';
    case 'accept-offer': {
      const offer = step.offers.find((row) => row.id === choice.offer);
      if (offer === undefined) {
        return `Accept ${choice.offer}`;
      }
      return `Accept ${offer.city} (${offer.tier}, ${offer.year})`;
    }
    case 'asset-decision': {
      const asset = step.staged.assets.find((row) => row.id === choice.asset);
      const name = asset === undefined ? choice.asset : asset.name;
      if (choice.decision === 'handover') {
        return `Hand over ${name}`;
      }
      if (choice.decision === 'exfiltrate') {
        return `Exfiltrate ${name}`;
      }
      return `Bring ${name}`;
    }
    case 'train':
      return `Train ${choice.skill}`;
    case 'leave':
      return 'Take leave';
    case 'requisition':
      return `Requisition ${choice.id}`;
    case 'legend':
      return `Legend ${choice.cover} as ${choice.name}`;
    case 'accuse':
      return `Accuse ${choice.figure}`;
    case 'adopt-manifest':
      return 'Adopt the content manifest';
    case 'retire':
      return 'Retire';
    case 'defect':
      return 'Defect';
    case 'decline-end-offer':
      return 'Decline and see other postings';
    default:
      return 'Choose';
  }
}

function quoteText(option: HqOptionView): string {
  const verdict = option.quote.allowed ? 'allowed' : 'refused';
  const reason = option.quote.reason === '' ? '' : ` — ${option.quote.reason}`;
  return `${verdict}${reason} (cost ${option.quote.cost})`;
}

function StepBody({ step }: { readonly step: HqStepView }): ReactElement {
  if (step.kind === 'debrief') {
    return <Text>The posting is closed. Continue when the debrief has been read.</Text>;
  }
  if (step.kind === 'review') {
    const review = step.staged.review;
    if (review === undefined) {
      return <Text>The review board has not recorded a decision.</Text>;
    }
    return (
      <Text>
        {review.text} ({review.decision}, score {review.score})
      </Text>
    );
  }
  if (step.kind === 'capture') {
    const capture = step.staged.capture;
    if (capture === undefined) {
      return <Text>No capture is staged.</Text>;
    }
    if (capture.kind === 'death') {
      return <Text>The capture ends in death.</Text>;
    }
    const offer = capture.defectionOffer ? ' Defection is offered.' : '';
    return (
      <Text>
        {capture.kind}, {capture.yearsLost} years lost.{offer}
      </Text>
    );
  }
  if (step.kind === 'assets') {
    if (step.staged.assets.length === 0) {
      return <Text>No surviving assets.</Text>;
    }
    return (
      <Box flexDirection="column">
        {step.staged.assets.map((asset) => (
          <Text key={asset.id}>
            {asset.name} — {asset.rapport}. {asset.history}
          </Text>
        ))}
      </Box>
    );
  }
  if (step.kind === 'arcs') {
    if (step.arcs.length === 0) {
      return <Text>No arc events.</Text>;
    }
    return (
      <Box flexDirection="column">
        {step.arcs.map((arc) => (
          <Text key={arc.id}>
            {arc.id}: {arc.stage} ({arc.status})
          </Text>
        ))}
      </Box>
    );
  }
  if (step.kind === 'offers' || step.kind === 'end-offers') {
    if (step.offers.length === 0) {
      return <Text>No postings are on offer.</Text>;
    }
    return (
      <Box flexDirection="column">
        {step.offers.map((offer) => (
          <Text key={offer.id}>
            {offer.city} · {offer.service} · {offer.year} · {offer.tier} · {offer.theme}
            {offer.assigned ? ' · assigned' : ''}
          </Text>
        ))}
      </Box>
    );
  }
  if (step.kind === 'prepare') {
    const pending =
      step.pendingRequisitions.length === 0 ? 'none' : step.pendingRequisitions.join(', ');
    return (
      <Text>
        Training used {step.trainingUsed}. Requisitions: {pending}. Choose a legend before departure.
      </Text>
    );
  }
  if (step.kind === 'ended') {
    return <Text>The career has ended.</Text>;
  }
  if (step.kind === 'posting') {
    return <Text>A posting is in progress.</Text>;
  }
  return <Text>Name the officer to begin.</Text>;
}

export function HqScreen({
  step,
  options,
  officerName,
  year,
  alerts = [],
  onChoose,
}: HqScreenProps): ReactElement {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [step.kind]);

  const selected = options.length === 0 ? 0 : Math.min(index, options.length - 1);

  useInput((_input, key) => {
    if (options.length === 0) {
      return;
    }
    if (key.upArrow) {
      setIndex((current) => (current - 1 + options.length) % options.length);
      return;
    }
    if (key.downArrow) {
      setIndex((current) => (current + 1) % options.length);
      return;
    }
    if (key.return) {
      const option = options[selected];
      if (option !== undefined && option.quote.allowed) {
        onChoose(option.choice);
      }
    }
  });

  const heading = officerName === undefined ? TITLES[step.kind] : `${TITLES[step.kind]} — ${officerName}`;

  return (
    <Box flexDirection="column">
      <Text bold>
        {heading}
        {year === undefined ? '' : `, ${year}`}
      </Text>
      <Box marginTop={1}>
        <StepBody step={step} />
      </Box>
      {alerts.length === 0 ? null : (
        <Box flexDirection="column" marginTop={1}>
          {alerts.map((alert) => (
            <Text key={alert} color="yellow">
              {alert}
            </Text>
          ))}
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        {options.length === 0 ? <Text dimColor>No choices.</Text> : null}
        {options.map((option, row) => {
          const focused = row === selected;
          return (
            <Text key={choiceKey(option.choice)} color={focused ? 'cyan' : undefined}>
              {focused ? '> ' : '  '}
              {choiceLabel(option.choice, step)} — {quoteText(option)}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ move · Enter to choose</Text>
      </Box>
    </Box>
  );
}

function choiceKey(choice: CampaignChoice): string {
  switch (choice.kind) {
    case 'accept-offer':
      return `accept-offer:${choice.offer}`;
    case 'asset-decision':
      return `asset:${choice.asset}:${choice.decision}`;
    case 'train':
      return `train:${choice.skill}`;
    case 'requisition':
      return `requisition:${choice.id}`;
    case 'legend':
      return `legend:${choice.cover}:${choice.name}`;
    case 'accuse':
      return `accuse:${choice.figure}`;
    case 'create':
      return `create:${choice.officerName}`;
    case 'adopt-manifest':
      return 'adopt-manifest';
    default:
      return choice.kind;
  }
}
