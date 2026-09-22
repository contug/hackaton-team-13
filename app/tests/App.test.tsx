import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '@/entrypoints/overlay.content/App';
import { sendToBackground } from '@/lib/messaging';
import type { BgRequest } from '@/lib/messaging';
import type { Journey } from '@/lib/journey';
import type { Answer, Step } from '@/lib/openrouter';
import type { OutlineEntry } from '@/lib/snapshot';
import { refFor } from '@/lib/refs';
import { snapshotFixture } from './fixtures';

/**
 * The snapshot is mocked wholesale, so no refs are ever minted here — and
 * `refFor`'s counter is monotonic with no reset, so a test cannot arrange for a
 * real element to be `e2`. So invert it: mint the ref from a real element and
 * build both the outline and the canned answer from the id you were handed.
 * `vi.hoisted` is what lets the mock factory see that mutable slot.
 */
const state = vi.hoisted(() => ({ outline: null as unknown[] | null }));

vi.mock('@/lib/messaging', () => ({ sendToBackground: vi.fn() }));
vi.mock('@/lib/snapshot', () => ({
  buildSnapshot: vi.fn(() =>
    snapshotFixture(state.outline ? { outline: state.outline as OutlineEntry[] } : {}),
  ),
}));

function register(el: Element, kind: OutlineEntry['kind'], name: string): string {
  const ref = refFor(el);
  const entry: OutlineEntry = { ref, kind, name, inViewport: true };
  state.outline = [...((state.outline as OutlineEntry[] | null) ?? []), entry];
  return ref;
}

/** Put a real element on the page and register it, the way a snapshot would. */
function placeButton(name: string, top = 300): { ref: string; el: HTMLButtonElement } {
  const el = document.createElement('button');
  el.textContent = name;
  el.setAttribute('style', 'left: 400px');
  el.setAttribute('data-test-rect', `${top},40`);
  document.body.insertAdjacentElement('afterbegin', el);
  return { ref: register(el, 'button', name), el };
}

function placeTarget(name: string, top = 300): string {
  return placeButton(name, top).ref;
}

/** An outline entry with no element behind it — a ref we can cite but not ring. */
function registerPhantom(name: string): string {
  const ref = `e${90000 + ((state.outline as OutlineEntry[] | null)?.length ?? 0)}`;
  state.outline = [
    ...((state.outline as OutlineEntry[] | null) ?? []),
    { ref, kind: 'button', name, inViewport: false },
  ];
  return ref;
}

/** The same, for a real text field — the only thing autofill can write to. */
function placeInput(name: string, top = 200): { ref: string; el: HTMLInputElement } {
  const el = document.createElement('input');
  el.type = 'search';
  el.setAttribute('aria-label', name);
  el.setAttribute('style', 'left: 400px');
  el.setAttribute('data-test-rect', `${top},40`);
  document.body.insertAdjacentElement('afterbegin', el);
  return { ref: register(el, 'field', name), el };
}

type Reply = { ok: true; data: unknown } | { ok: false; error: string };
type Routes = Partial<Record<BgRequest['type'], Reply | (() => Reply)>>;

const send = vi.mocked(sendToBackground);

/**
 * Answer each message type with a canned reply, the way the background would.
 * The three journey messages are stubbed by default because `App` mirrors every
 * journey change without being asked to, and mounting alone asks for one.
 */
function routes(config: Routes): void {
  const withJourney: Routes = {
    getJourney: { ok: true, data: null },
    saveJourney: { ok: true, data: { saved: true } },
    clearJourney: { ok: true, data: { cleared: true } },
    ...config,
  };
  send.mockImplementation(async (request) => {
    const route = withJourney[request.type];
    if (!route) throw new Error(`No stub for a "${request.type}" message.`);
    return (typeof route === 'function' ? route() : route) as never;
  });
}

function requestsOfType<K extends BgRequest['type']>(type: K): Array<Extract<BgRequest, { type: K }>> {
  return send.mock.calls
    .map(([request]) => request)
    .filter((request): request is Extract<BgRequest, { type: K }> => request.type === type);
}

/** The journey as the background last saw it — the mirror, asserted directly. */
function lastSavedJourney(): Journey | undefined {
  return requestsOfType('saveJourney').at(-1)?.journey;
}

