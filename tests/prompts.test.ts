import { describe, expect, it } from 'vitest';
import {
  ASK_SYSTEM,
  NEXT_STEPS_SYSTEM,
  SUMMARIZE_SYSTEM,
  askUserMessage,
  nextStepsUserMessage,
  renderSnapshot,
  summarizeUserMessage,
} from '@/lib/prompts';
import { snapshotFixture } from './fixtures';

describe('renderSnapshot', () => {
  it('leads with the page header: url, title, viewport, scroll position and forms', () => {
    const text = renderSnapshot(
      snapshotFixture({
        meta: {
          url: 'https://bank.example/transfer',
          title: 'Transfer money',
          viewport: { w: 1024, h: 640 },
          scrollPct: 42,
          formCount: 3,
        },
      }),
    );

    expect(text).toContain('URL: https://bank.example/transfer');
    expect(text).toContain('Tab title: Transfer money');
    expect(text).toContain('Viewport: 1024x640, user is 42% down the page');
    expect(text).toContain('Forms on page: 3');
  });

  it('emits one "ref kind: name" line per outline entry', () => {
    const text = renderSnapshot(
      snapshotFixture({
        outline: [
          { ref: 'e7', kind: 'button', name: 'Send money', inViewport: false },
          { ref: 'e8', kind: 'field', name: 'Amount (number, required)', inViewport: false },
        ],
      }),
    );

    expect(text).toContain('e7 button: Send money');
    expect(text).toContain('e8 field: Amount (number, required)');
  });

  it('marks the heading level and only tags on-screen entries', () => {
    const text = renderSnapshot(
      snapshotFixture({
        outline: [
          { ref: 'e1', kind: 'heading', level: 2, name: 'Visible heading', inViewport: true },
          { ref: 'e2', kind: 'link', name: 'Offscreen link', inViewport: false },
        ],
      }),
    );

    expect(text).toContain('e1 heading h2: Visible heading [on screen]');
    expect(text).toContain('e2 link: Offscreen link');
    expect(text).not.toContain('Offscreen link [on screen]');
  });

  it('notes an empty outline rather than emitting a blank section', () => {
    const text = renderSnapshot(snapshotFixture({ outline: [] }));
    expect(text).toContain('(no interactive elements detected)');
  });

  it('adds the truncation note only when the outline was capped', () => {
    const truncated = renderSnapshot(snapshotFixture({ outlineTruncated: true }));
    expect(truncated).toContain('(outline truncated');

    const complete = renderSnapshot(snapshotFixture({ outlineTruncated: false }));
    expect(complete).not.toContain('(outline truncated');
  });

  it('renders the main content with its byline and truncation note', () => {
    const text = renderSnapshot(
      snapshotFixture({
        content: {
          title: 'How to cancel',
          byline: 'Ada Lovelace',
          excerpt: null,
          text: 'The body of the article.',
          truncated: true,
        },
      }),
    );

    expect(text).toContain('## Main content');
    expect(text).toContain('By: Ada Lovelace');
    expect(text).toContain('The body of the article.');
    expect(text).toContain('(main content was truncated in the middle)');
  });

  it('omits the byline line when there is none', () => {
    const text = renderSnapshot(
      snapshotFixture({
        content: {
          title: 't',
          byline: null,
          excerpt: null,
          text: 'Body.',
          truncated: false,
        },
      }),
    );

    expect(text).not.toContain('By:');
    expect(text).not.toContain('truncated in the middle');
  });

  it('says so explicitly when there is no article content', () => {
    const text = renderSnapshot(snapshotFixture({ content: null }));
    expect(text).toContain('(No article content could be extracted');
    expect(text).toContain('Rely on the outline above.');
  });
});

