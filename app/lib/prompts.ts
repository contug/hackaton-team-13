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

/**
 * The step shape, written once and shared by both step-producing prompts.
 *
 * Each step is walked one at a time: the one the user is on is ringed on the
 * page and its `text` is the tooltip copy. So a step has to be a single action
 * against a single control, not a paragraph of advice.
 */
const STEP_RULES = `Each item in "steps" is an object with exactly three keys:
- "text": one short imperative sentence, max 20 words. It is shown on the page next to the element, so say what to do, not why.
- "ref": the outline "ref" id the step acts on, like "e42". Use ONLY ids that appear in the outline above — never invent one, and never cite a control that is not listed. Empty string when the step is not about one element.
- "fill": the exact text to type, ONLY when the step is typing into a field. Empty string for every other kind of step, including pressing a button.

Steps are walked one at a time, in order, and the user is shown exactly one of them. So: one action per step, at most 5 steps, and no step that just repeats the previous one.`;

export const ASK_SYSTEM = `${VOICE}

Answer the user's problem using the page.
- "answer": at most 3 sentences. Lead with the answer, not with context.
- "steps": the ordered things the user must do, on this page, to get what they asked for. Empty array when there is nothing to do. Do not pad.
- "refs": the "ref" ids (like "e42") of the outline elements your answer points at, most relevant first, at most 3. Empty array if none apply.
- "goal_reached": true only when the page already shows what the user asked for, so there is nothing left for them to do. False otherwise.
- "suggestions": at most 3 follow-up questions in the USER's voice.

${STEP_RULES}`;

/**
 * The re-plan prompt: same schema, different situation. The user has already
 * acted on an earlier page and landed here, so the job is not to answer a
 * question — it is to work out where they are against a goal they stated
 * somewhere else, and give them the next rungs on THIS page.
 */
export const NEXT_STEPS_SYSTEM = `${VOICE}

The user is part-way through ONE task that spans several pages. They told you their goal earlier, they have already done some steps, and they have just landed on the page below. They did not ask a new question.

- "answer": at most 2 sentences saying where they now are, relative to the goal.
- "steps": the ordered things to do NEXT, ON THIS PAGE, to get closer to the goal. Empty array when this page offers nothing that helps.
- "refs": the "ref" ids of the outline elements that matter here, most relevant first, at most 3. Empty array if none apply.
- "goal_reached": true only when this page shows the goal is already met — the order is placed, the item is in the basket, the setting is saved. When it is true, "steps" must be empty.
- "suggestions": at most 3 follow-up questions in the USER's voice.

Do not repeat a step the user has already done. Do not re-explain the goal back to them.

${STEP_RULES}`;

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

/**
 * The goal and the progress, then the new page. The goal comes first on purpose:
 * it is the thing that outlived the navigation, and the page is only evidence
 * about how far along it the user is.
 */
export function nextStepsUserMessage(
  snapshot: PageSnapshot,
  goal: string,
  done: string[],
): string {
  const progress =
    done.length > 0
      ? done.map((step, i) => `${i + 1}. ${step}`).join('\n')
      : '(nothing yet)';

  return [
    `The user's goal: ${goal}`,
    '',
    'Already done:',
    progress,
    '',
    '---',
    '',
    renderSnapshot(snapshot),
    '',
    '---',
    '',
    'The user has just landed on this page. What are the next steps here?',
  ].join('\n');
}
