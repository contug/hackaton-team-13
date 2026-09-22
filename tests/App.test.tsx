import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '@/entrypoints/overlay.content/App';
import { sendToBackground } from '@/lib/messaging';
import type { BgRequest } from '@/lib/messaging';
import type { Answer } from '@/lib/openrouter';
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

/** Put a real element on the page and register it, the way a snapshot would. */
function placeTarget(name: string, top = 300): string {
  const el = document.createElement('button');
  el.textContent = name;
  el.setAttribute('style', 'left: 400px');
  el.setAttribute('data-test-rect', `${top},40`);
  document.body.insertAdjacentElement('afterbegin', el);

  const ref = refFor(el);
  const entry: OutlineEntry = { ref, kind: 'button', name, inViewport: true };
  state.outline = [...((state.outline as OutlineEntry[] | null) ?? []), entry];
  return ref;
}

type Reply = { ok: true; data: unknown } | { ok: false; error: string };
type Routes = Partial<Record<BgRequest['type'], Reply | (() => Reply)>>;

const send = vi.mocked(sendToBackground);

/** Answer each message type with a canned reply, the way the background would. */
function routes(config: Routes): void {
  send.mockImplementation(async (request) => {
    const route = config[request.type];
    if (!route) throw new Error(`No stub for a "${request.type}" message.`);
    return (typeof route === 'function' ? route() : route) as never;
  });
}

function requestsOfType<K extends BgRequest['type']>(type: K): Array<Extract<BgRequest, { type: K }>> {
  return send.mock.calls
    .map(([request]) => request)
    .filter((request): request is Extract<BgRequest, { type: K }> => request.type === type);
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
      target_reason: '',
      ...over,
    },
  };
}

async function openPanel() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Open Page Guide' }));
  return user;
}

async function ask(user: ReturnType<typeof userEvent.setup>, question: string) {
  await user.type(screen.getByPlaceholderText('What are you trying to do here?'), question);
  await user.keyboard('{Enter}');
  await screen.findByText(`Answer to ${question}`);
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

  it('does nothing at all until the button is clicked', () => {
    routes({ getSettings: { ok: true, data: { hasApiKey: true, model: 'a/b' } } });

    render(<App />);

    expect(send).not.toHaveBeenCalled();
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

    send.mockImplementation(async () => answerFor('first') as never);
    await ask(user, 'first');

    send.mockImplementation(async () => answerFor('second') as never);
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

describe('the on-page spotlight', () => {
  it('rings the element the answer points at, and says why', async () => {
    const ref = placeTarget('Cancel subscription');
    spotlightRoutes(
      answerFor('how do I cancel?', {
        refs: [ref],
        target_reason: 'This button ends the plan immediately.',
      }),
    );

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'how do I cancel?');

    expect(screen.getByTestId('spotlight-ring')).toBeInTheDocument();
    expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent(
      'This button ends the plan immediately.',
    );
    // And the same sentence in the panel, which is the announced copy.
    expect(screen.getByRole('status')).toHaveTextContent(
      'This button ends the plan immediately.',
    );
  });

  it('draws nothing when the answer points at a ref that is not on the page', async () => {
    placeTarget('Cancel subscription');
    spotlightRoutes(
      answerFor('how?', { refs: ['e40404'], target_reason: 'Press the big green button.' }),
    );

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'how?');

    // A model is free to invent a ref id. Ringing nothing beats ringing wrong.
    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Answer to how?')).toBeInTheDocument();
  });

  it('replaces the highlight when the next question is asked', async () => {
    const first = placeTarget('Cancel subscription');
    const second = placeTarget('Change plan', 400);
    spotlightRoutes(answerFor('unused'));

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);

    send.mockImplementation(
      async () => answerFor('first', { refs: [first], target_reason: 'Ends the plan.' }) as never,
    );
    await ask(user, 'first');

    send.mockImplementation(
      async () => answerFor('second', { refs: [second], target_reason: 'Switches tier.' }) as never,
    );
    await ask(user, 'second');

    // One highlight, like one answer. Never two rings on the page.
    expect(screen.getAllByTestId('spotlight-ring')).toHaveLength(1);
    expect(screen.getByTestId('spotlight-tooltip')).toHaveTextContent('Switches tier.');
    expect(screen.queryByText('Ends the plan.')).not.toBeInTheDocument();
  });

  it('clears the highlight while the next answer is still loading', async () => {
    const ref = placeTarget('Cancel subscription');
    spotlightRoutes(answerFor('first', { refs: [ref], target_reason: 'Ends the plan.' }));

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'first');
    expect(screen.getByTestId('spotlight-ring')).toBeInTheDocument();

    // A highlight that outlived its answer would be pointing at the previous
    // question's target while the user waits for a new one.
    let release = () => {};
    send.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(answerFor('second') as never))),
    );
    await user.type(screen.getByPlaceholderText('What are you trying to do here?'), 'second');
    await user.keyboard('{Enter}');

    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();

    await act(async () => {
      release();
    });
  });

  it('clears the highlight when the answer fails', async () => {
    const ref = placeTarget('Cancel subscription');
    spotlightRoutes(answerFor('first', { refs: [ref], target_reason: 'Ends the plan.' }));

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'first');

    send.mockImplementation(async () => ({ ok: false, error: 'Rate limited.' }) as never);
    await user.type(screen.getByPlaceholderText('What are you trying to do here?'), 'second');
    await user.keyboard('{Enter}');
    await screen.findByRole('alert');

    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();
  });

  it('clears the highlight when the settings view is opened', async () => {
    const ref = placeTarget('Cancel subscription');
    spotlightRoutes(answerFor('first', { refs: [ref], target_reason: 'Ends the plan.' }));

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'first');

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();
  });

  it('keeps the highlight when the panel is collapsed to the button', async () => {
    const ref = placeTarget('Cancel subscription');
    spotlightRoutes(answerFor('how?', { refs: [ref], target_reason: 'Ends the plan.' }));

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'how?');

    await user.click(screen.getByRole('button', { name: 'Close' }));

    // The user closed the panel precisely to go and touch the thing.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('spotlight-ring')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Page Guide' })).toBeInTheDocument();
  });

  it('closes the panel and clears the highlight on one Escape', async () => {
    const ref = placeTarget('Cancel subscription');
    spotlightRoutes(answerFor('how?', { refs: [ref], target_reason: 'Ends the plan.' }));

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'how?');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();
  });

  it('still clears the highlight with Escape once the panel is collapsed', async () => {
    const ref = placeTarget('Cancel subscription');
    spotlightRoutes(answerFor('how?', { refs: [ref], target_reason: 'Ends the plan.' }));

    const user = await openPanel();
    await screen.findByText(SUMMARY.tldr);
    await ask(user, 'how?');
    await user.click(screen.getByRole('button', { name: 'Close' }));

    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();
  });

  it('hides the highlight from the tooltip without closing the panel', async () => {
    const ref = placeTarget('Cancel subscription');
    spotlightRoutes(answerFor('how?', { refs: [ref], target_reason: 'Ends the plan.' }));

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
    spotlightRoutes(
      answerFor('how?', { refs: [first, second], target_reason: 'Ends the plan.' }),
    );

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
    spotlightRoutes(answerFor('how?', { refs: [ref], target_reason: 'Ends the plan.' }));

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
      send.mockImplementation(async () => answerFor(`q${i}`) as never);
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