describe('user messages', () => {
  it('puts the question after the separator, below the page context', () => {
    const message = askUserMessage(snapshotFixture(), 'how do I upgrade?');
    const [context, question] = message.split('\n\n---\n\n');

    expect(context).toContain('URL: https://example.com/pricing');
    expect(question).toBe('The user says: how do I upgrade?');
  });

  it('asks for a summary after the same separator', () => {
    const message = summarizeUserMessage(snapshotFixture());
    expect(message.split('\n\n---\n\n')[1]).toBe('Summarize this page.');
  });
});

describe('system prompts', () => {
  it('state the brevity limits in prose, since the schema cannot enforce them', () => {
    for (const prompt of [SUMMARIZE_SYSTEM, ASK_SYSTEM]) {
      expect(prompt).toContain('Be short.');
      expect(prompt).toContain('at most 3 follow-up questions');
    }
    expect(SUMMARIZE_SYSTEM).toContain('max 25 words');
    expect(ASK_SYSTEM).toContain('at most 3 sentences');
  });

  it('no longer asks for target_reason anywhere — a step\'s own text is the copy', () => {
    for (const prompt of [SUMMARIZE_SYSTEM, ASK_SYSTEM, NEXT_STEPS_SYSTEM]) {
      expect(prompt).not.toContain('target_reason');
    }
  });

  it('describes the three-key step object to both step-producing prompts', () => {
    for (const prompt of [ASK_SYSTEM, NEXT_STEPS_SYSTEM]) {
      expect(prompt).toContain('"text"');
      expect(prompt).toContain('"ref"');
      expect(prompt).toContain('"fill"');
      // `text` is the tooltip copy, so it carries the brevity limit itself.
      expect(prompt).toMatch(/"text"[^\n]*max 20 words/);
      // A fill is only ever for typing — never for pressing a button.
      expect(prompt).toMatch(/"fill"[^\n]*typing into a field/);
      expect(prompt).toContain('at most 5 steps');
      expect(prompt).toContain('"goal_reached"');
    }
  });

  it('forbids inventing a ref in both step-producing prompts', () => {
    for (const prompt of [ASK_SYSTEM, NEXT_STEPS_SYSTEM]) {
      expect(prompt).toMatch(/ONLY ids that appear in the outline/);
      expect(prompt).toMatch(/never invent one/);
    }
  });

  it('tells the re-plan prompt that the user did not ask a new question', () => {
    expect(NEXT_STEPS_SYSTEM).toMatch(/did not ask a new question/i);
    expect(NEXT_STEPS_SYSTEM).toMatch(/Do not repeat a step the user has already done/i);
    // The point of the whole feature: next steps on THIS page, toward the goal.
    expect(NEXT_STEPS_SYSTEM).toMatch(/ON THIS PAGE/);
    expect(NEXT_STEPS_SYSTEM).toMatch(/goal_reached[^\n]*already met/);
  });
});

describe('nextStepsUserMessage', () => {
  it('leads with the goal, then the progress, then the page', () => {
    const message = nextStepsUserMessage(snapshotFixture(), 'buy wool socks', [
      'Type the product name',
      'Press Search',
    ]);

    const goalAt = message.indexOf("The user's goal: buy wool socks");
    const doneAt = message.indexOf('1. Type the product name');
    const pageAt = message.indexOf('URL: https://example.com/pricing');

    // Order is the point: the goal outlived the navigation, the page is only
    // evidence about how far along it the user is.
    expect(goalAt).toBeGreaterThanOrEqual(0);
    expect(doneAt).toBeGreaterThan(goalAt);
    expect(pageAt).toBeGreaterThan(doneAt);
    expect(message).toContain('2. Press Search');
  });

  it('says so explicitly when nothing has been done yet', () => {
    const message = nextStepsUserMessage(snapshotFixture(), 'buy wool socks', []);

    expect(message).toContain('Already done:\n(nothing yet)');
  });

  it('ends by asking for the next steps here', () => {
    const message = nextStepsUserMessage(snapshotFixture(), 'g', []);
    expect(message.trimEnd().endsWith('What are the next steps here?')).toBe(true);
  });
});
