import { describe, expect, it } from 'vitest';
import { ASK_SYSTEM, SUMMARIZE_SYSTEM, askUserMessage, renderSnapshot, summarizeUserMessage } from '@/lib/prompts';
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

  it('asks for one short sentence explaining the first ref', () => {
    expect(ASK_SYSTEM).toContain('"target_reason"');
    // The spotlight rings refs[0], so the reason has to be about that one.
    expect(ASK_SYSTEM).toMatch(/target_reason[^\n]*first/i);
    expect(ASK_SYSTEM).toMatch(/target_reason[^\n]*(one|single) short sentence/i);
  });
});