const SUMMARY = {
  tldr: 'This page lists the plans you can buy.',
  key_points: ['Three plans'],
  what_you_can_do_here: ['Upgrade your plan'],
  suggestions: ['How do I upgrade?'],
};

function answerFor(question: string, over: Partial<Answer> = {}) {
  return {
    ok: true as const,
    data: {
      answer: `Answer to ${question}`,
      steps: [],
      refs: ['e2'],
      suggestions: [],
      goal_reached: false,
      ...over,
    } satisfies Answer,
  };
}

function step(text: string, ref: string, fill = ''): Step {
  return { text, ref, fill };
}

async function openPanel() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Open Page Guide' }));
  return user;
}

async function ask(user: ReturnType<typeof userEvent.setup>, question: string, expected?: string) {
  await user.type(screen.getByPlaceholderText('What are you trying to do here?'), question);
  await user.keyboard('{Enter}');
  // `findAllBy`, because a highlight with no step to walk uses the answer text
  // as its tooltip copy — there is nothing shorter to honestly show.
  await screen.findAllByText(expected ?? `Answer to ${question}`);
}

/** Let the 500ms poll in `useUrlWatcher` (and the spotlight heartbeat) tick. */
async function tickPoll(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
  });
}

beforeEach(() => {
  send.mockReset();
  state.outline = null;
});

/** The routes every spotlight test starts from. */
function spotlightRoutes(answer: ReturnType<typeof answerFor>): void {
  routes({
    getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
    summarize: { ok: true, data: SUMMARY },
    ask: () => answer,
    // The settings view fetches these the moment it mounts.
    listModels: { ok: true, data: [] },
  });
}

describe('first run', () => {
  it('shows the key setup and asks for no summary until a key exists', async () => {
    routes({ getSettings: { ok: true, data: { hasApiKey: false, model: 'a/b' } } });

    await openPanel();

    expect(await screen.findByLabelText('OpenRouter API key')).toBeInTheDocument();
    expect(requestsOfType('summarize')).toHaveLength(0);
  });

  it('asks only whether this tab has a walkthrough until the button is clicked', async () => {
    routes({ getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } } });

    render(<App />);
    await waitFor(() => expect(requestsOfType('getJourney')).toHaveLength(1));

    // Still no network and no DOM walk for a user who never asks for help. The
    // one message is local — it reads a single session-storage key so a
    // walkthrough can survive a page load, which is the whole feature.
    expect(send.mock.calls.map(([r]) => r.type)).toEqual(['getJourney']);
  });
});

describe('opening the panel with a key stored', () => {
  beforeEach(() => {
    routes({
      getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
      summarize: { ok: true, data: SUMMARY },
      ask: () => answerFor('unused'),
    });
  });

  it('summarizes the page exactly once and renders the summary', async () => {
    await openPanel();

    expect(await screen.findByText(SUMMARY.tldr)).toBeInTheDocument();
    expect(screen.getByText('Three plans')).toBeInTheDocument();
    expect(requestsOfType('summarize')).toHaveLength(1);
    expect(requestsOfType('summarize')[0]!.snapshot.meta.url).toBe(
      'https://example.com/pricing',
    );
  });

  it('offers the summary suggestions as chips', async () => {
    await openPanel();
    expect(await screen.findByRole('button', { name: 'How do I upgrade?' })).toBeInTheDocument();
  });

  it('closes on Escape and leaves the floating button behind', async () => {
    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Page Guide' })).toBeInTheDocument();
  });
});

describe('one answer on screen at a time', () => {
  it('REPLACES the summary with the answer — there is no scrollback', async () => {
    routes({
      getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
      summarize: { ok: true, data: SUMMARY },
      ask: () => answerFor('how do I upgrade?'),
    });

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);

    await ask(user, 'how do I upgrade?');

    // The whole product thesis: a new result replaces the previous one. If this
    // ever fails, the panel has started to become a chat log.
    expect(screen.queryByText(SUMMARY.tldr)).not.toBeInTheDocument();
    expect(screen.queryByText('Three plans')).not.toBeInTheDocument();
    expect(screen.queryByText('What you can do here')).not.toBeInTheDocument();
  });

  it('replaces the previous answer with the next one', async () => {
    routes({
      getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
      summarize: { ok: true, data: SUMMARY },
      ask: () => answerFor('second'),
    });

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);

    const first = answerFor('first');
    const second = answerFor('second');
    routes({
      getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
      summarize: { ok: true, data: SUMMARY },
      ask: () => first,
    });
    await ask(user, 'first');

    routes({
      getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
      summarize: { ok: true, data: SUMMARY },
      ask: () => second,
    });
    await ask(user, 'second');

    expect(screen.queryByText('Answer to first')).not.toBeInTheDocument();
    expect(screen.getByText('Answer to second')).toBeInTheDocument();
  });

  it('resolves refs to their outline names for the answer card', async () => {
    routes({
      getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
      summarize: { ok: true, data: SUMMARY },
      ask: () => answerFor('where?'),
    });

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'where?');

    // `e2` is the "Upgrade" button in the snapshot fixture.
    expect(screen.getByText('On this page')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeInTheDocument();
  });
});

