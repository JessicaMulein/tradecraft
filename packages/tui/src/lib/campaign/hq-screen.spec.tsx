/**
 * Headquarters screen (task 13.1; Requirement 20.4).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { CampaignChoice, HqOptionView, HqStepView } from '@tradecraft/player-view';

import { HqScreen } from './hq-screen.js';

const KEY = {
  down: '\u001B[B',
  enter: '\r',
} as const;

const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};

afterEach(() => {
  cleanup();
});

function step(kind: HqStepView['kind'], extra: Partial<HqStepView> = {}): HqStepView {
  return {
    kind,
    offers: [],
    staged: { assets: [], endOffers: [] },
    pendingRequisitions: [],
    arcs: [],
    trainingUsed: 0,
    ...extra,
  };
}

function option(choice: CampaignChoice, allowed: boolean, reason: string, cost = 0): HqOptionView {
  return { choice, quote: { allowed, reason, cost } };
}

describe('HqScreen', () => {
  it('shows the review cable and each option quote', () => {
    const review = step('review', {
      staged: {
        assets: [],
        endOffers: [],
        review: { score: 4, decision: 'promote', text: 'The board promotes Ada.' },
      },
    });
    const { lastFrame } = render(
      <HqScreen
        step={review}
        officerName="Ada"
        year={1949}
        options={[
          option({ kind: 'advance' }, true, '', 0),
          option({ kind: 'leave' }, false, 'Leave is not required.', 0),
          option({ kind: 'accuse', figure: 'cp-1' }, false, 'The archive does not support that accusation.', 0),
        ]}
        onChoose={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Review Board — Ada, 1949');
    expect(frame).toContain('The board promotes Ada.');
    expect(frame).toContain('Continue — allowed (cost 0)');
    expect(frame).toContain('Take leave — refused — Leave is not required. (cost 0)');
    expect(frame).toContain('Accuse cp-1 — refused — The archive does not support that accusation.');
  });

  it('shows the debrief, capture, arcs, offers and end offers', () => {
    const frames = [
      { step: step('debrief'), text: 'The posting is closed.' },
      {
        step: step('capture', {
          staged: {
            assets: [],
            endOffers: [],
            capture: { kind: 'imprisonment', yearsLost: 2, defectionOffer: true },
          },
        }),
        text: 'imprisonment, 2 years lost. Defection is offered.',
      },
      {
        step: step('arcs', {
          arcs: [{ id: 'mole-hunt', stage: 'suspect', status: 'active' }],
        }),
        text: 'mole-hunt: suspect (active)',
      },
      {
        step: step('offers', {
          offers: [
            {
              id: 'offer-east',
              city: 'east',
              service: 'svc-east',
              year: 1949,
              tourYears: 2,
              tier: 'quiet',
              theme: 'penetrate',
              assigned: false,
            },
          ],
        }),
        text: 'east · svc-east · 1949 · quiet · penetrate',
      },
      {
        step: step('end-offers', { staged: { assets: [], endOffers: ['retire'] } }),
        text: 'End offers',
      },
    ];
    for (const row of frames) {
      const { lastFrame } = render(<HqScreen step={row.step} options={[]} onChoose={vi.fn()} />);
      expect(lastFrame()).toContain(row.text);
      cleanup();
    }
  });

  it('lists a surviving asset with the handover quote', () => {
    const assets = step('assets', {
      staged: {
        assets: [{ id: 'cp-100', name: 'Helen', rapport: 'warm', history: 'east, 1948' }],
        endOffers: [],
      },
    });
    const { lastFrame } = render(
      <HqScreen
        step={assets}
        options={[
          option({ kind: 'asset-decision', asset: 'cp-100', decision: 'handover' }, true, '', 0),
        ]}
        onChoose={vi.fn()}
      />,
    );
    expect(lastFrame()).toContain('Asset decisions');
    expect(lastFrame()).toContain('Helen — warm. east, 1948');
    expect(lastFrame()).toContain('Hand over Helen — allowed (cost 0)');
  });

  it('chooses only an allowed option', async () => {
    const onChoose = vi.fn<(choice: CampaignChoice) => void>();
    const { stdin, lastFrame } = render(
      <HqScreen
        step={step('prepare', { pendingRequisitions: ['budget-credit'], trainingUsed: 1 })}
        options={[
          option({ kind: 'requisition', id: 'budget-credit' }, true, '', 2),
          option({ kind: 'legend', cover: 'clerk', name: 'Helen' }, false, 'Choose a cover the city allows.', 0),
        ]}
        onChoose={onChoose}
      />,
    );
    await tick();
    expect(lastFrame()).toContain('Training used 1');
    expect(lastFrame()).toContain('Requisitions: budget-credit');
    expect(lastFrame()).toContain('Legend clerk as Helen — refused');
    stdin.write(KEY.down);
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onChoose).not.toHaveBeenCalled();
    stdin.write(KEY.down);
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onChoose).toHaveBeenCalledWith({ kind: 'requisition', id: 'budget-credit' });
  });
});
