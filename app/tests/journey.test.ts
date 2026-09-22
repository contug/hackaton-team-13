import { describe, expect, it } from 'vitest';
import {
  MAX_DONE,
  advance,
  currentStep,
  fillSatisfied,
  isFinished,
  jumpTo,
  replan,
  resolvableSteps,
  skip,
  startJourney,
  type Journey,
} from '@/lib/journey';
import type { Step } from '@/lib/openrouter';
import type { OutlineEntry } from '@/lib/snapshot';

function step(over: Partial<Step> = {}): Step {
  return { text: 'Press Search', ref: 'e2', fill: '', ...over };
}

const SEARCH_FLOW: Step[] = [
  { text: 'Type the product name', ref: 'e1', fill: 'wool socks' },
  { text: 'Press Search', ref: 'e2', fill: '' },
  { text: 'Pick the item', ref: 'e3', fill: '' },
];

function journey(over: Partial<Journey> = {}): Journey {
  return { ...startJourney('buy wool socks', SEARCH_FLOW, 'https://shop.example/', 1000), ...over };
}

describe('startJourney', () => {
  it('opens at the first step, with the goal and nothing done', () => {
    const j = startJourney('buy wool socks', SEARCH_FLOW, 'https://shop.example/', 1000);

    expect(j).toEqual({
      goal: 'buy wool socks',
      steps: SEARCH_FLOW,
      index: 0,
      done: [],
      panelOpen: true,
      url: 'https://shop.example/',
      updatedAt: 1000,
    });
  });

  it('is plain JSON, so it can survive storage and a page load', () => {
    const j = startJourney('g', SEARCH_FLOW, 'u', 1);

    // The background stores this through `storage.setItem`, which structured-
    // clones it. Anything non-serializable in here would be lost silently.
    expect(JSON.parse(JSON.stringify(j))).toEqual(j);
  });
});

describe('currentStep', () => {
  it('is the step at the index', () => {
    expect(currentStep(journey())).toEqual(SEARCH_FLOW[0]);
    expect(currentStep(journey({ index: 2 }))).toEqual(SEARCH_FLOW[2]);
  });

  it('is null past the end, and null for no journey at all', () => {
    expect(currentStep(journey({ index: 3 }))).toBeNull();
    expect(currentStep(null)).toBeNull();
  });
});

describe('advance', () => {
  it('moves to the next step and records the one just done', () => {
    const next = advance(journey());

    expect(next.index).toBe(1);
    // The `done` list is the only memory of the pages we have already left.
    expect(next.done).toEqual(['Type the product name']);
    expect(currentStep(next)).toEqual(SEARCH_FLOW[1]);
  });

  it('accumulates across several steps, in order', () => {
    const next = advance(advance(journey()));

    expect(next.done).toEqual(['Type the product name', 'Press Search']);
  });

  it('caps the done list at its documented limit, keeping the newest', () => {
    const many: Step[] = Array.from({ length: MAX_DONE + 4 }, (_, i) => ({
      text: `step ${i}`,
      ref: '',
      fill: '',
    }));

    let j = journey({ steps: many, index: 0 });
    for (let i = 0; i < many.length; i++) j = advance(j);

    // It rides on every re-plan prompt, so it must not grow without bound.
    expect(j.done).toHaveLength(MAX_DONE);
    expect(j.done[0]).toBe('step 4');
    expect(j.done.at(-1)).toBe(`step ${many.length - 1}`);
  });

  it('stops at the end instead of running the index past the list', () => {
    const finished = advance(journey({ index: 3 }));

    expect(finished.index).toBe(3);
    expect(finished.done).toEqual([]);
  });

  it('does not mutate the journey it was handed', () => {
    const j = journey();
    advance(j);

    expect(j.index).toBe(0);
    expect(j.done).toEqual([]);
  });
});

describe('skip', () => {
  it('moves on without recording the step', () => {
    const next = skip(journey());

    expect(next.index).toBe(1);
    // A skipped step in `done` would build the next page's plan on a lie.
    expect(next.done).toEqual([]);
  });

  it('stops at the end, like advance', () => {
    expect(skip(journey({ index: 3 })).index).toBe(3);
  });
});