describe('the on-page highlight, without a walkthrough', () => {
  it('rings the element the answer points at when there are no steps', async () => {
    const ref = placeTarget('Cancel subscription');
    spotlightRoutes(answerFor('how do I cancel?', { refs: [ref] }));

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'how do I cancel?');

    expect(screen.getByTestId('spotlight-ring')).toBeInTheDocument();
    expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Cancel subscription');
    // With no step to walk, the answer itself is the only honest copy.
    expect(screen.getByRole('status')).toHaveTextContent(
      'Highlighted on the page: Cancel subscription',
    );
    // And no walkthrough was started, so nothing was stored.
    expect(requestsOfType('saveJourney')).toHaveLength(0);
  });

  it('draws nothing when the answer points at a ref that is not on the page', async () => {
    placeTarget('Cancel subscription');
    spotlightRoutes(answerFor('how?', { refs: ['e40404'] }));

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'how?');

    // A model is free to invent a ref id. Ringing nothing beats ringing wrong.
    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Answer to how?')).toBeInTheDocument();
  });

  it('clears the highlight while the next answer is still loading', async () => {
    const ref = placeTarget('Cancel subscription');
    spotlightRoutes(answerFor('first', { refs: [ref] }));

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'first');
    expect(screen.getByTestId('spotlight-ring')).toBeInTheDocument();

    // A highlight that outlived its answer would be pointing at the previous
    // question's target while the user waits for a new one.
    let release = () => {};
    send.mockImplementation((request) => {
      if (request.type !== 'ask') return Promise.resolve({ ok: true, data: null } as never);
      return new Promise((resolve) => (release = () => resolve(answerFor('second') as never)));
    });
    await user.type(screen.getByPlaceholderText('What are you trying to do here?'), 'second');
    await user.keyboard('{Enter}');

    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();

    await act(async () => {
      release();
    });
  });

  it('clears the highlight when the answer fails', async () => {
    const ref = placeTarget('Cancel subscription');
    spotlightRoutes(answerFor('first', { refs: [ref] }));

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'first');

    routes({
      getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
      summarize: { ok: true, data: SUMMARY },
      ask: { ok: false, error: 'Rate limited.' },
    });
    await user.type(screen.getByPlaceholderText('What are you trying to do here?'), 'second');
    await user.keyboard('{Enter}');
    await screen.findByRole('alert');

    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();
  });

  it('clears the highlight when the settings view is opened', async () => {
    const ref = placeTarget('Cancel subscription');
    spotlightRoutes(answerFor('first', { refs: [ref] }));

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'first');

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();
  });

  it('hides the highlight from the tooltip without closing the panel', async () => {
    const ref = placeTarget('Cancel subscription');
    spotlightRoutes(answerFor('how?', { refs: [ref] }));

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'how?');

    await user.click(screen.getByRole('button', { name: 'Hide highlight' }));

    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('moves the highlight to an entry picked from "On this page"', async () => {
    const first = placeTarget('Cancel subscription');
    const second = placeTarget('Change plan', 400);
    spotlightRoutes(answerFor('how?', { refs: [first, second] }));

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'how?');
    expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Cancel subscription');

    // Scoped to the panel: the host page has a button of the same name, which
    // is the point — the chip is a pointer to it.
    const panel = screen.getByRole('dialog');
    await user.click(within(panel).getByRole('button', { name: 'Change plan' }));

    expect(screen.getAllByTestId('spotlight-ring')).toHaveLength(1);
    expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Change plan');
  });

  it('leaves nothing behind in the page after Hide on this page', async () => {
    const ref = placeTarget('Cancel subscription');
    spotlightRoutes(answerFor('how?', { refs: [ref] }));

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'how?');

    await user.click(screen.getByRole('button', { name: 'Hide on this page' }));

    // The regression this guards: rendering the overlay through a portal to
    // `document.body` would leak these nodes into the host page forever.
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="spotlight"]')).toHaveLength(0);
    });
  });
});

