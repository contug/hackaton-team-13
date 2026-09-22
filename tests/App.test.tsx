import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '@/entrypoints/overlay.content/App';
import { sendToBackground } from '@/lib/messaging';
import type { BgRequest } from '@/lib/messaging';
import { snapshotFixture } from './fixtures';

vi.mock('@/lib/messaging', () => ({ sendToBackground: vi.fn() }));
vi.mock('@/lib/snapshot', () => ({ buildSnapshot: vi.fn(() => snapshotFixture()) }));

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

function answerFor(question: string) {
  return {
    ok: true as const,
    data: { answer: `Answer to ${question}`, steps: [], refs: ['e2'], suggestions: [] },
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
});

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
    expect(screen.getByText('Upgrade')).toBeInTheDocument();
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