describe('jumpTo', () => {
  it('moves the index without recording anything', () => {
    const next = jumpTo(journey(), 2);

    expect(next.index).toBe(2);
    expect(next.done).toEqual([]);
  });

  it('refuses an index outside the list', () => {
    expect(jumpTo(journey({ index: 1 }), -1).index).toBe(1);
    expect(jumpTo(journey({ index: 1 }), 3).index).toBe(1);
  });
});

describe('isFinished', () => {
  it('is true only once the index is past the last step', () => {
    expect(isFinished(journey({ index: 2 }))).toBe(false);
    expect(isFinished(journey({ index: 3 }))).toBe(true);
  });

  it('is true for a plan with no steps at all', () => {
    expect(isFinished(journey({ steps: [], index: 0 }))).toBe(true);
  });
});

describe('replan', () => {
  it('replaces the steps and the index but keeps the goal and the progress', () => {
    const before = advance(journey());
    const fresh: Step[] = [{ text: 'Press Add to cart', ref: 'e9', fill: '' }];

    const after = replan(before, fresh, 'https://shop.example/socks', 2000);

    // The carry-over is the whole feature: the page changed, the task did not.
    expect(after.goal).toBe('buy wool socks');
    expect(after.done).toEqual(['Type the product name']);
    expect(after.steps).toEqual(fresh);
    expect(after.index).toBe(0);
    expect(after.url).toBe('https://shop.example/socks');
    expect(after.updatedAt).toBe(2000);
  });

  it('keeps the panel open across the navigation', () => {
    const after = replan(journey({ panelOpen: true }), [], 'u', 2);
    expect(after.panelOpen).toBe(true);

    // And keeps it closed if that is where the user left it.
    expect(replan(journey({ panelOpen: false }), [], 'u', 2).panelOpen).toBe(false);
  });
});

describe('fillSatisfied', () => {
  it('accepts an exact match', () => {
    expect(fillSatisfied(step({ fill: 'wool socks' }), 'wool socks')).toBe(true);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(fillSatisfied(step({ fill: 'Wool Socks' }), '  wool socks  ')).toBe(true);
    expect(fillSatisfied(step({ fill: 'wool  socks' }), 'WOOL SOCKS')).toBe(true);
  });

  it('accepts the field merely containing the suggestion', () => {
    // The user is free to type around it, and a site is free to reformat what
    // it is given. Demanding equality would leave the step stuck.
    expect(fillSatisfied(step({ fill: 'wool socks' }), 'red wool socks size 9')).toBe(true);
  });

  it('rejects a partial or unrelated value', () => {
    expect(fillSatisfied(step({ fill: 'wool socks' }), 'wool')).toBe(false);
    expect(fillSatisfied(step({ fill: 'wool socks' }), 'cotton shirt')).toBe(false);
  });

  it('is never satisfied by a step that suggests no text', () => {
    // Otherwise every keystroke anywhere would advance a plain button step.
    expect(fillSatisfied(step({ fill: '' }), 'anything')).toBe(false);
    expect(fillSatisfied(step({ fill: '   ' }), '')).toBe(false);
  });
});

describe('resolvableSteps', () => {
  const outline: OutlineEntry[] = [
    { ref: 'e1', kind: 'field', name: 'Search', inViewport: true },
    { ref: 'e2', kind: 'button', name: 'Search', inViewport: true },
  ];

  it('leaves steps whose refs are in the outline alone', () => {
    const steps = resolvableSteps(SEARCH_FLOW.slice(0, 2), outline);
    expect(steps).toEqual(SEARCH_FLOW.slice(0, 2));
  });

  it('blanks a ref the outline never contained, and the fill with it', () => {
    const steps = resolvableSteps(
      [{ text: 'Type it in the magic box', ref: 'e404', fill: 'wool socks' }],
      outline,
    );

    // The step survives so the user still reads what to do — they just do it
    // themselves. Typing into whatever element holds an invented id is worse.
    expect(steps).toEqual([{ text: 'Type it in the magic box', ref: '', fill: '' }]);
  });

  it('leaves a step that was never about an element untouched', () => {
    const steps = resolvableSteps([{ text: 'Wait for the email', ref: '', fill: '' }], outline);
    expect(steps).toEqual([{ text: 'Wait for the email', ref: '', fill: '' }]);
  });

  it('blanks everything when the outline is empty', () => {
    expect(resolvableSteps(SEARCH_FLOW, []).every((s) => s.ref === '')).toBe(true);
  });
});