describe('the guided walkthrough', () => {
  /** Two rungs: type into a field, then press a button. The canonical shape. */
  function searchFlow() {
    const field = placeInput('Search products');
    const search = placeButton('Search', 300);
    const button = search.ref;
    return {
      field,
      search,
      button,
      answer: answerFor('buy wool socks', {
        answer: 'Search for it, then add it to the basket.',
        refs: [],
        steps: [
          step('Type the product name', field.ref, 'wool socks'),
          step('Press Search', button),
        ],
      }),
    };
  }

  it('rings the first step, counts them, and stores the journey', async () => {
    const flow = searchFlow();
    spotlightRoutes(flow.answer);

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'buy wool socks', 'Search for it, then add it to the basket.');

    const tooltip = screen.getByTestId('spotlight-tooltip');
    expect(tooltip).toHaveTextContent('Step 1 of 2');
    expect(tooltip).toHaveTextContent('Type the product name');
    expect(screen.getByRole('status')).toHaveTextContent('Step 1 of 2: Type the product name');

    // The question IS the goal, and the goal is what survives a page load.
    expect(lastSavedJourney()).toMatchObject({
      goal: 'buy wool socks',
      index: 0,
      done: [],
      panelOpen: true,
    });
  });

  it('moves the highlight to step 2 when the user does step 1', async () => {
    const flow = searchFlow();
    spotlightRoutes(flow.answer);

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'buy wool socks', 'Search for it, then add it to the basket.');

    // Typing the suggested text into the real field, exactly as a user would.
    await user.type(flow.field.el, 'wool socks');

    await waitFor(() => {
      expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Step 2 of 2');
    });
    expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Press Search');
    expect(lastSavedJourney()).toMatchObject({ index: 1, done: ['Type the product name'] });
  });

  it('advances when the user clicks the ringed element', async () => {
    const flow = searchFlow();
    spotlightRoutes({
      ...flow.answer,
      data: { ...flow.answer.data, steps: [step('Press Search', flow.button), step('Pick the item', flow.field.ref)] },
    });

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'buy wool socks', 'Search for it, then add it to the basket.');
    expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Step 1 of 2');

    // The real page button. The watcher is read-only, so the click reaches it
    // exactly as if we were not here.
    await user.click(flow.search.el);

    await waitFor(() => {
      expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Step 2 of 2');
    });
    expect(lastSavedJourney()!.done).toEqual(['Press Search']);
  });

  it('records a step on Next but not on Skip', async () => {
    const flow = searchFlow();
    spotlightRoutes(flow.answer);

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'buy wool socks', 'Search for it, then add it to the basket.');

    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => {
      expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Step 2 of 2');
    });
    // A skipped step in `done` would build the next page's plan on a lie.
    expect(lastSavedJourney()).toMatchObject({ index: 1, done: [] });

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(lastSavedJourney()).toMatchObject({ index: 2, done: ['Press Search'] });
  });

  it('jumps the highlight to a step picked from the panel', async () => {
    const flow = searchFlow();
    spotlightRoutes(flow.answer);

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'buy wool socks', 'Search for it, then add it to the basket.');

    const panel = screen.getByRole('dialog');
    await user.click(within(panel).getByRole('button', { name: /Press Search/ }));

    expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Step 2 of 2');
    // A jump is not progress, so it records nothing.
    expect(lastSavedJourney()).toMatchObject({ index: 1, done: [] });
  });

  it('does not list a step target again under "On this page"', async () => {
    const flow = searchFlow();
    const help = registerPhantom('Contact support');
    spotlightRoutes({
      ...flow.answer,
      // The model cited the search button both as a ref and as a step target,
      // plus one control that is not a step at all.
      data: { ...flow.answer.data, refs: [flow.button, help] },
    });

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'buy wool socks', 'Search for it, then add it to the basket.');

    const panel = screen.getByRole('dialog');
    expect(within(panel).getByText('On this page')).toBeInTheDocument();
    // The one that is not a step stays; the one that is already step 2 must not
    // be listed twice.
    expect(within(panel).getByRole('button', { name: 'Contact support' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Search' })).not.toBeInTheDocument();
  });

  it('drops a step whose ref the outline never contained, but keeps its text', async () => {
    const flow = searchFlow();
    spotlightRoutes({
      ...flow.answer,
      data: {
        ...flow.answer.data,
        steps: [step('Press the big green button', 'e40404', 'wool socks')],
      },
    });

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'buy wool socks', 'Search for it, then add it to the basket.');

    // The user still reads what to do; nothing is ringed and nothing is filled.
    expect(screen.getByRole('status')).toHaveTextContent('Press the big green button');
    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();
    expect(lastSavedJourney()!.steps).toEqual([
      { text: 'Press the big green button', ref: '', fill: '' },
    ]);
  });

  it('stops guiding on request, and clears the stored journey', async () => {
    const flow = searchFlow();
    spotlightRoutes(flow.answer);

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'buy wool socks', 'Search for it, then add it to the basket.');

    await user.click(screen.getByRole('button', { name: 'Stop guiding me' }));

    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop guiding me' })).not.toBeInTheDocument();
    expect(requestsOfType('clearJourney').length).toBeGreaterThan(0);
  });

  it('clears the walkthrough on Escape, panel and all', async () => {
    const flow = searchFlow();
    spotlightRoutes(flow.answer);

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'buy wool socks', 'Search for it, then add it to the basket.');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();
    expect(requestsOfType('clearJourney').length).toBeGreaterThan(0);
  });

  it('keeps the walkthrough when the panel is collapsed, and remembers that', async () => {
    const flow = searchFlow();
    spotlightRoutes(flow.answer);

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'buy wool socks', 'Search for it, then add it to the basket.');

    await user.click(screen.getByRole('button', { name: 'Close' }));

    // The user closed the panel precisely to go and touch the thing — and the
    // next page must come back the way they left this one.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('spotlight-ring')).toBeInTheDocument();
    await waitFor(() => expect(lastSavedJourney()!.panelOpen).toBe(false));
  });

  it('ends the walkthrough when the model says the goal is already met', async () => {
    placeTarget('Add to cart');
    spotlightRoutes(
      answerFor('buy wool socks', {
        answer: 'The socks are already in your basket.',
        steps: [],
        refs: [],
        goal_reached: true,
      }),
    );

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'buy wool socks', 'The socks are already in your basket.');

    expect(screen.getByRole('status')).toHaveTextContent("That's everything — this looks done.");
    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();
    expect(requestsOfType('saveJourney')).toHaveLength(0);
  });
});

