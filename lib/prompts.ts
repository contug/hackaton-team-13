import type { PageSnapshot } from './snapshot';

const VOICE = `You are a calm guide for someone who is overwhelmed by the web page they are looking at.

Hard rules:
- Be short. The reader is already overloaded; every extra word costs them.
- Talk about THIS page. Name the actual headings, buttons, links and fields you were given. Never explain the internet in general, and never invent a control that is not in the outline.
- Plain language. No jargon, no hedging, no preamble, no "I'd be happy to".
- If the page does not contain the answer, say so in one sentence and point at the closest thing that is on the page.`;

export const SUMMARIZE_SYSTEM = `${VOICE}

Summarize the page.
- "tldr": one sentence, max 25 words. What is this page FOR?
- "key_points": at most 4 items, each a short phrase, not a sentence.
- "what_you_can_do_here": at most 3 concrete actions available on this page, phrased as verbs ("Cancel your plan", "Filter by date").
- "suggestions": at most 3 follow-up questions, written in the USER's voice as if they typed them ("How do I cancel?", not "Would you like to know how to cancel?").`;

export const ASK_SYSTEM = `${VOICE}

Answer the user's problem using the page.
- "answer": at most 3 sentences. Lead with the answer, not with context.
- "steps": at most 3 steps, only if the user actually needs to do something in order. Empty array otherwise. Do not pad.
- "refs": the "ref" ids (like "e42") of the outline elements your answer points at, most relevant first, at most 3. Empty array if none apply.
- "suggestions": at most 3 follow-up questions in the USER's voice.`;

function renderOutline(snapshot: PageSnapshot): string {
  if (snapshot.outline.length === 0) return '(no interactive elements detected)';

  const lines = snapshot.outline.map((e) => {
    const level = e.level ? ` h${e.level}` : '';
    const where = e.inViewport ? ' [on screen]' : '';
    return `${e.ref} ${e.kind}${level}: ${e.name}${where}`;
  });

  if (snapshot.outlineTruncated) {
    lines.push('(outline truncated — more elements exist further down the page)');
  }
  return lines.join('\n');
}

/** The shared page context block. Identical shape for summarize and ask. */
export function renderSnapshot(snapshot: PageSnapshot): string {
  const { meta, content } = snapshot;

  const parts = [
    `URL: ${meta.url}`,
    `Tab title: ${meta.title}`,
    `Viewport: ${meta.viewport.w}x${meta.viewport.h}, user is ${meta.scrollPct}% down the page`,
    `Forms on page: ${meta.formCount}`,
    '',
    '## Page outline (ref, kind, name)',
    renderOutline(snapshot),
  ];

  if (content) {
    parts.push(
      '',
      '## Main content',
      content.byline ? `By: ${content.byline}` : '',
      content.text,
      content.truncated ? '(main content was truncated in the middle)' : '',
    );
  } else {
    parts.push(
      '',
      '## Main content',
      '(No article content could be extracted — this is an app or dashboard, not a document. Rely on the outline above.)',
    );
  }

  return parts.filter(Boolean).join('\n');
}

export function askUserMessage(snapshot: PageSnapshot, question: string): string {
  return `${renderSnapshot(snapshot)}\n\n---\n\nThe user says: ${question}`;
}

export function summarizeUserMessage(snapshot: PageSnapshot): string {
  return `${renderSnapshot(snapshot)}\n\n---\n\nSummarize this page.`;
}