describe('the autofill gate', () => {
  it('types the suggested text into the real field and moves on', async () => {
    const field = placeInput('Search products');
    const button = placeTarget('Search', 300);
    spotlightRoutes(
      answerFor('buy wool socks', {
        answer: 'Search for it first.',
        refs: [],
        steps: [step('Type the product name', field.ref, 'wool socks'), step('Press Search', button)],
      }),
    );

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'buy wool socks', 'Search for it first.');

    await user.click(screen.getByRole('button', { name: 'Fill this in' }));

    // The only thing in this extension that writes to the host page, and it
    // only ever runs from this press.
    expect(field.el.value).toBe('wool socks');
    await waitFor(() => {
      expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Step 2 of 2');
    });
  });

  it('offers no fill button for a step that suggests no text', async () => {
    const button = placeTarget('Search', 300);
    spotlightRoutes(
      answerFor('buy wool socks', {
        answer: 'Press Search.',
        refs: [],
        steps: [step('Press Search', button)],
      }),
    );

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'buy wool socks', 'Press Search.');

    expect(screen.queryByRole('button', { name: 'Fill this in' })).not.toBeInTheDocument();
  });

  it('offers no fill button for a password field, whatever the model asked for', async () => {
    const el = document.createElement('input');
    el.type = 'password';
    el.setAttribute('aria-label', 'Password');
    el.setAttribute('style', 'left: 400px');
    el.setAttribute('data-test-rect', '200,40');
    document.body.insertAdjacentElement('afterbegin', el);
    const ref = refFor(el);
    state.outline = [{ ref, kind: 'field', name: 'Password', inViewport: true }];

    spotlightRoutes(
      answerFor('log in', {
        answer: 'Type your password.',
        refs: [],
        steps: [step('Type your password', ref, 'hunter2')],
      }),
    );

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'log in', 'Type your password.');

    expect(screen.getByTestId('spotlight-ring')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fill this in' })).not.toBeInTheDocument();
    expect(el.value).toBe('');
  });
});

describe('surviving a page change', () => {
  const STORED: Journey = {
    goal: 'buy wool socks',
    // Refs from the page we have left. They resolve to nothing here, which is
    // exactly why a restore always re-plans rather than reusing them.
    steps: [step('Press Search', 'e90001')],
    index: 1,
    done: ['Type the product name', 'Press Search'],
    panelOpen: true,
    url: 'https://shop.example/',
    updatedAt: 1000,
  };

  it('reopens the panel and re-plans against the new page, with the goal intact', async () => {
    const addToCart = placeTarget('Add to cart');
    routes({
      getJourney: { ok: true, data: STORED },
      getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
      nextSteps: {
        ok: true,
        data: {
          answer: 'Almost there — put it in the basket.',
          steps: [step('Press Add to cart', addToCart)],
          refs: [],
          suggestions: [],
          goal_reached: false,
        } satisfies Answer,
      },
    });

    // No click: a full page load is a fresh mount, and the panel comes back by
    // itself. That is what makes the navigation invisible to the user.
    render(<App />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByText('Almost there — put it in the basket.')).toBeInTheDocument();

    // It re-plans instead of summarizing: this page is the middle of a task.
    expect(requestsOfType('summarize')).toHaveLength(0);
    const replans = requestsOfType('nextSteps');
    expect(replans).toHaveLength(1);
    expect(replans[0]!.goal).toBe('buy wool socks');
    expect(replans[0]!.done).toEqual(['Type the product name', 'Press Search']);

    // And the walkthrough picks up at the first step of the new page.
    await waitFor(() => {
      expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Step 1 of 1');
    });
    expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Press Add to cart');
    expect(lastSavedJourney()).toMatchObject({
      goal: 'buy wool socks',
      index: 0,
      done: ['Type the product name', 'Press Search'],
    });
  });

  it('restores a collapsed panel collapsed, and still rings the step', async () => {
    const addToCart = placeTarget('Add to cart');
    routes({
      getJourney: { ok: true, data: { ...STORED, panelOpen: false } },
      getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
      nextSteps: {
        ok: true,
        data: {
          answer: 'Almost there.',
          steps: [step('Press Add to cart', addToCart)],
          refs: [],
          suggestions: [],
          goal_reached: false,
        } satisfies Answer,
      },
    });

    render(<App />);

    // The highlight outlives the panel, and it is the highlight the user went
    // off to act on — so it must come back even with the panel shut.
    await waitFor(() => expect(screen.getByTestId('spotlight-ring')).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(requestsOfType('nextSteps')).toHaveLength(1);
  });

  it('ends the walkthrough when the new page shows the goal is met', async () => {
    placeTarget('View basket');
    routes({
      getJourney: { ok: true, data: STORED },
      getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
      nextSteps: {
        ok: true,
        data: {
          answer: 'The socks are in your basket.',
          steps: [],
          refs: [],
          suggestions: [],
          goal_reached: true,
        } satisfies Answer,
      },
    });

    render(<App />);

    expect(await screen.findByText('The socks are in your basket.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent("That's everything — this looks done.");
    await waitFor(() => expect(requestsOfType('clearJourney').length).toBeGreaterThan(0));
    expect(requestsOfType('saveJourney')).toHaveLength(0);
  });

  it('re-plans when the URL changes under a live page', async () => {
    const field = placeInput('Search products');
    const button = placeTarget('Search', 300);
    const addToCart = placeTarget('Add to cart', 400);

    routes({
      getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
      summarize: { ok: true, data: SUMMARY },
      ask: () =>
        answerFor('buy wool socks', {
          answer: 'Search for it, then add it to the basket.',
          refs: [],
          steps: [
            step('Type the product name', field.ref, 'wool socks'),
            step('Press Search', button),
          ],
        }),
      nextSteps: {
        ok: true,
        data: {
          answer: 'Here are the results.',
          steps: [step('Press Add to cart', addToCart)],
          refs: [],
          suggestions: [],
          goal_reached: false,
        } satisfies Answer,
      },
    });

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'buy wool socks', 'Search for it, then add it to the basket.');
    await user.click(screen.getByRole('button', { name: 'Fill this in' }));

    // An SPA route change. jsdom implements `pushState` and has no Navigation
    // API, which is exactly why `useUrlWatcher` polls.
    window.history.pushState({}, '', '/results?q=wool+socks');
    await tickPoll();

    const replans = requestsOfType('nextSteps');
    expect(replans).toHaveLength(1);
    expect(replans[0]!.goal).toBe('buy wool socks');
    expect(replans[0]!.done).toEqual(['Type the product name']);
    expect(await screen.findByText('Here are the results.')).toBeInTheDocument();
    expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Press Add to cart');
  });
});

/**
 * The user's own scenario, end to end in one test: wants a product, follows the
 * suggestion to search for it, fills the box from the tooltip, the highlight
 * moves to the search button, pressing it changes the URL, and the new page is
 * analyzed against the same goal with the progress intact.
 */
describe('the whole journey, as the user described it', () => {
  it('carries one goal across a fill, an advance and a page change', async () => {
    const field = placeInput('Search products');
    const search = placeButton('Search', 300);
    const addToCart = placeTarget('Add to cart', 400);

    routes({
      getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
      summarize: { ok: true, data: SUMMARY },
      ask: () =>
        answerFor('I want to buy wool socks', {
          answer: 'Search for them, then add them to your basket.',
          refs: [],
          steps: [
            step('Type the product name', field.ref, 'wool socks'),
            step('Press Search', search.ref),
          ],
        }),
      nextSteps: {
        ok: true,
        data: {
          answer: 'These are the wool socks. Put one in your basket.',
          steps: [step('Press Add to cart', addToCart)],
          refs: [],
          suggestions: [],
          goal_reached: false,
        } satisfies Answer,
      },
    });

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);

    // 1. The goal.
    await ask(user, 'I want to buy wool socks', 'Search for them, then add them to your basket.');
    expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Step 1 of 2');
    expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Type the product name');

    // 2. The tooltip fills the search box for them.
    await user.click(screen.getByRole('button', { name: 'Fill this in' }));
    expect(field.el.value).toBe('wool socks');

    // 3. The highlight has moved to the search button on its own.
    await waitFor(() => {
      expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Step 2 of 2');
    });
    expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Press Search');

    // 4. Pressing it navigates. jsdom cannot do a real page load, so this is
    //    the SPA half of the mechanism; `surviving a page change` covers the
    //    full-load half via a fresh mount.
    await user.click(search.el);
    window.history.pushState({}, '', '/search?q=wool+socks');
    await tickPoll();

    // 5. The new page is analyzed against the original goal, with the steps
    //    already done carried across.
    const replan = requestsOfType('nextSteps').at(-1)!;
    expect(replan.goal).toBe('I want to buy wool socks');
    expect(replan.done).toEqual(['Type the product name', 'Press Search']);

    expect(await screen.findByText('These are the wool socks. Put one in your basket.'))
      .toBeInTheDocument();
    expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Press Add to cart');
    expect(lastSavedJourney()).toMatchObject({
      goal: 'I want to buy wool socks',
      index: 0,
      done: ['Type the product name', 'Press Search'],
    });
  });
});

describe('the host page keeps its Escape key', () => {
  function watchEscape(): () => number {
    let seen = 0;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') seen += 1;
    });
    return () => seen;
  }

  it('does not swallow Escape when there is nothing to dismiss', async () => {
    routes({ getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } } });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(requestsOfType('getJourney')).toHaveLength(1));

    const seen = watchEscape();
    await user.keyboard('{Escape}');

    // Idle, collapsed, no highlight: the page's own Escape handling is intact.
    expect(seen()).toBe(1);
  });

  it('swallows Escape while the panel is open, so the page does not also react', async () => {
    routes({
      getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
      summarize: { ok: true, data: SUMMARY },
    });

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);

    const seen = watchEscape();
    await user.keyboard('{Escape}');

    expect(seen()).toBe(0);
  });
});

describe('conversation history', () => {
  it('sends the prior turns with each question and caps the tail at six', async () => {
    routes({
      getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
      summarize: { ok: true, data: SUMMARY },
    });

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);

    for (let i = 1; i <= 8; i++) {
      routes({
        getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
        summarize: { ok: true, data: SUMMARY },
        ask: () => answerFor(`q${i}`),
      });
      await ask(user, `q${i}`);
    }

    const asks = requestsOfType('ask');
    expect(asks).toHaveLength(8);

    // First question carries nothing; the second carries the first turn.
    expect(asks[0]!.history).toEqual([]);
    expect(asks[1]!.history).toEqual([{ question: 'q1', answer: 'Answer to q1' }]);

    // The cap keeps the six most recent turns, oldest first.
    const last = asks[7]!.history;
    expect(last).toHaveLength(6);
    expect(last.map((turn) => turn.question)).toEqual(['q2', 'q3', 'q4', 'q5', 'q6', 'q7']);
  });
});

describe('failures', () => {
  it('shows the error message and a way to retry', async () => {
    routes({
      getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
      summarize: { ok: false, error: 'Rate limited. Wait a moment and try again.' },
    });

    await openPanel();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Rate limited. Wait a moment and try again.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('retries the summary when asked, and clears the error', async () => {
    let attempt = 0;
    routes({
      getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
      summarize: () =>
        ++attempt === 1 ? { ok: false, error: 'Something broke.' } : { ok: true, data: SUMMARY },
    });

    const user = await openPanel();
    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText(SUMMARY.tldr)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(requestsOfType('summarize')).toHaveLength(2);
  });

  it('falls back to the setup view when settings cannot be read', async () => {
    routes({ getSettings: { ok: false, error: 'The extension background is unavailable.' } });

    await openPanel();

    expect(await screen.findByLabelText('OpenRouter API key')).toBeInTheDocument();
    expect(requestsOfType('summarize')).toHaveLength(0);
  });

  it('says so, and stays on the step, when the fill cannot be done', async () => {
    // A `<select>` is fillable in principle, so the button is offered — but no
    // option matches, and guessing one would be worse than saying so.
    const el = document.createElement('select');
    el.innerHTML = '<option value="uk">United Kingdom</option>';
    el.setAttribute('aria-label', 'Country');
    el.setAttribute('style', 'left: 400px');
    el.setAttribute('data-test-rect', '200,40');
    document.body.insertAdjacentElement('afterbegin', el);
    const ref = refFor(el);
    state.outline = [{ ref, kind: 'field', name: 'Country', inViewport: true }];

    spotlightRoutes(
      answerFor('ship to Atlantis', {
        answer: 'Pick your country.',
        refs: [],
        steps: [step('Pick your country', ref, 'Atlantis'), step('Press Continue', '')],
      }),
    );

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'ship to Atlantis', 'Pick your country.');

    await user.click(screen.getByRole('button', { name: 'Fill this in' }));

    expect(screen.getByText("Couldn't type that in — you'll need to do it yourself.")).toBeInTheDocument();
    // Still on step 1: a failed fill is not progress.
    expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Step 1 of 2');
  });
});

describe('hiding on this page', () => {
  it('removes the whole UI, floating button included', async () => {
    routes({
      getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
      summarize: { ok: true, data: SUMMARY },
    });

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);

    await user.click(screen.getByRole('button', { name: 'Hide on this page' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Open Page Guide' })).not.toBeInTheDocument();
  });
});

describe('panel size', () => {
  it('enlarges the panel by half and restores it', async () => {
    routes({
      getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } },
      summarize: { ok: true, data: SUMMARY },
    });

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);

    const panel = screen.getByRole('dialog');
    expect(panel).toHaveClass('w-[360px]', 'max-h-[480px]');

    await user.click(screen.getByRole('button', { name: 'Enlarge panel' }));

    // 360 -> 540 and 480 -> 720: half again as wide, half again as tall.
    expect(panel).toHaveClass('w-[540px]', 'max-h-[min(720px,calc(100vh_-_2.5rem))]');
    expect(panel).not.toHaveClass('w-[360px]');

    await user.click(screen.getByRole('button', { name: 'Restore panel size' }));

    expect(panel).toHaveClass('w-[360px]', 'max-h-[480px]');
    expect(panel).not.toHaveClass('w-[540px]');
  });

  it('offers the size control before the API key is set', async () => {
    routes({ getSettings: { ok: true, data: { hasApiKey: false, model: 'a/b' } } });

    await openPanel();
    await screen.findByRole('button', { name: 'Enlarge panel' });

    // Settings is gated on the assistant view; the size control deliberately is not.
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
